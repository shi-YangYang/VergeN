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
	downloadStatePrefix       = "download."
	downloadTargetStatePrefix = downloadStatePrefix + "file." // keep in-flight file logins valid
	downloadStateCookie       = "vergen_download_state"
	downloadSessionCookie     = "vergen_download_session"
	downloadSessionTTL        = 30 * 24 * time.Hour
	packageTicketTTL          = 30 * time.Minute
)

func (a *Server) browserCookie(r *http.Request, name string) *http.Cookie {
	secure := strings.HasPrefix(a.qrBaseURL(r), "https://")
	if secure {
		name = "__Host-" + name
	}
	return &http.Cookie{Name: name, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode}
}

func downloadFileName(name string) string {
	if _, ok := web.PackageFile(name, 0); !ok || len(name) > 255 {
		return ""
	}
	return name
}

func (a *Server) downloadState(r *http.Request, state string) *http.Cookie {
	name := downloadStateCookie
	if nonce, ok := strings.CutPrefix(state, downloadTargetStatePrefix); ok {
		// Keep concurrent authorizations bound to their own actions.
		name += "." + nonce
	}
	return a.browserCookie(r, name)
}

// Stored continuations are either a verified local filename (legacy format) or
// one of two internal action paths. Never redirect to a caller-supplied URL.
type downloadTarget string

const iosDownloadPath = "/download/ios"

func actionTarget(path string) downloadTarget {
	if path == iosDownloadPath {
		return downloadTarget(path)
	}
	if _, _, ok := releaseDownloadTarget(path); ok {
		return downloadTarget(path)
	}
	return ""
}

func (t downloadTarget) destination() string {
	if t == "" {
		return "/download"
	}
	if strings.HasPrefix(string(t), "/") {
		return string(t)
	}
	return "/files/" + url.PathEscape(string(t))
}

func (t downloadTarget) query() url.Values {
	v := url.Values{}
	if strings.HasPrefix(string(t), "/") {
		v.Set("target", string(t))
	} else if t != "" {
		v.Set("file", string(t))
	}
	return v
}

func (a *Server) startDownloadLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	target := downloadTarget(downloadFileName(r.URL.Query().Get("file")))
	if target == "" {
		target = actionTarget(r.URL.Query().Get("target"))
	}
	if a.downloadUser(r) != nil {
		http.Redirect(w, r, target.destination(), http.StatusSeeOther)
		return
	}
	appKey, _, ready := a.dingtalkReady()
	corp, _, err := a.store.GetSetting(settingDingtalkCorp)
	if err != nil || !ready || corp == "" {
		downloadLoginError(w, r, "config", target)
		return
	}
	if !a.throttleQr(remoteHost(r), "") {
		downloadLoginError(w, r, "busy", target)
		return
	}
	nonce, err := auth.NewRefreshToken()
	if err != nil {
		downloadLoginError(w, r, "failed", target)
		return
	}
	state := downloadStatePrefix + nonce
	if target != "" {
		state = downloadTargetStatePrefix + nonce
	}
	cookie := a.downloadState(r, state)
	cookie.Value = state
	if target != "" {
		cookie.Value += "|" + url.QueryEscape(string(target))
	}
	cookie.MaxAge = int(qrSessionTTL.Seconds())
	http.SetCookie(w, cookie)
	http.Redirect(w, r, a.dingtalkAuthorizeURL(r, appKey, "openid corpid", state), http.StatusSeeOther)
}

func downloadLoginError(w http.ResponseWriter, r *http.Request, code string, target downloadTarget) {
	query := target.query()
	query.Set("login_error", code)
	http.Redirect(w, r, "/download?"+query.Encode(), http.StatusSeeOther)
}

func (a *Server) finishDownloadLogin(w http.ResponseWriter, r *http.Request, state, code string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	stateCookie := a.downloadState(r, state)
	original, err := r.Cookie(stateCookie.Name)
	if err != nil {
		downloadLoginError(w, r, "expired", "")
		return
	}
	expected, encoded, _ := strings.Cut(original.Value, "|")
	if !hmac.Equal([]byte(expected), []byte(state)) {
		downloadLoginError(w, r, "expired", "")
		return
	}
	value, _ := url.QueryUnescape(encoded)
	target := downloadTarget(downloadFileName(value))
	if target == "" {
		target = actionTarget(value)
	}
	stateCookie.MaxAge = -1
	http.SetCookie(w, stateCookie)
	if code == "" || r.URL.Query().Get("error") != "" {
		downloadLoginError(w, r, "canceled", target)
		return
	}
	u, corp, failure := a.resolveDingtalkUser(code, true)
	if failure != nil {
		downloadLoginError(w, r, failure.code, target)
		return
	}
	session := a.browserCookie(r, downloadSessionCookie)
	session.Value, err = auth.IssueAccessToken(a.downloadSigningKey(), u.ID, webDownloadScope(corp, u), downloadSessionTTL)
	if err != nil {
		downloadLoginError(w, r, "failed", target)
		return
	}
	session.MaxAge = int(downloadSessionTTL.Seconds())
	http.SetCookie(w, session)
	http.Redirect(w, r, target.destination(), http.StatusSeeOther)
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
	c, err := r.Cookie(a.browserCookie(r, downloadSessionCookie).Name)
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
		if r.URL.Path == iosDownloadPath && a.downloadUser(r) == nil {
			http.Redirect(w, r, "/download?login_required=ios", http.StatusSeeOther)
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
		if r.Method == http.MethodGet && !r.URL.Query().Has("ticket") {
			if name := downloadFileName(r.PathValue("name")); name != "" {
				http.Redirect(w, r, "/download/login?file="+url.QueryEscape(name), http.StatusSeeOther)
				return
			}
		}
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
