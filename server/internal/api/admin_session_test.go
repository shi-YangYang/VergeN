package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAdminBrowserSession(t *testing.T) {
	h, s := newTestBackend(t)
	adminLoginToken(t, h, s)
	post := func(action, body string, c *http.Cookie) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "https://ops.example.com/api/v1/admin/session/"+action, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if c != nil {
			req.AddCookie(c)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		result := map[string]any{}
		if w.Body.Len() != 0 {
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return w, result
	}
	const sessionBody = `{"username":"admin","password":"admin-password-1"}`
	const deviceBody = `{"username":"admin","password":"admin-password-1","remember":true}`
	res, data := post("login", sessionBody, nil)
	if res.Code != 200 || len(res.Result().Cookies()) != 0 || data["refresh_token"] == nil {
		t.Fatal("default login must remain tab only")
	}
	res, data = post("login", deviceBody, nil)
	cookies := res.Result().Cookies()
	if res.Code != 200 || len(cookies) != 1 || data["refresh_token"] != nil {
		t.Fatal("persistent credential must only be returned in a cookie")
	}
	c := cookies[0]
	if c.MaxAge != 7*86400 || !c.HttpOnly || !c.Secure || c.Name != "__Host-vergen_admin_remember" || c.SameSite != http.SameSiteLaxMode {
		t.Fatal("incorrect remember-cookie scope or lifetime")
	}
	key := deviceGrant(c.Value)
	id, _, end, err := s.GetValidRefreshToken(key, time.Now().Unix())
	if err != nil || end != c.Expires.Unix() {
		t.Fatal("cookie and grant deadlines differ")
	}
	if code, _ := doJSON(t, h, "POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": c.Value}); code != 401 {
		t.Fatal("remembered cookie accepted as a native refresh token")
	}
	res, data = post("restore", "{}", c)
	access, _ := data["access_token"].(string)
	if res.Code != 200 || len(res.Result().Cookies()) != 0 || access == "" || data["refresh_token"] != nil {
		t.Fatal("restore must not renew or disclose the device credential")
	}
	if code, _ := doJSON(t, h, "GET", "/api/v1/admin/dashboard", access, nil); code != 200 {
		t.Fatal("could not use short-lived access")
	}
	if _, _, after, err := s.GetValidRefreshToken(key, time.Now().Unix()); err != nil || after != end {
		t.Fatal("restore slid the deadline")
	}
	// Seed the final seconds of a seven-day grant without advancing the system clock.
	near := &http.Cookie{Name: c.Name, Value: "near-deadline"}
	now := time.Now().Unix()
	if err := s.CreateRefreshToken(id, deviceGrant(near.Value), now+12, now-7*86400+12); err != nil {
		t.Fatal(err)
	}
	res, data = post("restore", "{}", near)
	ttl, _ := data["expires_in"].(float64)
	if res.Code != 200 || ttl <= 0 || ttl > 12 {
		t.Fatal("access extended beyond device grant")
	}
	res, _ = post("logout", "{}", c)
	if res.Code != 204 || len(res.Result().Cookies()) != 1 || res.Result().Cookies()[0].MaxAge >= 0 {
		t.Fatal("logout did not expire the cookie")
	}
	if res, _ = post("restore", "{}", c); res.Code != 401 {
		t.Fatal("logged-out grant still accepted")
	}
	if code, _ := doJSON(t, h, "GET", "/api/v1/admin/dashboard", access, nil); code != 401 {
		t.Fatal("logged-out access still accepted")
	}
	if _, err := s.SetUserStatus(id, "disabled", time.Now()); err != nil {
		t.Fatal(err)
	}
	if res, _ = post("restore", "{}", near); res.Code != 401 {
		t.Fatal("disabled administrator restored a session")
	}
}

func TestAdminBrowserSessionRequiresSameOriginJSON(t *testing.T) {
	h, _ := newTestBackend(t)
	for _, tc := range []struct {
		origin, ct string
		status     int
	}{
		{"https://unrelated.example", "application/json", 403},
		{"https://ops.example.com", "text/plain", 415},
	} {
		r := httptest.NewRequest("POST", "https://ops.example.com/api/v1/admin/session/logout", strings.NewReader("{}"))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", tc.ct)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("got %d; want %d", w.Code, tc.status)
		}
	}
}
