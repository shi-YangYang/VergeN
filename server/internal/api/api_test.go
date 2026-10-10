package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
)

func newTestBackend(t *testing.T) (http.Handler, *store.Store) {
	t.Helper()
	s, err := store.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	sv, err := NewServer(s)
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	handler, err := sv.Handler()
	if err != nil {
		t.Fatalf("build handler: %v", err)
	}
	return handler, s
}

func doJSON(t *testing.T, h http.Handler, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, path, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	res := rec.Result()
	defer res.Body.Close()
	var out map[string]any
	if rec.Body.Len() > 0 {
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
	}
	return res.StatusCode, out
}

func login(t *testing.T, h http.Handler, username, password string) (int, map[string]any) {
	t.Helper()
	return doJSON(t, h, "POST", "/api/v1/auth/login", "", map[string]string{
		"username": username, "password": password,
	})
}

func TestEnterpriseFlow(t *testing.T) {
	h, s := newTestBackend(t)
	hash, err := auth.HashPassword("admin-password-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("admin", hash, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}

	// Admin login.
	code, body := login(t, h, "admin", "admin-password-1")
	if code != http.StatusOK {
		t.Fatalf("admin login: status=%d body=%v", code, body)
	}
	adminToken, _ := body["access_token"].(string)
	if adminToken == "" {
		t.Fatal("admin login returned no access_token")
	}

	// Ops publishes a company subscription.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/subscriptions", adminToken,
		map[string]any{"name": "公司订阅", "url": "https://ops.example.com/sub/company"})
	if code != http.StatusCreated {
		t.Fatalf("create subscription: status=%d body=%v", code, body)
	}

	// Admin creates an employee account.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/users", adminToken,
		map[string]any{"username": "emp1", "password": "emp-password-1"})
	if code != http.StatusCreated {
		t.Fatalf("create user: status=%d body=%v", code, body)
	}
	userObj, _ := body["user"].(map[string]any)
	if userObj == nil || userObj["id"] == nil {
		t.Fatalf("create user returned no user: %v", body)
	}
	empID := int64(userObj["id"].(float64))

	// Employee login.
	code, body = login(t, h, "emp1", "emp-password-1")
	if code != http.StatusOK {
		t.Fatalf("emp login: status=%d body=%v", code, body)
	}
	empAccess, _ := body["access_token"].(string)
	empRefresh, _ := body["refresh_token"].(string)
	if empAccess == "" || empRefresh == "" {
		t.Fatalf("emp login returned no tokens: %v", body)
	}

	// Bootstrap returns the ops-configured subscription URL and locked flags.
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusOK {
		t.Fatalf("bootstrap: status=%d body=%v", code, body)
	}
	if body["subscription_url"] != "https://ops.example.com/sub/company" {
		t.Fatalf("bootstrap subscription_url = %v", body["subscription_url"])
	}
	managed, _ := body["managed"].(map[string]any)
	if managed == nil || managed["allow_edit_profiles"] != false || managed["allow_change_settings"] != false {
		t.Fatalf("bootstrap managed flags = %v", body["managed"])
	}

	// Heartbeat records client info.
	code, body = doJSON(t, h, "POST", "/api/v1/client/heartbeat", empAccess,
		map[string]string{"version": "2.5.9", "os": "macos", "arch": "arm64"})
	if code != http.StatusOK || body["ok"] != true {
		t.Fatalf("heartbeat: status=%d body=%v", code, body)
	}
	u, err := s.GetUser(empID)
	if err != nil {
		t.Fatal(err)
	}
	if u.LastVersion != "2.5.9" || u.LastOS != "macos" || !u.LastSeenAt.Valid {
		t.Fatalf("heartbeat not persisted: %+v", u)
	}

	// Refresh rotates; the old refresh token cannot be reused.
	code, body = doJSON(t, h, "POST", "/api/v1/auth/refresh", "",
		map[string]string{"refresh_token": empRefresh})
	if code != http.StatusOK {
		t.Fatalf("refresh: status=%d body=%v", code, body)
	}
	if body["refresh_token"] == empRefresh {
		t.Fatal("expected rotated refresh token")
	}
	code, body = doJSON(t, h, "POST", "/api/v1/auth/refresh", "",
		map[string]string{"refresh_token": empRefresh})
	if code != http.StatusUnauthorized {
		t.Fatalf("reused refresh: status=%d body=%v", code, body)
	}

	// Disabling the employee blocks access even with a valid access token.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/users/"+itoa(empID)+"/status", adminToken,
		map[string]string{"status": "disabled"})
	if code != http.StatusNoContent {
		t.Fatalf("disable user: status=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusForbidden {
		t.Fatalf("bootstrap after disable: status=%d body=%v", code, body)
	}

	// Dashboard aggregates the disabled user.
	code, body = doJSON(t, h, "GET", "/api/v1/admin/dashboard", adminToken, nil)
	if code != http.StatusOK {
		t.Fatalf("dashboard: status=%d body=%v", code, body)
	}
	if body["total_users"] != float64(2) || body["disabled_users"] != float64(1) {
		t.Fatalf("dashboard counts = %v", body)
	}
}

func TestLoginRateLimit(t *testing.T) {
	h, s := newTestBackend(t)
	hash, err := auth.HashPassword("admin-password-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("admin", hash, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	for range 5 {
		code, _ := login(t, h, "admin", "wrong-password")
		if code != http.StatusUnauthorized {
			t.Fatalf("bad login: status=%d", code)
		}
	}
	code, body := login(t, h, "admin", "admin-password-1")
	if code != http.StatusTooManyRequests {
		t.Fatalf("expected rate limit, status=%d body=%v", code, body)
	}
}

func TestAdminSettingsValidation(t *testing.T) {
	h, s := newTestBackend(t)
	hash, _ := auth.HashPassword("admin-password-1")
	if _, err := s.CreateUser("admin", hash, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	_, body := login(t, h, "admin", "admin-password-1")
	adminToken := body["access_token"].(string)

	code, _ := doJSON(t, h, "POST", "/api/v1/admin/subscriptions", adminToken,
		map[string]any{"url": "not-a-url"})
	if code != http.StatusBadRequest {
		t.Fatalf("invalid subscription url: status=%d", code)
	}

	code, _ = doJSON(t, h, "POST", "/api/v1/admin/users", adminToken,
		map[string]any{"username": "x", "password": "short"})
	if code != http.StatusBadRequest {
		t.Fatalf("weak password: status=%d", code)
	}
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}

func adminLoginToken(t *testing.T, h http.Handler, s *store.Store) string {
	t.Helper()
	hash, err := auth.HashPassword("admin-password-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("admin", hash, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	code, body := login(t, h, "admin", "admin-password-1")
	if code != http.StatusOK {
		t.Fatalf("admin login: status=%d", code)
	}
	token, _ := body["access_token"].(string)
	if token == "" {
		t.Fatal("admin login returned no access_token")
	}
	return token
}

func TestAdminPanelServing(t *testing.T) {
	h, _ := newTestBackend(t)

	req, err := http.NewRequest("GET", "/admin", nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("GET /admin: status=%d", rec.Code)
	}

	req, err = http.NewRequest("GET", "/admin/", nil)
	if err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /admin/: status=%d", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("root")) {
		t.Fatal("admin panel html does not contain the app root")
	}
}

func TestAdminSettingsDingtalk(t *testing.T) {
	h, s := newTestBackend(t)
	adminToken := adminLoginToken(t, h, s)

	// Secret set via the panel is stored, never echoed back.
	code, body := doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{
			"dingtalk_app_key":    "app-key",
			"dingtalk_app_secret": "super-secret-value",
			"dingtalk_agent_id":   "agent-1",
		})
	if code != http.StatusOK {
		t.Fatalf("set dingtalk settings: status=%d body=%v", code, body)
	}
	if body["dingtalk_app_key"] != "app-key" || body["dingtalk_app_secret_set"] != true {
		t.Fatalf("dingtalk settings view = %v", body)
	}
	if _, leaked := body["dingtalk_app_secret"]; leaked {
		t.Fatal("settings view must not echo the dingtalk secret")
	}

	// A patch without the secret leaves it configured.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{"dingtalk_agent_id": "agent-2"})
	if code != http.StatusOK || body["dingtalk_app_secret_set"] != true || body["dingtalk_agent_id"] != "agent-2" {
		t.Fatalf("patch without secret = %v", body)
	}

	// An explicit empty string clears it.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{"dingtalk_app_secret": ""})
	if code != http.StatusOK || body["dingtalk_app_secret_set"] != false {
		t.Fatalf("clear secret = %v", body)
	}
}

func TestDingtalkQrLoginFlow(t *testing.T) {
	h, s := newTestBackend(t)
	adminToken := adminLoginToken(t, h, s)

	// Starting before the panel is configured is a clean 400.
	code, _ := doJSON(t, h, "POST", "/api/v1/auth/dingtalk/qr/start", "", nil)
	if code != http.StatusBadRequest {
		t.Fatalf("start unconfigured: status=%d", code)
	}

	code, body := doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{
			"dingtalk_app_key":    "app-key",
			"dingtalk_app_secret": "super-secret-value",
		})
	if code != http.StatusOK {
		t.Fatalf("set dingtalk settings: status=%d body=%v", code, body)
	}

	code, body = doJSON(t, h, "POST", "/api/v1/auth/dingtalk/qr/start", "", nil)
	if code != http.StatusOK {
		t.Fatalf("qr start: status=%d body=%v", code, body)
	}
	sessionID, _ := body["session_id"].(string)
	qrURL, _ := body["qr_url"].(string)
	if sessionID == "" || qrURL == "" {
		t.Fatalf("qr start incomplete: %v", body)
	}
	if !bytes.Contains([]byte(qrURL), []byte("login.dingtalk.com/oauth/qrcode/app-key")) ||
		!bytes.Contains([]byte(qrURL), []byte("redirect_uri=")) {
		t.Fatalf("qr url unexpected: %q", qrURL)
	}

	// Unknown poll is expired, known poll is pending.
	code, body = doJSON(t, h, "POST", "/api/v1/auth/dingtalk/qr/poll", "",
		map[string]string{"session_id": "deadbeef"})
	if code != http.StatusOK || body["status"] != "expired" {
		t.Fatalf("unknown poll: status=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, "POST", "/api/v1/auth/dingtalk/qr/poll", "",
		map[string]string{"session_id": sessionID})
	if code != http.StatusOK || body["status"] != "pending" {
		t.Fatalf("pending poll: status=%d body=%v", code, body)
	}

	// Cancel stops the session for good.
	code, body = doJSON(t, h, "POST", "/api/v1/auth/dingtalk/qr/cancel", "",
		map[string]string{"session_id": sessionID})
	if code != http.StatusNoContent {
		t.Fatalf("cancel: status=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, "POST", "/api/v1/auth/dingtalk/qr/poll", "",
		map[string]string{"session_id": sessionID})
	if code != http.StatusOK || body["status"] != "expired" {
		t.Fatalf("poll after cancel: status=%d body=%v", code, body)
	}

	// Admin binds a union id, the store matches by it, unbinding clears it.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/users", adminToken,
		map[string]any{"username": "emp2", "password": "emp-password-2"})
	if code != http.StatusCreated {
		t.Fatalf("create user: status=%d body=%v", code, body)
	}
	userObj, _ := body["user"].(map[string]any)
	empID := int64(userObj["id"].(float64))
	code, body = doJSON(t, h, "POST", "/api/v1/admin/users/"+itoa(empID)+"/dingtalk", adminToken,
		map[string]string{"dingtalk_userid": "union-1"})
	if code != http.StatusNoContent {
		t.Fatalf("bind dingtalk: status=%d body=%v", code, body)
	}
	u, err := s.GetUserByDingtalkID("union-1")
	if err != nil || u.Username != "emp2" {
		t.Fatalf("lookup by union id: %+v err=%v", u, err)
	}
	if u.DingTalkUserID != "union-1" {
		t.Fatalf("user dingtalk id: %q", u.DingTalkUserID)
	}
	code, body = doJSON(t, h, "POST", "/api/v1/admin/users/"+itoa(empID)+"/dingtalk", adminToken,
		map[string]string{"dingtalk_userid": ""})
	if code != http.StatusNoContent {
		t.Fatalf("unbind dingtalk: status=%d body=%v", code, body)
	}
	if _, err := s.GetUserByDingtalkID("union-1"); err != store.ErrNotFound {
		t.Fatalf("lookup after unbind: err=%v", err)
	}
}

func TestClientReleaseManifest(t *testing.T) {
	h, s := newTestBackend(t)
	adminToken := adminLoginToken(t, h, s)

	// Publish a release.
	code, body := doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{
			"release": map[string]any{
				"version": "1.0.2",
				"notes":   "修复与改进",
				"url":     "https://download.example.com/vergen-1.0.2.app.tar.gz",
			},
		})
	if code != http.StatusOK {
		t.Fatalf("publish release: status=%d body=%v", code, body)
	}
	rel, _ := body["release"].(map[string]any)
	if rel == nil || rel["version"] != "1.0.2" || rel["url"] == nil {
		t.Fatalf("release view = %v", rel)
	}

	// The employee client reads it with a bearer token.
	hash, err := auth.HashPassword("emp-password-3")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("emp3", hash, "user", time.Now()); err != nil {
		t.Fatal(err)
	}
	code, body = login(t, h, "emp3", "emp-password-3")
	if code != http.StatusOK {
		t.Fatalf("emp login: status=%d", code)
	}
	empAccess, _ := body["access_token"].(string)
	code, body = doJSON(t, h, "GET", "/api/v1/client/update", empAccess, nil)
	if code != http.StatusOK || body["version"] != "1.0.2" {
		t.Fatalf("client update: status=%d body=%v", code, body)
	}

	// An invalid URL is rejected.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{
			"release": map[string]any{
				"version": "1.0.3",
				"url":     "postgres://nope",
			},
		})
	if code != http.StatusBadRequest {
		t.Fatalf("invalid release url: status=%d body=%v", code, body)
	}

	// Clearing the version unpublishes; clients then 404.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{"release": map[string]any{"version": ""}})
	if code != http.StatusOK || body["release"] != nil {
		t.Fatalf("clear release: status=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, "GET", "/api/v1/client/update", empAccess, nil)
	if code != http.StatusNotFound {
		t.Fatalf("update after clear: status=%d body=%v", code, body)
	}
}

func TestSubscriptionManagement(t *testing.T) {
	h, s := newTestBackend(t)
	adminToken := adminLoginToken(t, h, s)

	// Empty list.
	code, body := doJSON(t, h, "GET", "/api/v1/admin/subscriptions", adminToken, nil)
	if code != http.StatusOK {
		t.Fatalf("list: status=%d", code)
	}
	if subs, _ := body["subscriptions"].([]any); len(subs) != 0 {
		t.Fatalf("expected empty list, got %v", body)
	}

	// First subscription goes live immediately.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/subscriptions", adminToken,
		map[string]any{"name": "A", "url": "https://sub.example.com/a"})
	if code != http.StatusCreated {
		t.Fatalf("create A: status=%d body=%v", code, body)
	}
	sub, _ := body["subscription"].(map[string]any)
	idA := int64(sub["id"].(float64))
	if sub["enabled"] != true {
		t.Fatalf("first subscription should be active: %v", sub)
	}

	// Newer one stays a draft until activated.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/subscriptions", adminToken,
		map[string]any{"name": "B", "url": "https://sub.example.com/b"})
	if code != http.StatusCreated {
		t.Fatalf("create B: status=%d body=%v", code, body)
	}
	sub, _ = body["subscription"].(map[string]any)
	idB := int64(sub["id"].(float64))
	if sub["enabled"] != false {
		t.Fatalf("later subscription should stay draft: %v", sub)
	}

	// Editing an absent id 404s.
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/subscriptions/999", adminToken,
		map[string]any{"name": "x", "url": "https://sub.example.com/x"})
	if code != http.StatusNotFound {
		t.Fatalf("update missing: status=%d", code)
	}

	// Update B in place.
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/subscriptions/"+itoa(idB), adminToken,
		map[string]any{"name": "B2", "url": "https://sub.example.com/b2"})
	if code != http.StatusNoContent {
		t.Fatalf("update B: status=%d", code)
	}

	// Enable B; both A and B are now pickable and bootstrap defaults to the
	// first enabled entry.
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/subscriptions/"+itoa(idB)+"/enable", adminToken,
		map[string]any{"enabled": true})
	if code != http.StatusNoContent {
		t.Fatalf("enable B: status=%d", code)
	}
	hash, err := auth.HashPassword("emp-password-9")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("emp9", hash, "user", time.Now()); err != nil {
		t.Fatal(err)
	}
	code, body = login(t, h, "emp9", "emp-password-9")
	if code != http.StatusOK {
		t.Fatalf("emp login: status=%d", code)
	}
	empAccess, _ := body["access_token"].(string)
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusOK || body["subscription_url"] != "https://sub.example.com/a" {
		t.Fatalf("bootstrap after enable: status=%d body=%v", code, body["subscription_url"])
	}
	subs, _ := body["subscriptions"].([]any)
	if len(subs) != 2 {
		t.Fatalf("bootstrap subscriptions = %v", subs)
	}

	// Disabling A leaves B as the remaining pick.
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/subscriptions/"+itoa(idA)+"/enable", adminToken,
		map[string]any{"enabled": false})
	if code != http.StatusNoContent {
		t.Fatalf("disable A: status=%d", code)
	}
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusOK || body["subscription_url"] != "https://sub.example.com/b2" {
		t.Fatalf("bootstrap after disable: status=%d body=%v", code, body["subscription_url"])
	}
	subs, _ = body["subscriptions"].([]any)
	if len(subs) != 1 {
		t.Fatalf("bootstrap subscriptions after disable = %v", subs)
	}

	// Delete the active one; bootstrap falls back to empty.
	code, _ = doJSON(t, h, "DELETE", "/api/v1/admin/subscriptions/"+itoa(idB), adminToken, nil)
	if code != http.StatusNoContent {
		t.Fatalf("delete B: status=%d", code)
	}
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusOK || body["subscription_url"] != "" {
		t.Fatalf("bootstrap after delete: status=%d body=%v", code, body["subscription_url"])
	}
}

func TestAnnouncementManagement(t *testing.T) {
	h, s := newTestBackend(t)
	adminToken := adminLoginToken(t, h, s)

	// Empty list.
	code, body := doJSON(t, h, "GET", "/api/v1/admin/announcements", adminToken, nil)
	if code != http.StatusOK {
		t.Fatalf("list: status=%d", code)
	}
	if list, _ := body["announcements"].([]any); len(list) != 0 {
		t.Fatalf("expected empty list, got %v", body)
	}

	// Title required.
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/announcements", adminToken, map[string]any{"title": ""})
	if code != http.StatusBadRequest {
		t.Fatalf("empty title: status=%d", code)
	}

	// First one is delivered immediately.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/announcements", adminToken,
		map[string]any{"title": "维护公告", "content": "周三例行维护"})
	if code != http.StatusCreated {
		t.Fatalf("create: status=%d body=%v", code, body)
	}
	first, _ := body["announcement"].(map[string]any)
	idA := int64(first["id"].(float64))
	if first["enabled"] != true {
		t.Fatalf("first announcement should be enabled: %v", first)
	}

	// Employee bootstrap sees it.
	hash, err := auth.HashPassword("emp-password-8")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("emp8", hash, "user", time.Now()); err != nil {
		t.Fatal(err)
	}
	code, body = login(t, h, "emp8", "emp-password-8")
	if code != http.StatusOK {
		t.Fatalf("emp login: status=%d", code)
	}
	empAccess, _ := body["access_token"].(string)
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusOK {
		t.Fatalf("bootstrap: status=%d", code)
	}
	ann, _ := body["announcement"].(map[string]any)
	if ann == nil || ann["title"] != "维护公告" {
		t.Fatalf("bootstrap announcement = %v", ann)
	}

	// A second stays off until enabled.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/announcements", adminToken,
		map[string]any{"title": "升级通知", "content": "客户端 1.0.1 发布"})
	if code != http.StatusCreated {
		t.Fatalf("create B: status=%d", code)
	}
	second, _ := body["announcement"].(map[string]any)
	idB := int64(second["id"].(float64))
	if second["enabled"] != false {
		t.Fatalf("later announcement should stay off: %v", second)
	}

	// Editing in place.
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/announcements/"+itoa(idA), adminToken,
		map[string]any{"title": "维护公告 v2", "content": "改期到周五"})
	if code != http.StatusNoContent {
		t.Fatalf("update: status=%d", code)
	}
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/announcements/"+itoa(idB)+"/enable", adminToken,
		map[string]any{"enabled": true})
	if code != http.StatusNoContent {
		t.Fatalf("enable B: status=%d", code)
	}
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusOK {
		t.Fatalf("bootstrap after enable: status=%d", code)
	}
	ann, _ = body["announcement"].(map[string]any)
	if ann == nil || ann["title"] != "升级通知" {
		t.Fatalf("bootstrap should switch to B, got %v", ann)
	}

	// Disable everything; the bootstrap banner disappears.
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/announcements/"+itoa(idB)+"/enable", adminToken,
		map[string]any{"enabled": false})
	if code != http.StatusNoContent {
		t.Fatalf("disable B: status=%d", code)
	}
	code, body = doJSON(t, h, "GET", "/api/v1/client/bootstrap", empAccess, nil)
	if code != http.StatusOK || body["announcement"] != nil {
		t.Fatalf("bootstrap should lose the banner, got %v", body["announcement"])
	}

	// Delete.
	code, _ = doJSON(t, h, "DELETE", "/api/v1/admin/announcements/"+itoa(idA), adminToken, nil)
	if code != http.StatusNoContent {
		t.Fatalf("delete: status=%d", code)
	}
}

func TestAuthCapabilities(t *testing.T) {
	h, s := newTestBackend(t)

	// No DingTalk configuration: QR login must not be advertised so the
	// desktop hides the scan tab entirely.
	code, body := doJSON(t, h, "GET", "/api/v1/auth/capabilities", "", nil)
	if code != http.StatusOK || body["dingtalk_qr"] != false {
		t.Fatalf("capabilities unconfigured: status=%d body=%v", code, body)
	}

	adminToken := adminLoginToken(t, h, s)
	code, _ = doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{"dingtalk_app_key": "app-key", "dingtalk_app_secret": "secret"})
	if code != http.StatusOK {
		t.Fatalf("set dingtalk settings: status=%d", code)
	}

	code, body = doJSON(t, h, "GET", "/api/v1/auth/capabilities", "", nil)
	if code != http.StatusOK || body["dingtalk_qr"] != true {
		t.Fatalf("capabilities configured: status=%d body=%v", code, body)
	}
}
