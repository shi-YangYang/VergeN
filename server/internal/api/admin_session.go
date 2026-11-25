package api

import (
	"errors"
	"mime"
	"net/http"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
)

const (
	adminRememberCookie = "vergen_admin_remember"
	adminRememberTTL    = 7 * 24 * time.Hour
	// Normal client refresh lookups use a bare hexadecimal digest, not this namespace.
	adminRememberScope = "admin-browser:"
)

func (a *Server) adminBrowserPOST(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		content, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if content != "application/json" {
			fail(w, http.StatusUnsupportedMediaType, "json_required", "JSON required")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != a.qrBaseURL(r) {
			fail(w, http.StatusForbidden, "invalid_origin", "same origin required")
			return
		}
		next(w, r)
	}
}

func deviceGrant(value string) string { return adminRememberScope + auth.HashToken(value) }

func (a *Server) forgetDevice(w http.ResponseWriter, r *http.Request) bool {
	c := a.browserCookie(r, adminRememberCookie)
	if old, err := r.Cookie(c.Name); err == nil {
		if err := a.store.RevokeRefreshTokenByValue(deviceGrant(old.Value), time.Now().Unix()); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "could not revoke admin session")
			return false
		}
		c.MaxAge = -1
		http.SetCookie(w, c)
	}
	return true
}

func (a *Server) handleAdminBrowserLogin(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[struct {
		loginReq
		Remember bool `json:"remember"`
	}](w, r)
	if !ok {
		return
	}
	u := a.passwordUser(w, r, req.loginReq)
	if u == nil {
		return
	}
	if u.Role != "admin" {
		fail(w, http.StatusForbidden, "forbidden", "该账号不是管理员")
		return
	}
	if !a.forgetDevice(w, r) {
		return
	}
	if !req.Remember {
		a.issueSession(w, u)
		return
	}
	value, err := auth.NewRefreshToken()
	if err != nil {
		fail(w, 500, "internal_error", "could not issue admin session")
		return
	}
	now := time.Now()
	until := now.Add(adminRememberTTL)
	key := deviceGrant(value)
	if err := a.store.CreateRefreshToken(u.ID, key, until.Unix(), now.Unix()); err != nil {
		fail(w, 500, "internal_error", "could not issue admin session")
		return
	}
	c := a.browserCookie(r, adminRememberCookie)
	c.Value = value
	c.MaxAge = int(adminRememberTTL.Seconds())
	c.Expires = time.Unix(until.Unix(), 0)
	http.SetCookie(w, c)
	a.writeRememberedAccess(w, u, key, until.Unix())
}

func (a *Server) writeRememberedAccess(w http.ResponseWriter, u *store.User, key string, end int64) {
	ttl := min(a.accessTTL, time.Until(time.Unix(end, 0)))
	if ttl <= 0 {
		fail(w, 401, "admin_session_expired", "admin session expired")
		return
	}
	token, err := auth.IssueAccessToken(a.secret, u.ID, key, ttl)
	if err != nil {
		fail(w, 500, "internal_error", "could not issue access token")
		return
	}
	writeJSON(w, 200, map[string]any{"access_token": token, "expires_in": int(ttl.Seconds()), "token_type": "Bearer", "user": toPublic(u)})
}

func (a *Server) restoreAdminBrowser(w http.ResponseWriter, r *http.Request) {
	c := a.browserCookie(r, adminRememberCookie)
	credential, err := r.Cookie(c.Name)
	if err == nil {
		key := deviceGrant(credential.Value)
		id, _, end, err := a.store.GetValidRefreshToken(key, time.Now().Unix())
		if err == nil {
			var u *store.User
			u, err = a.store.GetUser(id)
			if err == nil && u.Role == "admin" && u.Status == "active" {
				// Keep the original grant and absolute expiry across tabs and refreshes.
				a.writeRememberedAccess(w, u, key, end)
				return
			}
		}
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			fail(w, 500, "internal_error", "could not restore admin session")
			return
		}
		if !a.forgetDevice(w, r) {
			return
		}
	}
	fail(w, http.StatusUnauthorized, "admin_session_expired", "admin session expired")
}

func (a *Server) logoutAdminBrowser(w http.ResponseWriter, r *http.Request) {
	if !a.forgetDevice(w, r) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
