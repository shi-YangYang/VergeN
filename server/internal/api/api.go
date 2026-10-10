package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
	"github.com/shi-YangYang/VergeN/server/internal/web"
)

const (
	accessTTLDefault  = 30 * time.Minute
	refreshTTLDefault = 30 * 24 * time.Hour
)

type Server struct {
	store      *store.Store
	secret     []byte
	limiter    *auth.Limiter
	accessTTL  time.Duration
	refreshTTL time.Duration
	// The QR login map is in-memory state: live sessions vanish on restart
	// and the client simply starts a new scan.
	qrSessions  *dingtalkQrSessions
	pollLimiter *auth.Limiter
}

func NewServer(s *store.Store) (*Server, error) {
	secret, err := s.Secret()
	if err != nil {
		return nil, err
	}
	return &Server{
		store:       s,
		secret:      secret,
		limiter:     auth.NewLimiter(15*time.Minute, 5),
		accessTTL:   accessTTLDefault,
		refreshTTL:  refreshTTLDefault,
		qrSessions:  newDingtalkQrSessions(),
		pollLimiter: auth.NewLimiter(time.Minute, qrCallPerMinute),
	}, nil
}

func (a *Server) Handler() (http.Handler, error) {
	adminPanel, err := web.Handler()
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("GET /admin", adminPanel)
	mux.Handle("GET /admin/{path...}", adminPanel)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /api/v1/auth/login", a.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/refresh", a.handleRefresh)
	mux.HandleFunc("POST /api/v1/auth/logout", a.handleLogout)
	mux.HandleFunc("GET /api/v1/auth/capabilities", a.handleAuthCapabilities)
	mux.HandleFunc("POST /api/v1/auth/dingtalk/qr/start", a.handleDingtalkQrStart)
	mux.HandleFunc("POST /api/v1/auth/dingtalk/qr/poll", a.handleDingtalkQrPoll)
	mux.HandleFunc("POST /api/v1/auth/dingtalk/qr/cancel", a.handleDingtalkQrCancel)
	mux.HandleFunc("GET /api/v1/auth/dingtalk/callback", a.handleDingtalkCallback)
	mux.Handle("GET /api/v1/client/bootstrap", a.authed(a.handleBootstrap))
	mux.Handle("POST /api/v1/client/heartbeat", a.authed(a.handleHeartbeat))
	mux.Handle("GET /api/v1/client/update", a.authed(a.handleClientUpdate))
	mux.Handle("GET /api/v1/client/updater", a.authed(a.handleClientUpdater))
	mux.Handle("POST /api/v1/admin/users", a.admin(a.handleAdminCreateUser))
	mux.Handle("GET /api/v1/admin/users", a.admin(a.handleAdminListUsers))
	mux.Handle("POST /api/v1/admin/users/{id}/status", a.admin(a.handleAdminSetUserStatus))
	mux.Handle("POST /api/v1/admin/users/{id}/password", a.admin(a.handleAdminSetUserPassword))
	mux.Handle("POST /api/v1/admin/users/{id}/dingtalk", a.admin(a.handleAdminSetUserDingtalk))
	mux.Handle("GET /api/v1/admin/subscriptions", a.admin(a.handleAdminListSubscriptions))
	mux.Handle("POST /api/v1/admin/subscriptions", a.admin(a.handleAdminCreateSubscription))
	mux.Handle("POST /api/v1/admin/subscriptions/{id}", a.admin(a.handleAdminUpdateSubscription))
	mux.Handle("POST /api/v1/admin/subscriptions/{id}/enable", a.admin(a.handleAdminSetSubscriptionEnabled))
	mux.Handle("DELETE /api/v1/admin/subscriptions/{id}", a.admin(a.handleAdminDeleteSubscription))
	mux.Handle("GET /api/v1/admin/announcements", a.admin(a.handleAdminListAnnouncements))
	mux.Handle("POST /api/v1/admin/announcements", a.admin(a.handleAdminCreateAnnouncement))
	mux.Handle("POST /api/v1/admin/announcements/{id}", a.admin(a.handleAdminUpdateAnnouncement))
	mux.Handle("POST /api/v1/admin/announcements/{id}/enable", a.admin(a.handleAdminEnableAnnouncement))
	mux.Handle("DELETE /api/v1/admin/announcements/{id}", a.admin(a.handleAdminDeleteAnnouncement))
	mux.Handle("GET /api/v1/admin/settings", a.admin(a.handleAdminGetSettings))
	mux.Handle("POST /api/v1/admin/settings", a.admin(a.handleAdminSetSettings))
	mux.Handle("GET /api/v1/admin/dashboard", a.admin(a.handleAdminDashboard))
	return a.logMiddleware(mux), nil
}

func (a *Server) logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		slog.Debug("http", "method", r.Method, "path", r.URL.Path, "remote", remoteHost(r),
			"duration", time.Since(start).String())
	})
}

type ctxKey int

const userKey ctxKey = 1

func userFrom(r *http.Request) *store.User {
	u, _ := r.Context().Value(userKey).(*store.User)
	return u
}

func (a *Server) authed(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.authenticate(w, r)
		if !ok {
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}

func (a *Server) admin(next http.HandlerFunc) http.Handler {
	return a.authed(func(w http.ResponseWriter, r *http.Request) {
		if userFrom(r).Role != "admin" {
			fail(w, http.StatusForbidden, "forbidden", "admin role required")
			return
		}
		next(w, r)
	})
}

func (a *Server) authenticate(w http.ResponseWriter, r *http.Request) (*store.User, bool) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		fail(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
		return nil, false
	}
	uid, _, err := auth.ParseAccessToken(a.secret, strings.TrimPrefix(header, prefix))
	if err != nil {
		fail(w, http.StatusUnauthorized, "invalid_access_token", "access token expired or invalid")
		return nil, false
	}
	u, err := a.store.GetUser(uid)
	if err != nil {
		fail(w, http.StatusUnauthorized, "invalid_access_token", "access token expired or invalid")
		return nil, false
	}
	if u.Status != "active" {
		fail(w, http.StatusForbidden, "account_disabled", "account is disabled")
		return nil, false
	}
	return u, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func readJSON[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	var v T
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return v, false
	}
	return v, true
}

func remoteHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type userPublic struct {
	ID             int64  `json:"id"`
	Username       string `json:"username"`
	DingtalkUserID string `json:"dingtalk_userid"`
	Role           string `json:"role"`
	Status         string `json:"status"`
	CreatedAt      int64  `json:"created_at"`
	LastSeenAt     *int64 `json:"last_seen_at"`
	LastVersion    string `json:"last_version"`
	LastOS         string `json:"last_os"`
}

func toPublic(u *store.User) userPublic {
	p := userPublic{
		ID: u.ID, Username: u.Username, DingtalkUserID: u.DingTalkUserID,
		Role: u.Role, Status: u.Status,
		CreatedAt: u.CreatedAt, LastVersion: u.LastVersion, LastOS: u.LastOS,
	}
	if u.LastSeenAt.Valid {
		p.LastSeenAt = &u.LastSeenAt.Int64
	}
	return p
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (a *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[loginReq](w, r)
	if !ok {
		return
	}
	if req.Username == "" || req.Password == "" {
		fail(w, http.StatusBadRequest, "bad_request", "username and password are required")
		return
	}
	// Keyed by ip+username so one source cannot brute force many accounts at once.
	key := remoteHost(r) + "|" + strings.ToLower(req.Username)
	if a.limiter.Blocked(key) {
		fail(w, http.StatusTooManyRequests, "too_many_attempts", "too many failed attempts, try again later")
		return
	}
	u, err := a.store.GetUserByUsername(req.Username)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if u != nil {
		valid, verr := auth.VerifyPassword(u.PasswordHash, req.Password)
		if verr != nil || !valid {
			u = nil
		}
	} else {
		// Burn argon2 time for unknown users so response timing does not
		// reveal whether the username exists.
		auth.HashPassword(req.Password)
	}
	if u == nil {
		a.limiter.RecordFail(key)
		fail(w, http.StatusUnauthorized, "invalid_credentials", "invalid username or password")
		return
	}
	if u.Status != "active" {
		fail(w, http.StatusForbidden, "account_disabled", "account is disabled")
		return
	}
	a.limiter.Reset(key)
	if !a.issueSession(w, u) {
		return
	}
}

// issueSessionTokens mints a fresh access/refresh pair. Both password login
// and the DingTalk QR path hand tokens to clients through this.
func (a *Server) issueSessionTokens(u *store.User) (access, refresh string, expiresIn int, err error) {
	access, err = auth.IssueAccessToken(a.secret, u.ID, u.Role, a.accessTTL)
	if err != nil {
		return "", "", 0, err
	}
	refresh, err = auth.NewRefreshToken()
	if err != nil {
		return "", "", 0, err
	}
	now := time.Now()
	if err := a.store.CreateRefreshToken(u.ID, auth.HashToken(refresh), now.Add(a.refreshTTL).Unix(), now.Unix()); err != nil {
		return "", "", 0, err
	}
	return access, refresh, int(a.accessTTL.Seconds()), nil
}

func (a *Server) issueSession(w http.ResponseWriter, u *store.User) bool {
	access, refresh, expiresIn, err := a.issueSessionTokens(u)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return false
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token":  access,
		"refresh_token": refresh,
		"token_type":    "Bearer",
		"expires_in":    expiresIn,
		"user":          toPublic(u),
	})
	return true
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

func (a *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[refreshReq](w, r)
	if !ok {
		return
	}
	if req.RefreshToken == "" {
		fail(w, http.StatusBadRequest, "bad_request", "refresh_token is required")
		return
	}
	now := time.Now()
	userID, tokenID, err := a.store.GetValidRefreshToken(auth.HashToken(req.RefreshToken), now.Unix())
	if errors.Is(err, store.ErrNotFound) {
		fail(w, http.StatusUnauthorized, "invalid_refresh_token", "refresh token expired or revoked")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	u, err := a.store.GetUser(userID)
	if err != nil || u.Status != "active" {
		fail(w, http.StatusUnauthorized, "invalid_refresh_token", "refresh token expired or revoked")
		return
	}
	if err := a.store.RevokeRefreshToken(tokenID, now.Unix()); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	a.issueSession(w, u)
}

func (a *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[refreshReq](w, r)
	if !ok {
		return
	}
	if req.RefreshToken != "" {
		if err := a.store.RevokeRefreshTokenByValue(auth.HashToken(req.RefreshToken), time.Now().Unix()); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

type managedFlags struct {
	AllowEditProfiles   bool `json:"allow_edit_profiles"`
	AllowChangeSettings bool `json:"allow_change_settings"`
}

type announcement struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

// handleAuthCapabilities is the pre-login surface the desktop uses to
// decide which login methods to render; exposing feature flags is harmless.
func (a *Server) handleAuthCapabilities(w http.ResponseWriter, _ *http.Request) {
	_, _, ok := a.dingtalkReady()
	writeJSON(w, http.StatusOK, map[string]bool{"dingtalk_qr": ok})
}

type bootstrapSubscription struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type bootstrapResp struct {
	SubscriptionURL string                  `json:"subscription_url"`
	Subscriptions   []bootstrapSubscription `json:"subscriptions"`
	Managed         managedFlags            `json:"managed"`
	Announcement    *announcement           `json:"announcement"`
}

func (a *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	resp := bootstrapResp{Managed: managedFlags{}}
	enabled, err := a.store.EnabledSubscriptions()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	// The first enabled entry is the default pick for devices that never
	// chose one; the list carries every candidate for client-side switching.
	for _, sub := range enabled {
		resp.Subscriptions = append(resp.Subscriptions, bootstrapSubscription{
			Name: sub.Name,
			URL:  sub.URL,
		})
	}
	if len(enabled) > 0 {
		resp.SubscriptionURL = enabled[0].URL
	}
	if raw, found, err := a.store.GetSetting("managed_flags"); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found && raw != "" {
		if err := json.Unmarshal([]byte(raw), &resp.Managed); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if current, err := a.store.CurrentAnnouncement(); err == nil && current != nil && current.Enabled {
		resp.Announcement = &announcement{
			Title:   current.Title,
			Content: current.Content,
		}
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleClientUpdate hands the employee client the published release
// manifest; an empty version means "nothing published" and 404s.
func (a *Server) handleClientUpdate(w http.ResponseWriter, _ *http.Request) {
	r, err := a.store.GetRelease()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if r == nil {
		fail(w, http.StatusNotFound, "no_release", "no client release published")
		return
	}
	writeJSON(w, http.StatusOK, r)
}

// handleClientUpdater hands the raw tauri-format manifest to the updater
// plugin; the manifest must point its platform artifacts at signed packages.
func (a *Server) handleClientUpdater(w http.ResponseWriter, _ *http.Request) {
	raw, err := a.store.UpdaterManifest()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if strings.TrimSpace(raw) == "" {
		fail(w, http.StatusNotFound, "no_release", "no updater manifest published")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(raw))
}

type heartbeatReq struct {
	Version string `json:"version"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
}

func (a *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[heartbeatReq](w, r)
	if !ok {
		return
	}
	u := userFrom(r)
	if err := a.store.TouchHeartbeat(u.ID, req.Version, req.OS, time.Now().Unix()); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	version, err := a.store.ConfigVersion()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "config_version": version})
}

func validateSubscriptionURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
