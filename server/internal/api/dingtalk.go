package api

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	qrSessionTTL    = 5 * time.Minute
	maxQrSessions   = 512
	qrCallPerMinute = 240
	dingtalkTimeout = 10 * time.Second
)

// dingtalkQrSession bridges the desktop client (poll) and the DingTalk
// redirect (callback). The server resolves the user identity during the
// callback; tokens are only minted when the client collects them, so no
// credential ever rests in the map.
type dingtalkQrSession struct {
	state    string
	status   string // pending | ok | fail
	created  time.Time
	username string
	failMsg  string
}

type dingtalkQrSessions struct {
	mu   sync.Mutex
	live map[string]*dingtalkQrSession
}

func newDingtalkQrSessions() *dingtalkQrSessions {
	return &dingtalkQrSessions{live: map[string]*dingtalkQrSession{}}
}

func (qs *dingtalkQrSessions) sweepLocked(now time.Time) {
	for id, s := range qs.live {
		if now.Sub(s.created) > qrSessionTTL {
			delete(qs.live, id)
		}
	}
}

func (qs *dingtalkQrSessions) create() (id, state string) {
	qs.mu.Lock()
	defer qs.mu.Unlock()
	qs.sweepLocked(time.Now())
	if len(qs.live) >= maxQrSessions {
		return "", ""
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", ""
	}
	id = hex.EncodeToString(buf)
	if _, err := rand.Read(buf); err != nil {
		return "", ""
	}
	state = hex.EncodeToString(buf)
	qs.live[id] = &dingtalkQrSession{state: state, status: "pending", created: time.Now()}
	return id, state
}

func (qs *dingtalkQrSessions) cancel(id string) {
	qs.mu.Lock()
	defer qs.mu.Unlock()
	delete(qs.live, id)
}

// complete marks the session done; an empty failMsg means success.
func (qs *dingtalkQrSessions) complete(id, username, failMsg string) {
	qs.mu.Lock()
	defer qs.mu.Unlock()
	s, ok := qs.live[id]
	if !ok {
		return
	}
	if failMsg != "" {
		s.status, s.failMsg = "fail", failMsg
		return
	}
	s.status, s.username = "ok", username
}

func (qs *dingtalkQrSessions) byState(state string) (id string, ok bool) {
	qs.mu.Lock()
	defer qs.mu.Unlock()
	qs.sweepLocked(time.Now())
	for sid, s := range qs.live {
		if s.state == state {
			return sid, true
		}
	}
	return "", false
}

func (qs *dingtalkQrSessions) take(id string) (status, username, failMsg string, ok bool) {
	qs.mu.Lock()
	defer qs.mu.Unlock()
	qs.sweepLocked(time.Now())
	s, found := qs.live[id]
	if !found {
		return "", "", "", false
	}
	return s.status, s.username, s.failMsg, true
}

func (a *Server) dingtalkReady() (appKey, appSecret string, ok bool) {
	var err error
	if appKey, ok, err = a.store.GetSetting(settingDingtalkKey); err != nil || !ok {
		return "", "", false
	}
	if appKey == "" {
		return "", "", false
	}
	appSecret, ok, err = a.store.GetSetting(settingDingtalkSecret)
	if err != nil {
		return "", "", false
	}
	return appKey, appSecret, ok && appSecret != ""
}

// qrBaseURL derives the externally visible base URL; the authorization window must reach
// the callback through it.
func (a *Server) qrBaseURL(r *http.Request) string {
	scheme := "https"
	if r.TLS == nil {
		if fp := r.Header.Get("X-Forwarded-Proto"); fp != "" {
			scheme = strings.TrimSpace(strings.Split(fp, ",")[0])
		} else {
			scheme = "http"
		}
	}
	return scheme + "://" + r.Host
}

// throttleQr counts every call so the poll loop stays inside the cap.
func (a *Server) throttleQr(ip, sessionID string) bool {
	key := ip + "|" + sessionID
	if a.pollLimiter.Blocked(key) {
		return false
	}
	a.pollLimiter.RecordFail(key)
	return true
}

func (a *Server) handleDingtalkQrStart(w http.ResponseWriter, r *http.Request) {
	appKey, _, ok := a.dingtalkReady()
	if !ok {
		fail(w, http.StatusBadRequest, "dingtalk_not_configured",
			"DingTalk QR login is not configured; set AppKey and AppSecret in the admin panel")
		return
	}
	configuredCorp, _, err := a.store.GetSetting(settingDingtalkCorp)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	scope := "openid"
	if configuredCorp != "" {
		scope += " corpid"
	}
	ip := remoteHost(r)
	if !a.throttleQr(ip, "") {
		fail(w, http.StatusTooManyRequests, "too_many_requests", "too many requests, try again later")
		return
	}
	id, state := a.qrSessions.create()
	if id == "" {
		fail(w, http.StatusServiceUnavailable, "too_many_sessions", "too many pending QR sessions, try again later")
		return
	}
	callback := a.qrBaseURL(r) + "/api/v1/auth/dingtalk/callback"
	qr := "https://login.dingtalk.com/oauth2/auth?" + url.Values{
		"client_id":     {appKey},
		"redirect_uri":  {callback},
		"response_type": {"code"},
		"scope":         {scope},
		"prompt":        {"consent"},
		"state":         {state},
	}.Encode()
	writeJSON(w, http.StatusOK, map[string]string{"session_id": id, "qr_url": qr})
}

type dingtalkQrReq struct {
	SessionID string `json:"session_id"`
}

func (a *Server) handleDingtalkQrPoll(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[dingtalkQrReq](w, r)
	if !ok {
		return
	}
	if !a.throttleQr(remoteHost(r), req.SessionID) {
		fail(w, http.StatusTooManyRequests, "too_many_requests", "too many requests, try again later")
		return
	}
	status, username, failMsg, found := a.qrSessions.take(req.SessionID)
	if !found {
		writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
		return
	}
	switch status {
	case "pending":
		writeJSON(w, http.StatusOK, map[string]any{"status": "pending"})
	case "ok":
		a.qrSessions.cancel(req.SessionID)
		u, err := a.store.GetUserByUsername(username)
		if err != nil || u.Status != "active" {
			writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
			return
		}
		access, refresh, expiresIn, err := a.issueSessionTokens(u)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "ok",
			"username":      u.Username,
			"access_token":  access,
			"refresh_token": refresh,
			"token_type":    "Bearer",
			"expires_in":    expiresIn,
			"user":          toPublic(u),
		})
	default:
		a.qrSessions.cancel(req.SessionID)
		writeJSON(w, http.StatusOK, map[string]any{"status": "fail", "message": failMsg})
	}
}

func (a *Server) handleDingtalkQrCancel(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[dingtalkQrReq](w, r)
	if !ok {
		return
	}
	a.qrSessions.cancel(req.SessionID)
	w.WriteHeader(http.StatusNoContent)
}

// handleDingtalkCallback is the OAuth redirect target DingTalk opens after
// the employee confirms on their phone; it resolves the user and completes
// or fails the matching QR session.
func (a *Server) handleDingtalkCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("authCode")
	state := r.URL.Query().Get("state")
	authError := r.URL.Query().Get("error")

	title, detail := "登录失败", "链接无效或已过期，请回到客户端重新扫码"

	if state != "" {
		if sessionID, found := a.qrSessions.byState(state); found {
			if authError != "" {
				detail = "未完成钉钉授权，请重新登录"
				a.qrSessions.complete(sessionID, "", detail)
			} else if code != "" {
				title, detail = a.dingtalkFinishCallback(sessionID, code)
			}
		}
	}

	qrCallbackPage(w, title, detail)
}

func (a *Server) dingtalkFinishCallback(sessionID, code string) (title, detail string) {
	appKey, appSecret, ready := a.dingtalkReady()
	if !ready {
		a.qrSessions.complete(sessionID, "", "服务器钉钉登录未配置")
		return "登录失败", "服务器钉钉登录未配置，请联系管理员"
	}
	identity, userCorpID, err := dingtalkExchangeUser(appKey, appSecret, code)
	if err != nil {
		a.qrSessions.complete(sessionID, "", "钉钉验证失败")
		return "登录失败", fmt.Sprintf("钉钉验证失败：%v", err)
	}
	configuredCorp, _, err := a.store.GetSetting(settingDingtalkCorp)
	if err != nil {
		a.qrSessions.complete(sessionID, "", "内部错误")
		return "登录失败", "服务器内部错误，请稍后重试"
	}
	if configuredCorp != "" {
		// Optional organization guard: the scanned account must belong to
		// the configured corp.
		if userCorpID != configuredCorp {
			a.qrSessions.complete(sessionID, "", "组织不符")
			return "登录失败", "请使用公司组织的钉钉账号扫码"
		}
	}
	u, err := a.store.GetOrCreateDingtalkUser(identity.UnionID, identity.Nick, time.Now())
	if err != nil {
		a.qrSessions.complete(sessionID, "", "内部错误")
		return "登录失败", "服务器内部错误，请稍后重试"
	}
	if u.Status != "active" {
		a.qrSessions.complete(sessionID, "", "已停用")
		return "登录失败", "该账号已被停用，请联系管理员"
	}
	a.qrSessions.complete(sessionID, u.Username, "")
	return "登录成功", "已完成验证，请回到 VergeN 客户端查看"
}

type dingtalkUserAccess struct {
	AccessToken string `json:"accessToken"`
	CorpID      string `json:"corpId"`
	Message     string `json:"message"`
}

type dingtalkUser struct {
	UnionID string `json:"unionId"`
	Nick    string `json:"nick"`
	Message string `json:"message"`
}

func dingtalkExchangeUser(appKey, appSecret, code string) (dingtalkUser, string, error) {
	payload, err := json.Marshal(map[string]string{
		"clientId":     appKey,
		"clientSecret": appSecret,
		"grantType":    "authorization_code",
		"code":         code,
	})
	if err != nil {
		return dingtalkUser{}, "", err
	}
	client := &http.Client{Timeout: dingtalkTimeout}
	resp, err := client.Post("https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
		"application/json", bytes.NewReader(payload))
	if err != nil {
		return dingtalkUser{}, "", errors.New("无法连接钉钉服务")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return dingtalkUser{}, "", errors.New("钉钉响应读取失败")
	}
	var parsed dingtalkUserAccess
	if err := json.Unmarshal(body, &parsed); err != nil {
		return dingtalkUser{}, "", fmt.Errorf("钉钉响应解析失败 (HTTP %d)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK || parsed.AccessToken == "" {
		if parsed.Message != "" {
			return dingtalkUser{}, "", fmt.Errorf("%s", parsed.Message)
		}
		return dingtalkUser{}, "", fmt.Errorf("钉钉获取登录凭证失败 (HTTP %d)", resp.StatusCode)
	}
	req, err := http.NewRequest(http.MethodGet, "https://api.dingtalk.com/v1.0/contact/users/me", nil)
	if err != nil {
		return dingtalkUser{}, "", err
	}
	req.Header.Set("x-acs-dingtalk-access-token", parsed.AccessToken)
	userResp, err := client.Do(req)
	if err != nil {
		return dingtalkUser{}, "", errors.New("无法获取钉钉用户信息")
	}
	defer userResp.Body.Close()
	userBody, err := io.ReadAll(io.LimitReader(userResp.Body, 64<<10))
	if err != nil {
		return dingtalkUser{}, "", errors.New("钉钉用户信息读取失败")
	}
	var user dingtalkUser
	if err := json.Unmarshal(userBody, &user); err != nil {
		return dingtalkUser{}, "", fmt.Errorf("钉钉用户信息解析失败 (HTTP %d)", userResp.StatusCode)
	}
	if userResp.StatusCode != http.StatusOK || user.UnionID == "" {
		if user.Message != "" {
			return dingtalkUser{}, "", fmt.Errorf("%s", user.Message)
		}
		if userResp.StatusCode != http.StatusOK {
			return dingtalkUser{}, "", fmt.Errorf("钉钉获取用户信息失败 (HTTP %d)", userResp.StatusCode)
		}
		return dingtalkUser{}, "", errors.New("钉钉未返回用户标识")
	}
	return user, parsed.CorpID, nil
}

func qrCallbackPage(w http.ResponseWriter, title, detail string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title><body style="font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="background:#fff;border-radius:16px;padding:40px 36px;max-width:320px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)">
<div style="font-size:40px;font-weight:700;color:#15181d;margin-bottom:12px">N</div>
<h1 style="font-size:20px;margin:0 0 10px;color:#15181d">%s</h1>
<p style="color:#6b7280;font-size:14px;margin:0;line-height:1.6">%s</p>
</div></body>`, html.EscapeString(title), html.EscapeString(title), html.EscapeString(detail))
}
