package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
	"github.com/shi-YangYang/VergeN/server/internal/web"
)

const (
	downloadStatePrefix   = "download."
	downloadStateCookie   = "vergen_download_state"
	downloadSessionCookie = "vergen_download_session"
	downloadSessionTTL    = 8 * time.Hour
	packageTicketTTL      = 30 * time.Minute
)

func (a *Server) downloadCookie(r *http.Request, name string) *http.Cookie {
	secure := strings.HasPrefix(a.qrBaseURL(r), "https://")
	if secure {
		name = "__Host-" + name
	}
	return &http.Cookie{Name: name, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode}
}

func (a *Server) startDownloadLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	appKey, _, ready := a.dingtalkReady()
	corp, _, err := a.store.GetSetting(settingDingtalkCorp)
	if err != nil || !ready || corp == "" {
		downloadLoginError(w, r, "config")
		return
	}
	if !a.throttleQr(remoteHost(r), "") {
		downloadLoginError(w, r, "busy")
		return
	}
	nonce, err := auth.NewRefreshToken()
	if err != nil {
		downloadLoginError(w, r, "failed")
		return
	}
	state := a.downloadCookie(r, downloadStateCookie)
	state.Value, state.MaxAge = downloadStatePrefix+nonce, int(qrSessionTTL.Seconds())
	http.SetCookie(w, state)
	http.Redirect(w, r, a.dingtalkAuthorizeURL(r, appKey, "openid corpid", state.Value), http.StatusSeeOther)
}

func downloadLoginError(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/download?login_error="+url.QueryEscape(code), http.StatusSeeOther)
}

func (a *Server) finishDownloadLogin(w http.ResponseWriter, r *http.Request, state, code string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	stateCookie := a.downloadCookie(r, downloadStateCookie)
	original, err := r.Cookie(stateCookie.Name)
	if err != nil || !hmac.Equal([]byte(original.Value), []byte(state)) {
		downloadLoginError(w, r, "expired")
		return
	}
	stateCookie.MaxAge = -1
	http.SetCookie(w, stateCookie)
	if code == "" || r.URL.Query().Get("error") != "" {
		downloadLoginError(w, r, "canceled")
		return
	}
	u, corp, failure := a.resolveDingtalkUser(code, true)
	if failure != nil {
		downloadLoginError(w, r, failure.code)
		return
	}
	session := a.downloadCookie(r, downloadSessionCookie)
	session.Value, err = auth.IssueAccessToken(a.downloadSigningKey(), u.ID, webDownloadScope(corp, u), downloadSessionTTL)
	if err != nil {
		downloadLoginError(w, r, "failed")
		return
	}
	session.MaxAge = int(downloadSessionTTL.Seconds())
	http.SetCookie(w, session)
	http.Redirect(w, r, "/download", http.StatusSeeOther)
}

// Download credentials must never be accepted as client or admin API tokens.
func (a *Server) downloadSigningKey() []byte {
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte("vergen/downloads/v1"))
	return mac.Sum(nil)
}

func webDownloadScope(corp string, u *store.User) string {
	return "web:" + corp + "\x00" + u.DingTalkUserID
}

func (a *Server) downloadIdentity(token string) (*store.User, string) {
	id, scope, err := auth.ParseAccessToken(a.downloadSigningKey(), token)
	if err != nil {
		return nil, ""
	}
	u, err := a.store.GetUser(id)
	if err != nil || u.Status != "active" {
		return nil, ""
	}
	return u, scope
}

func (a *Server) downloadUser(r *http.Request) *store.User {
	c, err := r.Cookie(a.downloadCookie(r, downloadSessionCookie).Name)
	if err != nil {
		return nil
	}
	u, scope := a.downloadIdentity(c.Value)
	if u == nil || u.DingTalkUserID == "" {
		return nil
	}
	corp, _, err := a.store.GetSetting(settingDingtalkCorp)
	if err == nil && corp != "" && scope == webDownloadScope(corp, u) {
		return u
	}
	return nil
}

func (a *Server) serveDownloadPage(panel http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		if a.downloadUser(r) == nil && !r.URL.Query().Has("login_error") {
			http.Redirect(w, r, "/download/login", http.StatusSeeOther)
			return
		}
		panel.ServeHTTP(w, r)
	}
}

func (a *Server) servePackage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if ticket := r.URL.Query().Get("ticket"); ticket != "" {
		if u, scope := a.downloadIdentity(ticket); u != nil && scope == "file:"+r.PathValue("name") {
			web.Files(a.downloads)(w, r)
			return
		}
	}
	if a.downloadUser(r) == nil {
		fail(w, http.StatusUnauthorized, "download_login_required", "请用公司钉钉登录下载页")
		return
	}
	web.Files(a.downloads)(w, r)
}

func (a *Server) localPackageName(r *http.Request, raw string) string {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "" && u.Scheme != "http" && u.Scheme != "https") || u.User != nil || !strings.HasPrefix(u.Path, "/files/") {
		return ""
	}
	name := strings.TrimPrefix(u.Path, "/files/")
	if _, ok := web.PackageFile(name, 0); !ok {
		return ""
	}
	if u.Host != "" && !strings.EqualFold(u.Host, r.Host) {
		// A published local package can be reached through another ops hostname.
		// Preserve links to external files and never forward a ticket to that host.
		info, err := os.Lstat(filepath.Join(a.downloads, name))
		if u.RawQuery != "" || a.downloads == "" || err != nil || !info.Mode().IsRegular() {
			return ""
		}
	}
	return name
}

func (a *Server) packageURL(r *http.Request, raw string) (string, error) {
	name := a.localPackageName(r, raw)
	if name == "" {
		return raw, nil
	}
	ticket, err := auth.IssueAccessToken(a.downloadSigningKey(), userFrom(r).ID, "file:"+name, packageTicketTTL)
	if err != nil {
		return "", err
	}
	return a.qrBaseURL(r) + "/files/" + url.PathEscape(name) + "?ticket=" + url.QueryEscape(ticket), nil
}

func (a *Server) signManifestURLs(r *http.Request, raw string) (any, error) {
	var manifest map[string]any
	if err := json.Unmarshal([]byte(raw), &manifest); err != nil {
		return nil, err
	}
	sign := func(entry map[string]any) error {
		if rawURL, ok := entry["url"].(string); ok {
			signed, err := a.packageURL(r, rawURL)
			if err != nil {
				return err
			}
			entry["url"] = signed
		}
		return nil
	}
	if err := sign(manifest); err != nil {
		return nil, err
	}
	platforms, _ := manifest["platforms"].(map[string]any)
	for _, platform := range platforms {
		entry, _ := platform.(map[string]any)
		if err := sign(entry); err != nil {
			return nil, err
		}
	}
	return manifest, nil
}

func (a *Server) handleAdminPackageDownload(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := web.PackageFile(name, 0); !ok {
		http.NotFound(w, r)
		return
	}
	link, err := a.packageURL(r, "/files/"+url.PathEscape(name))
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "could not issue download link")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"url": link})
}
