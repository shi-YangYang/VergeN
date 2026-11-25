package api

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
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
	if get("/download").Code != http.StatusOK || get(listing).Code != http.StatusOK || get("/api/v1/public/releases").Code != 404 {
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
	beginLogin := func(start string) (string, []*http.Cookie) {
		t.Helper()
		begin := get(start)
		location, err := url.Parse(begin.Header().Get("Location"))
		if err != nil || location.Host != "login.dingtalk.com" || location.Query().Get("scope") != "openid corpid" || location.Query().Get("redirect_uri") != "https://ops.example.com"+dingtalkCallbackPath {
			t.Fatal("invalid web authorization redirect")
		}
		path := dingtalkCallbackPath + "?authCode=code&state=" + url.QueryEscape(location.Query().Get("state"))
		if get(path).Header().Get("Location") != "/download?login_error=expired" {
			t.Fatal("accepted callback from another browser")
		}
		return path, begin.Result().Cookies()
	}
	callback := func() *httptest.ResponseRecorder {
		path, cookies := beginLogin("/download/login")
		return get(path, cookies...)
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
	if session == nil || session.MaxAge != 30*86400 || !session.HttpOnly || !session.Secure || session.SameSite != http.SameSiteLaxMode {
		t.Fatal("missing protected session cookie")
	}
	if get("/download", session).Code != 200 || get(listing, session).Code != 200 || get("/files/app.apk", session).Body.String() != "installer" {
		t.Fatal("employee could not use downloads")
	}
	if code, _ := doJSON(t, h, "GET", "/api/v1/client/bootstrap", session.Value, nil); code != 401 {
		t.Fatal("download cookie accepted as a client token")
	}
	const name = "VergeN 安卓+测试 0.1.6.apk"
	filePath := "/files/" + url.PathEscape(name)
	if err := os.WriteFile(filepath.Join(dir, name), []byte("selected installer"), 0600); err != nil {
		t.Fatal(err)
	}
	anonymous := get(filePath)
	start := anonymous.Header().Get("Location")
	if anonymous.Code != http.StatusSeeOther || start != "/download/login?file="+url.QueryEscape(name) {
		t.Fatalf("anonymous package response: %d %s", anonymous.Code, start)
	}
	firstPath, firstCookies := beginLogin(start)
	otherPath, otherCookies := beginLogin(get("/files/app.apk").Header().Get("Location"))
	browserCookies := append(firstCookies, otherCookies...)
	if other := get(otherPath, browserCookies...); other.Header().Get("Location") != "/files/app.apk" {
		t.Fatal("second file login changed its destination")
	}
	authorized := get(firstPath, browserCookies...)
	if authorized.Code != http.StatusSeeOther || authorized.Header().Get("Location") != filePath {
		t.Fatal("callback lost the original download")
	}
	var fileSession *http.Cookie
	for _, c := range authorized.Result().Cookies() {
		if c.Name == session.Name && c.MaxAge > 0 {
			fileSession = c
		}
	}
	if fileSession == nil {
		t.Fatal("file login did not create an employee session")
	}
	attachment := get(authorized.Header().Get("Location"), fileSession)
	kind, params, err := mime.ParseMediaType(attachment.Header().Get("Content-Disposition"))
	if err != nil || attachment.Code != http.StatusOK || attachment.Body.String() != "selected installer" || kind != "attachment" || params["filename"] != name {
		t.Fatal("the browser did not receive the requested installer")
	}
	firstPath, firstCookies = beginLogin(start)
	canceled, err := url.Parse(get(firstPath+"&error=access_denied", firstCookies...).Header().Get("Location"))
	if err != nil || canceled.Path != "/download" || canceled.Query().Get("login_error") != "canceled" || canceled.Query().Get("file") != name {
		t.Fatal("canceling login lost the retry destination")
	}
	badPath, badCookies := beginLogin("/download/login?file=" + url.QueryEscape("//example.invalid/test.apk"))
	if got := get(badPath, badCookies...).Header().Get("Location"); got != "/download" {
		t.Fatalf("accepted a nonlocal destination: %s", got)
	}
	for _, target := range []string{iosDownloadPath, "/download/releases/1/windows"} {
		start := get(target).Header().Get("Location")
		if target == iosDownloadPath {
			if start != "/download?login_required=ios" || get(start).Code != http.StatusOK {
				t.Fatal("anonymous iOS entry did not return to catalog for login confirmation")
			}
			start = "/download/login?target=" + url.QueryEscape(iosDownloadPath)
		}
		if start != "/download/login?target="+url.QueryEscape(target) {
			t.Fatalf("unprotected action %s: %s", target, start)
		}
		path, cookies := beginLogin(start)
		retry, err := url.Parse(get(path+"&error=access_denied", cookies...).Header().Get("Location"))
		if err != nil || retry.Path != "/download" || retry.Query().Get("target") != target || retry.Query().Get("login_error") != "canceled" {
			t.Fatalf("lost action after cancellation: %v", retry)
		}
		retryQuery := retry.Query()
		retryQuery.Del("login_error")
		path, cookies = beginLogin("/download/login?" + retryQuery.Encode())
		if got := get(path, cookies...).Header().Get("Location"); got != target {
			t.Fatalf("login returned to %q instead of %q", got, target)
		}
		if got := get(start, session).Header().Get("Location"); got != target {
			t.Fatalf("existing session triggered another login for %s", target)
		}
	}
	for _, invalid := range []string{"//other.example/x", "/download/ios?next=//other", "/download/releases/1/other", "/admin"} {
		if got := get("/download/login?target="+url.QueryEscape(invalid), session).Header().Get("Location"); got != "/download" {
			t.Fatalf("unexpected destination for %q: %s", invalid, got)
		}
	}
	u, err := s.GetUserByDingtalkID("employee-union")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetUserStatus(u.ID, "disabled", time.Now()); err != nil {
		t.Fatal(err)
	}
	if get(listing, session).Code != http.StatusOK || get(iosDownloadPath, session).Code != http.StatusSeeOther || get("/files/app.apk", session).Header().Get("Location") != "/download/login?file=app.apk" || callback().Header().Get("Location") != "/download?login_error=disabled" {
		t.Fatal("disabled user retained download access")
	}
}

func TestPublicCatalogProtectsReleaseLinks(t *testing.T) {
	h, s := newTestBackend(t)
	employee := withEmployeeDownloadSession(t, h, s)
	const external = "https://cdn.example.org/setup.exe?credential=private"
	history, err := s.CreateRelease(&store.Release{Version: "0.1.0", WinURL: external, MacURL: "/files/VergeN.dmg"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateRelease(&store.Release{Version: "0.2.0", WinURL: "https://cdn.example.org/latest.exe"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	serve := func(handler http.Handler, path string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}
	rec := serve(h, "/api/v1/download/releases")
	var catalog struct{ Releases []catalogRelease }
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &catalog) != nil || len(catalog.Releases) != 2 || strings.Contains(rec.Body.String(), "cdn.example") || strings.Contains(rec.Body.String(), "updater_platforms") {
		t.Fatal("anonymous catalog omitted versions or exposed private link information")
	}
	older := catalog.Releases[1]
	want := fmt.Sprintf("/download/releases/%d/windows", history.ID)
	if older.WinURL != want || older.MacURL != "/files/VergeN.dmg" || older.AndroidURL != "" {
		t.Fatalf("unexpected catalog links: %+v", older)
	}
	if res := serve(h, older.WinURL); res.Code != http.StatusSeeOther || !strings.HasPrefix(res.Header().Get("Location"), "/download/login?") {
		t.Fatal("anonymous visitor reached the external URL")
	}
	if got := serve(employee, older.WinURL).Header().Get("Location"); got != external {
		t.Fatalf("expected original version-specific download, got %q", got)
	}
	if _, err := s.DeleteRelease(history.ID); err != nil {
		t.Fatal(err)
	}
	if got := serve(employee, older.WinURL).Code; got != http.StatusNotFound {
		t.Fatalf("deleted external release: %d", got)
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
