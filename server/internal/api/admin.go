package api

import (
	"log/slog"

	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,31}$`)

const (
	settingSubscription   = "subscription_url"
	settingManagedFlags   = "managed_flags"
	settingDingtalkKey    = "dingtalk_app_key"
	settingDingtalkSecret = "dingtalk_app_secret"
	settingDingtalkAgent  = "dingtalk_agent_id"
	settingDingtalkCorp   = "dingtalk_corp_id"
)

type createUserReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (a *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[createUserReq](w, r)
	if !ok {
		return
	}
	if !usernamePattern.MatchString(req.Username) {
		fail(w, http.StatusBadRequest, "bad_request", "username must be 2-32 chars of letters, digits, '_', '.', '-'")
		return
	}
	if len(req.Password) < 8 {
		fail(w, http.StatusBadRequest, "bad_request", "password must be at least 8 characters")
		return
	}
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Role != "user" && req.Role != "admin" {
		fail(w, http.StatusBadRequest, "bad_request", "role must be 'user' or 'admin'")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	u, err := a.store.CreateUser(req.Username, hash, req.Role, time.Now())
	if errors.Is(err, store.ErrConflict) {
		fail(w, http.StatusConflict, "username_taken", "username already exists")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": toPublic(u)})
}

func (a *Server) handleAdminListUsers(w http.ResponseWriter, _ *http.Request) {
	users, err := a.store.ListUsers()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	out := make([]userPublic, 0, len(users))
	for _, u := range users {
		out = append(out, toPublic(u))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

type setStatusReq struct {
	Status string `json:"status"`
}

func (a *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	if userFrom(r).ID == id {
		fail(w, http.StatusBadRequest, "self_delete", "cannot delete your own account")
		return
	}
	target, err := a.store.GetUser(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			fail(w, http.StatusNotFound, "user_not_found", "user does not exist")
			return
		}
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if target.Role == "admin" {
		fail(w, http.StatusBadRequest, "admin_delete", "cannot delete an administrator account")
		return
	}
	found, err := a.store.DeleteUser(id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "user_not_found", "user does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}

type setPasswordReq struct {
	Password string `json:"password"`
}

func (a *Server) handleAdminSetUserPassword(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[setPasswordReq](w, r)
	if !ok {
		return
	}
	if len(req.Password) < 8 {
		fail(w, http.StatusBadRequest, "bad_request", "password must be at least 8 characters")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	found, err := a.store.SetUserPassword(id, hash, time.Now())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "user_not_found", "user does not exist")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setDingtalkReq struct {
	DingtalkUserID string `json:"dingtalk_userid"`
}

// Binding a DingTalk union id is what authorizes an employee to scan; an
// empty string unbinds.
func (a *Server) handleAdminSetUserDingtalk(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[setDingtalkReq](w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	if req.DingtalkUserID != "" {
		// Union ids are opaque tokens from DingTalk's side; only reject
		// sketchy shapes (length, whitespace, separators, html).
		if len(req.DingtalkUserID) > 128 || strings.ContainsAny(req.DingtalkUserID, " \t\r\n\"'") {
			fail(w, http.StatusBadRequest, "bad_request", "dingtalk_userid looks invalid")
			return
		}
	}
	found, err := a.store.SetUserDingtalkID(id, req.DingtalkUserID, time.Now())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "user_not_found", "user does not exist")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type settingsView struct {
	ManagedFlags   managedFlags `json:"managed_flags"`
	DingtalkAppKey string       `json:"dingtalk_app_key"`
	// The secret never round-trips to the panel; only its presence is shown.
	DingtalkAppSecretSet bool   `json:"dingtalk_app_secret_set"`
	DingtalkAgentID      string `json:"dingtalk_agent_id"`
	// Optional: when set, the dingtalk callback verifies the scanned
	// organization equals this corp id.
	DingtalkCorpID  string `json:"dingtalk_corp_id"`
	UpdaterManifest string `json:"updater_manifest"`
}

type settingsPatch struct {
	ManagedFlags *managedFlags `json:"managed_flags"`
	// Release with an empty version clears the published manifest.
	Release *store.Release `json:"release"`

	// Secret pointers follow "present means set": omitted leaves the stored
	// value untouched, an empty string clears it.
	DingtalkAppKey    *string `json:"dingtalk_app_key"`
	DingtalkAppSecret *string `json:"dingtalk_app_secret"`
	DingtalkAgentID   *string `json:"dingtalk_agent_id"`
	DingtalkCorpID    *string `json:"dingtalk_corp_id"`
	// UpdaterManifest must be a valid tauri-format update.json body; an
	// empty string clears it.
	UpdaterManifest *string `json:"updater_manifest"`
}

func (a *Server) handleAdminGetSettings(w http.ResponseWriter, _ *http.Request) {
	view := settingsView{ManagedFlags: managedFlags{}}
	if raw, found, err := a.store.GetSetting(settingManagedFlags); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found && raw != "" {
		if err := json.Unmarshal([]byte(raw), &view.ManagedFlags); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if raw, err := a.store.UpdaterManifest(); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else {
		view.UpdaterManifest = raw
	}
	if appKey, found, err := a.store.GetSetting(settingDingtalkKey); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found {
		view.DingtalkAppKey = appKey
	}
	if agentID, found, err := a.store.GetSetting(settingDingtalkAgent); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found {
		view.DingtalkAgentID = agentID
	}
	if corpID, found, err := a.store.GetSetting(settingDingtalkCorp); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found {
		view.DingtalkCorpID = corpID
	}
	if secret, found, err := a.store.GetSetting(settingDingtalkSecret); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found && secret != "" {
		view.DingtalkAppSecretSet = true
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *Server) handleAdminSetSettings(w http.ResponseWriter, r *http.Request) {
	a.publicationMu.Lock()
	defer a.publicationMu.Unlock()
	req, ok := readJSON[settingsPatch](w, r)
	if !ok {
		return
	}
	if req.ManagedFlags != nil {
		defer func() { _ = a.store.BumpConfigVersion() }()
		raw, err := json.Marshal(req.ManagedFlags)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
		if err := a.store.SetSetting(settingManagedFlags, string(raw)); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.UpdaterManifest != nil {
		trimmed := strings.TrimSpace(*req.UpdaterManifest)
		if trimmed == "" {
			if err := a.store.SetUpdaterManifest(""); err != nil {
				fail(w, http.StatusInternalServerError, "internal_error", "internal error")
				return
			}
		} else {
			var probe map[string]any
			if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
				fail(w, http.StatusBadRequest, "bad_request", "updater_manifest must be a valid JSON document")
				return
			}
			if err := a.store.SetUpdaterManifest(trimmed); err != nil {
				fail(w, http.StatusInternalServerError, "internal_error", "internal error")
				return
			}
		}
	}
	if req.DingtalkAppKey != nil {
		if err := a.store.SetSetting(settingDingtalkKey, *req.DingtalkAppKey); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.DingtalkAppSecret != nil {
		if err := a.store.SetSetting(settingDingtalkSecret, *req.DingtalkAppSecret); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.DingtalkAgentID != nil {
		if err := a.store.SetSetting(settingDingtalkAgent, *req.DingtalkAgentID); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.DingtalkCorpID != nil {
		if err := a.store.SetSetting(settingDingtalkCorp, *req.DingtalkCorpID); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	a.handleAdminGetSettings(w, r)
}

type dashboardResp struct {
	TotalUsers          int64            `json:"total_users"`
	DisabledUsers       int64            `json:"disabled_users"`
	Online              int64            `json:"online"`
	Active24h           int64            `json:"active_24h"`
	OnlineWindowSeconds int64            `json:"online_window_seconds"`
	VersionDist         map[string]int64 `json:"version_distribution"`
	OSDist              map[string]int64 `json:"os_distribution"`
}

func (a *Server) handleAdminDashboard(w http.ResponseWriter, _ *http.Request) {
	stats, err := a.store.DashboardStats(time.Now().Unix(), 5*60, 24*60*60)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusOK, dashboardResp{
		TotalUsers:          stats.TotalUsers,
		DisabledUsers:       stats.DisabledUsers,
		Online:              stats.Online,
		Active24h:           stats.Active24h,
		OnlineWindowSeconds: 300,
		VersionDist:         stats.VersionDist,
		OSDist:              stats.OSDist,
	})
}

// --- Subscription management ---

type subscriptionPayload struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func (a *Server) handleAdminListSubscriptions(w http.ResponseWriter, _ *http.Request) {
	subs, err := a.store.ListSubscriptions()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	out := make([]*store.Subscription, 0, len(subs))
	out = append(out, subs...)
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": out})
}

func (a *Server) handleAdminCreateSubscription(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[subscriptionPayload](w, r)
	if !ok {
		return
	}
	if !validateSubscriptionURL(req.URL) {
		fail(w, http.StatusBadRequest, "bad_request", "url must be a valid http(s) URL")
		return
	}
	sub, err := a.store.CreateSubscription(req.Name, req.URL, time.Now())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"subscription": sub})
	_ = a.store.BumpConfigVersion()
}

func (a *Server) handleAdminUpdateSubscription(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[subscriptionPayload](w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid subscription id")
		return
	}
	found, err := a.store.UpdateSubscription(id, req.Name, req.URL)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "subscription_not_found", "subscription does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}

type enablePayload struct {
	Enabled bool `json:"enabled"`
}

func (a *Server) handleAdminSetSubscriptionEnabled(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[enablePayload](w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid subscription id")
		return
	}
	found, err := a.store.SetSubscriptionEnabled(id, req.Enabled)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "subscription_not_found", "subscription does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}

func (a *Server) handleAdminDeleteSubscription(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid subscription id")
		return
	}
	found, err := a.store.DeleteSubscription(id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "subscription_not_found", "subscription does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}

// --- Announcement management (single-pick delivery) ---

type announcementPayload struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func (a *Server) handleAdminListAnnouncements(w http.ResponseWriter, _ *http.Request) {
	list, err := a.store.ListAnnouncements()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	out := make([]*store.Announcement, 0, len(list))
	out = append(out, list...)
	writeJSON(w, http.StatusOK, map[string]any{"announcements": out})
}

func (a *Server) handleAdminCreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[announcementPayload](w, r)
	if !ok {
		return
	}
	if req.Title == "" {
		fail(w, http.StatusBadRequest, "bad_request", "announcement title is required")
		return
	}
	created, err := a.store.CreateAnnouncement(req.Title, req.Content, time.Now())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"announcement": created})
	_ = a.store.BumpConfigVersion()
}

func (a *Server) handleAdminUpdateAnnouncement(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[announcementPayload](w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid announcement id")
		return
	}
	if req.Title == "" {
		fail(w, http.StatusBadRequest, "bad_request", "announcement title is required")
		return
	}
	found, err := a.store.UpdateAnnouncement(id, req.Title, req.Content, time.Now())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "announcement_not_found", "announcement does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}

func (a *Server) handleAdminEnableAnnouncement(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[enablePayload](w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid announcement id")
		return
	}
	found, err := a.store.EnableAnnouncement(id, req.Enabled)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "announcement_not_found", "announcement does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}

func (a *Server) handleAdminDeleteAnnouncement(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid announcement id")
		return
	}
	found, err := a.store.DeleteAnnouncement(id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "announcement_not_found", "announcement does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}

// --- Client releases (multi-version, per-platform) ---

type releasePayload struct {
	Version    string                    `json:"version"`
	Notes      string                    `json:"notes"`
	WinURL     string                    `json:"win_url"`
	LinuxURL   string                    `json:"linux_url"`
	MacURL     string                    `json:"mac_url"`
	AndroidURL string                    `json:"android_url"`
	PubDate    int64                     `json:"pub_date"`
	BaseURL    string                    `json:"base_url"`
	Packages   map[string]string         `json:"packages"`
	Updater    map[string]updaterPackage `json:"updater"`
}

func (a *Server) handleAdminListReleases(w http.ResponseWriter, _ *http.Request) {
	list, err := a.store.ListReleases()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	out := make([]*store.Release, 0, len(list))
	out = append(out, list...)
	writeJSON(w, http.StatusOK, map[string]any{"releases": out})
}

func (a *Server) handleAdminCreateRelease(w http.ResponseWriter, r *http.Request) {
	a.publicationMu.Lock()
	defer a.publicationMu.Unlock()
	req, ok := readJSON[releasePayload](w, r)
	if !ok {
		return
	}
	if req.Packages != nil || req.Updater != nil {
		a.publishRelease(w, req)
		return
	}
	if req.Version == "" {
		fail(w, http.StatusBadRequest, "bad_request", "release version is required")
		return
	}
	for _, url := range []string{req.WinURL, req.LinuxURL, req.MacURL, req.AndroidURL} {
		if url != "" && !validateSubscriptionURL(url) {
			fail(w, http.StatusBadRequest, "bad_request", "release urls must be valid http(s) URLs")
			return
		}
	}
	created, err := a.store.CreateRelease(&store.Release{
		Version:    req.Version,
		Notes:      req.Notes,
		WinURL:     req.WinURL,
		LinuxURL:   req.LinuxURL,
		MacURL:     req.MacURL,
		AndroidURL: req.AndroidURL,
		PubDate:    req.PubDate,
	}, time.Now())
	if err != nil {
		slog.Error("create release failed", slog.Any("err", err))
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	_ = a.store.BumpConfigVersion()
	writeJSON(w, http.StatusCreated, map[string]any{"release": created})
}

func (a *Server) handleAdminDeleteRelease(w http.ResponseWriter, r *http.Request) {
	a.publicationMu.Lock()
	defer a.publicationMu.Unlock()
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid release id")
		return
	}
	found, err := a.store.DeleteRelease(id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "release_not_found", "release does not exist")
		return
	}
	_ = a.store.BumpConfigVersion()
	w.WriteHeader(http.StatusNoContent)
}
