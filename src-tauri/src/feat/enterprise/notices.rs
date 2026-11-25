//! Announcement state belongs to the signed-in native process, not a replaceable WebView.
use super::{AnnouncementResponse, DeliveredAnnouncement, http_client, present};
use crate::config::Config;
use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

const INTERVAL: Duration = Duration::from_secs(300);
static STATE: LazyLock<Mutex<NoticeState>> = LazyLock::new(Default::default);

#[derive(Default)]
struct SessionLane {
    io: AsyncMutex<()>,
    end: CancellationToken,
}

struct NoticeState {
    epoch: u32,
    lane: Arc<SessionLane>,
    current: Option<DeliveredAnnouncement>,
    started: bool,
    deadline: Option<Instant>,
    remaining: Duration,
}

impl Default for NoticeState {
    fn default() -> Self {
        Self {
            epoch: 1,
            lane: Arc::default(),
            current: None,
            started: false,
            deadline: None,
            remaining: INTERVAL,
        }
    }
}

impl NoticeState {
    fn reset(&mut self) {
        self.lane.end.cancel();
        *self = Self {
            epoch: self.epoch.wrapping_add(1),
            ..Self::default()
        };
    }

    fn pause(&mut self, now: Instant) {
        if let Some(end) = self.deadline.take() {
            self.remaining = end
                .checked_duration_since(now)
                .filter(|d| !d.is_zero())
                .unwrap_or(INTERVAL);
        }
    }

    fn due(&mut self, now: Instant) -> bool {
        let end = self.deadline.get_or_insert(now + self.remaining);
        if self.started && now < *end {
            return false;
        }
        self.started = true;
        *end = now + INTERVAL;
        true
    }

    fn snapshot(&self, checked: bool) -> NoticeSnapshot {
        let remaining = self
            .deadline
            .map_or(self.remaining, |d| d.saturating_duration_since(Instant::now()));
        NoticeSnapshot {
            notice: self.current.clone(),
            next_ms: remaining.as_millis().max(1) as u64,
            checked,
        }
    }

    fn clear_match(&mut self, id: i64, revision: &str) {
        if self
            .current
            .as_ref()
            .is_some_and(|n| n.id == id && n.revision == revision)
        {
            self.current = None;
        }
    }
}

// A stable local outbox namespace only. Authorization always uses the actual bearer
// from the current native session; no ID supplied by the WebView authenticates a request.
pub(super) fn account_key(token: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Subject {
        sub: String,
    }
    let bytes = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
    serde_json::from_slice::<Subject>(&bytes)
        .ok()?
        .sub
        .parse::<u64>()
        .ok()
        .filter(|id| *id != 0)
        .map(|id| id.to_string())
}

pub(crate) fn session_epoch() -> u32 {
    STATE.lock().epoch
}
pub(super) fn reset() {
    STATE.lock().reset();
}
pub(crate) fn pause() {
    STATE.lock().pause(Instant::now());
}

#[derive(Serialize)]
pub struct NoticeSnapshot {
    notice: Option<DeliveredAnnouncement>,
    next_ms: u64,
    checked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptStatus {
    Saved,
    UnknownRevision,
}

fn lane(epoch: u32) -> Result<Arc<SessionLane>> {
    let state = STATE.lock();
    if state.epoch != epoch {
        return Err(anyhow!("Announcement session ended"));
    }
    Ok(state.lane.clone())
}

async fn access(server: &str, username: &str, epoch: u32) -> Result<String> {
    let config = Config::verge().await.data_arc();
    if config.enterprise_server_url.as_deref() != Some(server)
        || config.enterprise_username.as_deref() != Some(username)
        || !present(&config.enterprise_access_token)
        || session_epoch() != epoch
    {
        return Err(anyhow!("Announcement session ended"));
    }
    Ok(config
        .enterprise_access_token
        .as_ref()
        .expect("checked access token")
        .to_string())
}

enum Read {
    Replace(Option<DeliveredAnnouncement>),
    Keep,
}

async fn fetch(server: &str, username: &str, epoch: u32, token: String) -> Result<Read> {
    use reqwest::StatusCode;
    let client = http_client()?;
    let url = format!("{}/api/v1/client/announcement", server.trim_end_matches('/'));
    let get = |token: &str| client.get(&url).bearer_auth(token).send();
    let mut response = get(&token).await?;
    if response.status() == StatusCode::UNAUTHORIZED {
        // The heartbeat may have finished rotating this bearer while GET was in flight.
        let latest = access(server, username, epoch).await?;
        if latest != token {
            response = get(&latest).await?;
        }
    }
    match response.status() {
        StatusCode::UNAUTHORIZED => Ok(Read::Keep),
        StatusCode::NOT_FOUND | StatusCode::NO_CONTENT | StatusCode::FORBIDDEN => Ok(Read::Replace(None)),
        _ => Ok(Read::Replace(
            response
                .error_for_status()?
                .json::<AnnouncementResponse>()
                .await?
                .announcement,
        )),
    }
}

pub async fn current(
    server: &str,
    username: &str,
    epoch: u32,
    foreground: impl Fn() -> bool,
) -> Result<NoticeSnapshot> {
    let lane = lane(epoch)?;
    let run = async {
        let _guard = lane.io.lock().await;
        let token = access(server, username, epoch).await?;
        let active = foreground();
        let now = Instant::now();
        {
            let mut state = STATE.lock();
            if state.epoch != epoch {
                return Err(anyhow!("Announcement session ended"));
            }
            if !active {
                state.pause(now);
                return Ok(state.snapshot(false));
            }
            if !state.due(now) {
                return Ok(state.snapshot(false));
            }
        }
        // Transient failures do not mean the server withdrew an unread announcement.
        let result = fetch(server, username, epoch, token).await;
        let mut state = STATE.lock();
        if state.epoch != epoch {
            return Err(anyhow!("Announcement session ended"));
        }
        if let Ok(Read::Replace(notice)) = result {
            state.current = notice;
        }
        Ok(state.snapshot(true))
    };
    lane.end
        .run_until_cancelled(run)
        .await
        .ok_or_else(|| anyhow!("Announcement session ended"))?
}

pub async fn acknowledge(server: &str, username: &str, epoch: u32, id: i64, revision: &str) -> Result<ReceiptStatus> {
    use reqwest::StatusCode;
    let lane = lane(epoch)?;
    let run = async {
        let _guard = lane.io.lock().await;
        let token = access(server, username, epoch).await?;
        let result = http_client()?
            .post(format!(
                "{}/api/v1/client/announcement/ack",
                server.trim_end_matches('/')
            ))
            .bearer_auth(token)
            .json(&serde_json::json!({"id": id, "revision": revision}))
            .send()
            .await?;
        let mut state = STATE.lock();
        if state.epoch != epoch {
            return Err(anyhow!("Announcement session ended"));
        }
        match result.status() {
            StatusCode::NO_CONTENT => {
                state.clear_match(id, revision);
                Ok(ReceiptStatus::Saved)
            }
            StatusCode::CONFLICT => Ok(ReceiptStatus::UnknownRevision),
            status => {
                if status == StatusCode::FORBIDDEN {
                    state.current = None;
                }
                Err(anyhow!("Announcement receipt was not accepted ({status})"))
            }
        }
    };
    lane.end
        .run_until_cancelled(run)
        .await
        .ok_or_else(|| anyhow!("Announcement session ended"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_outlives_webviews_and_relogin_cancels_old_io() {
        let mut state = NoticeState::default();
        let now = Instant::now();
        assert!(state.due(now));
        assert!(!state.due(now)); // duplicate mounts share the same read
        state.pause(now + Duration::from_secs(120));
        let reopened = now + Duration::from_secs(1200);
        assert!(!state.due(reopened));
        assert!(!state.due(reopened + Duration::from_secs(179)));
        assert!(state.due(reopened + Duration::from_secs(180)));
        let original = state.lane.clone();
        let epoch = state.epoch;
        state.reset();
        assert!(original.end.is_cancelled());
        assert_ne!(state.epoch, epoch);
        assert!(state.due(reopened + Duration::from_secs(181)));
    }

    #[test]
    fn ack_only_evicts_the_exact_cached_revision() {
        let mut state = NoticeState::default();
        state.current = Some(DeliveredAnnouncement {
            id: 4,
            revision: "current".into(),
            title: "notice".into(),
            content: String::new(),
        });
        state.clear_match(4, "old");
        assert!(state.current.is_some());
        state.clear_match(4, "current");
        assert!(state.current.is_none());
    }
}
