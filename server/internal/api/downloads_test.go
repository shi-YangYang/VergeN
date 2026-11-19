package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
)

func TestDownloadDingtalkAccess(t *testing.T) {
	_, s := newTestBackend(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "app.apk"), []byte("installer"), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := NewServer(s, dir)
	if err != nil {
		t.Fatal(err)
	}
	h, err := a.Handler()
	if err != nil {
		t.Fatal(err)
	}
	get := func(path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", "https://ops.example.com"+path, nil)
		for _, c := range cookies {
			r.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	const listing = "/api/v1/download/releases"
	if get("/download").Header().Get("Location") != "/download/login" || get(listing).Code != 401 || get("/files/app.apk").Code != 401 || get("/api/v1/public/releases").Code != 404 {
		t.Fatal("unexpected anonymous download access")
	}
	set := func(key, value string) {
		t.Helper()
		if err := s.SetSetting(key, value); err != nil {
			t.Fatal(err)
		}
	}
	set(settingDingtalkKey, "key")
	set(settingDingtalkSecret, "secret")
	if get("/download/login").Header().Get("Location") != "/download?login_error=config" {
		t.Fatal("missing CorpId allowed")
	}
	set(settingDingtalkCorp, "company")

	tokenCorp := "other"
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	http.DefaultTransport = dingtalkTestTransport(func(r *http.Request) (*http.Response, error) {
		body := `{"unionId":"employee-union","nick":"employee"}`
		if r.URL.Path == "/v1.0/oauth2/userAccessToken" {
			body = `{"accessToken":"employee-token","corpId":"` + tokenCorp + `"}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	callback := func() *httptest.ResponseRecorder {
		t.Helper()
		begin := get("/download/login")
		location, err := url.Parse(begin.Header().Get("Location"))
		if err != nil || location.Host != "login.dingtalk.com" || location.Query().Get("scope") != "openid corpid" || location.Query().Get("redirect_uri") != "https://ops.example.com"+dingtalkCallbackPath {
			t.Fatal("invalid web authorization redirect")
		}
		path := dingtalkCallbackPath + "?authCode=code&state=" + url.QueryEscape(location.Query().Get("state"))
		if get(path).Header().Get("Location") != "/download?login_error=expired" {
			t.Fatal("accepted callback from another browser")
		}
		return get(path, begin.Result().Cookies()...)
	}
	if callback().Header().Get("Location") != "/download?login_error=corp" {
		t.Fatal("accepted non-company login")
	}
	tokenCorp = "company"
	result := callback()
	if result.Header().Get("Location") != "/download" {
		t.Fatal("failed to return employee to downloads")
	}
	var session *http.Cookie
	for _, c := range result.Result().Cookies() {
		if c.MaxAge > 0 {
			session = c
		}
	}
	if session == nil || !session.HttpOnly || !session.Secure || session.SameSite != http.SameSiteLaxMode {
		t.Fatal("missing protected session cookie")
	}
	if get("/download", session).Code != 200 || get(listing, session).Code != 200 || get("/files/app.apk", session).Body.String() != "installer" {
		t.Fatal("employee could not use downloads")
	}
	if code, _ := doJSON(t, h, "GET", "/api/v1/client/bootstrap", session.Value, nil); code != 401 {
		t.Fatal("download cookie accepted as a client token")
	}
	u, err := s.GetUserByDingtalkID("employee-union")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetUserStatus(u.ID, "disabled", time.Now()); err != nil {
		t.Fatal(err)
	}
	if get(listing, session).Code != 401 || get("/files/app.apk", session).Code != 401 || callback().Header().Get("Location") != "/download?login_error=disabled" {
		t.Fatal("disabled user retained download access")
	}
}

func TestClientDownloadTicket(t *testing.T) {
	_, s := newTestBackend(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "app.deb"), []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := NewServer(s, dir)
	if err != nil {
		t.Fatal(err)
	}
	h, err := a.Handler()
	if err != nil {
		t.Fatal(err)
	}
	admin := adminLoginToken(t, h, s)
	code, resp := doJSON(t, h, "GET", "https://ops.example.com/api/v1/admin/packages/app.deb/download", admin, nil)
	link, err := url.Parse(resp["url"].(string))
	if code != 200 || err != nil || link.Query().Get("ticket") == "" {
		t.Fatal("missing file ticket")
	}
	serve := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec
	}
	ticket := link.Query().Get("ticket")
	if serve(link.RequestURI()).Body.String() != "file" || serve("/files/other.deb?ticket="+ticket).Code != 401 {
		t.Fatal("ticket was not restricted to its package")
	}
	if code, _ := doJSON(t, h, "GET", "/api/v1/admin/settings", ticket, nil); code != 401 {
		t.Fatal("file ticket accepted as an admin token")
	}
	id, _, err := auth.ParseAccessToken(a.secret, admin)
	if err != nil {
		t.Fatal(err)
	}
	expired, err := auth.IssueAccessToken(a.downloadSigningKey(), id, "file:app.deb", -time.Minute)
	if err != nil || serve("/files/app.deb?ticket="+expired).Code != 401 {
		t.Fatal("expired file ticket accepted")
	}
}
