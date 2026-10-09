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

	// Ops sets the company subscription URL.
	code, body = doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{"subscription_url": "https://ops.example.com/sub/company"})
	if code != http.StatusOK {
		t.Fatalf("set settings: status=%d body=%v", code, body)
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

	code, _ := doJSON(t, h, "POST", "/api/v1/admin/settings", adminToken,
		map[string]any{"subscription_url": "not-a-url"})
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
