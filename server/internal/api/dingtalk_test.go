package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type dingtalkTestTransport func(*http.Request) (*http.Response, error)

func (f dingtalkTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestDingtalkCallback(t *testing.T) {
	for _, tc := range []struct {
		name           string
		client         string
		androidPackage string
		configuredCorp string
		tokenCorp      string
		unionID        string
		tokenStatus    int
		userStatus     int
		authError      string
		newUser        bool
		omitRepeatNick bool
		disabled       bool
		wantFailure    string
	}{
		{name: "personal login", unionID: "union-1"},
		{name: "Android login", client: "android", unionID: "union-1"},
		{name: "Android alpha login", client: "android", androidPackage: "io.github.vergen.android.alpha", unionID: "union-1"},
		{name: "Android meta login", client: "android", androidPackage: "io.github.vergen.android.meta", unionID: "union-1"},
		{name: "organization login", configuredCorp: "corp-1", tokenCorp: "corp-1", unionID: "union-1"},
		{name: "wrong organization", configuredCorp: "corp-1", tokenCorp: "corp-2", unionID: "union-1", wantFailure: "组织不符"},
		{name: "missing organization", configuredCorp: "corp-1", unionID: "union-1", wantFailure: "组织不符"},
		{name: "new user", unionID: "union-other", newUser: true},
		{name: "nickname omitted on repeat login", unionID: "union-other", newUser: true, omitRepeatNick: true},
		{name: "new organization user", configuredCorp: "corp-1", tokenCorp: "corp-1", unionID: "union-other", newUser: true},
		{name: "new user from wrong organization", configuredCorp: "corp-1", tokenCorp: "corp-2", unionID: "union-other", newUser: true, wantFailure: "组织不符"},
		{name: "disabled user", unionID: "union-1", disabled: true, wantFailure: "已停用"},
		{name: "token rejected", unionID: "union-1", tokenStatus: http.StatusUnauthorized, wantFailure: "钉钉验证失败"},
		{name: "user info rejected", unionID: "union-1", userStatus: http.StatusForbidden, wantFailure: "钉钉验证失败"},
		{name: "missing user identity", wantFailure: "钉钉验证失败"},
		{name: "authorization denied", authError: "untrusted-access-denied", wantFailure: "未完成钉钉授权，请重新登录"},
		{name: "Android authorization denied", client: "android", authError: "untrusted-access-denied", wantFailure: "未完成钉钉授权，请重新登录"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, s := newTestBackend(t)
			for key, value := range map[string]string{
				settingDingtalkKey: "app-key", settingDingtalkSecret: "app-secret", settingDingtalkCorp: tc.configuredCorp,
			} {
				if err := s.SetSetting(key, value); err != nil {
					t.Fatal(err)
				}
			}
			u, err := s.CreateUser("employee", "unused-password-hash", "user", time.Now())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.SetUserDingtalkID(u.ID, "union-1", time.Now()); err != nil {
				t.Fatal(err)
			}
			if tc.disabled {
				if _, err := s.SetUserStatus(u.ID, "disabled", time.Now()); err != nil {
					t.Fatal(err)
				}
			}

			calls := 0
			nick := "张三"
			originalTransport := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = originalTransport })
			http.DefaultTransport = dingtalkTestTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Scheme != "https" || r.URL.Host != "api.dingtalk.com" {
					t.Fatalf("unexpected DingTalk request: %s", r.URL)
				}
				status := http.StatusOK
				var payload map[string]string
				switch calls {
				case 1:
					if r.Method != http.MethodPost || r.URL.Path != "/v1.0/oauth2/userAccessToken" {
						t.Fatalf("token request: %s %s", r.Method, r.URL)
					}
					var body map[string]string
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					if body["clientId"] != "app-key" || body["clientSecret"] != "app-secret" || body["code"] != "auth-code" || body["grantType"] != "authorization_code" {
						t.Fatalf("token payload: %v", body)
					}
					payload = map[string]string{"accessToken": "user-access-token", "corpId": tc.tokenCorp}
					if tc.tokenStatus != 0 {
						status = tc.tokenStatus
					}
				case 2:
					if r.Method != http.MethodGet || r.URL.Path != "/v1.0/contact/users/me" || r.Header.Get("x-acs-dingtalk-access-token") != "user-access-token" {
						t.Fatalf("user info request: %s %s, access token %q", r.Method, r.URL, r.Header.Get("x-acs-dingtalk-access-token"))
					}
					payload = map[string]string{"unionId": tc.unionID}
					if nick != "" {
						payload["nick"] = nick
					}
					if tc.userStatus != 0 {
						status = tc.userStatus
					}
				default:
					t.Fatalf("unexpected extra DingTalk request: %s", r.URL)
				}
				body, err := json.Marshal(payload)
				if err != nil {
					t.Fatal(err)
				}
				return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(body)))}, nil
			})

			attempts := 1
			if tc.newUser && tc.wantFailure == "" {
				attempts = 2
			}
			var firstID int64
			var firstUsername string
			for attempt := 0; attempt < attempts; attempt++ {
				calls = 0
				if attempt > 0 {
					nick = "李四"
					if tc.omitRepeatNick {
						nick = ""
					}
				}
				wantDisplayName := nick
				if wantDisplayName == "" {
					wantDisplayName = "张三"
				}
				var startBody any
				if tc.client != "" {
					startBody = map[string]string{"client": tc.client, "android_package": tc.androidPackage}
				}
				status, body := doJSON(t, h, http.MethodPost, "/api/v1/auth/dingtalk/qr/start", "", startBody)
				if status != http.StatusOK {
					t.Fatalf("QR start: status=%d body=%v", status, body)
				}
				qrURL, err := url.Parse(body["qr_url"].(string))
				if err != nil {
					t.Fatal(err)
				}
				wantScope := "openid"
				if tc.configuredCorp != "" {
					wantScope += " corpid"
				}
				if scope := qrURL.Query().Get("scope"); scope != wantScope {
					t.Fatalf("QR scope = %q, want %q", scope, wantScope)
				}
				state := qrURL.Query().Get("state")
				if state == "" {
					t.Fatal("QR start returned no state")
				}
				callback := "/api/v1/auth/dingtalk/callback?authCode=auth-code&state=" + url.QueryEscape(state)
				if tc.authError != "" {
					invalid := httptest.NewRecorder()
					h.ServeHTTP(invalid, httptest.NewRequest(http.MethodGet, "/api/v1/auth/dingtalk/callback?error="+url.QueryEscape(tc.authError)+"&state=invalid-state", nil))
					if strings.Contains(invalid.Body.String(), "vergen://") {
						t.Fatal("unmatched callback offered an app return link")
					}
					status, pending := doJSON(t, h, http.MethodPost, "/api/v1/auth/dingtalk/qr/poll", "", map[string]any{"session_id": body["session_id"]})
					if status != http.StatusOK || pending["status"] != "pending" {
						t.Fatalf("unmatched error callback changed session: status=%d body=%v", status, pending)
					}
					callback = "/api/v1/auth/dingtalk/callback?error=" + url.QueryEscape(tc.authError) + "&state=" + url.QueryEscape(state)
				}
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, callback, nil))
				if rec.Code != http.StatusOK {
					t.Fatalf("callback: status=%d", rec.Code)
				}
				if tc.authError != "" && strings.Contains(rec.Body.String(), tc.authError) {
					t.Fatal("callback echoed the untrusted authorization error")
				}
				if hasReturnLink := strings.Contains(rec.Body.String(), `href="vergen://auth/dingtalk"`); hasReturnLink != (tc.client == "android") {
					t.Fatalf("app return link = %v for client %q", hasReturnLink, tc.client)
				}
				if tc.client == "android" {
					wantPackage := tc.androidPackage
					if wantPackage == "" {
						wantPackage = "io.github.vergen.android"
					}
					if !strings.Contains(rec.Body.String(), `data-package="`+wantPackage+`"`) ||
						!strings.Contains(rec.Body.String(), "dd.device.launcher.launchApp") ||
						!strings.Contains(rec.Body.String(), "EnterpriseDingtalkReturnActivity") {
						t.Fatal("Android callback omitted its native return target")
					}
				} else if strings.Contains(rec.Body.String(), "dingtalk-jsapi") {
					t.Fatal("desktop callback loaded the Android return SDK")
				}
				for _, credential := range []string{state, body["session_id"].(string), "auth-code", "user-access-token"} {
					if strings.Contains(rec.Body.String(), credential) {
						t.Fatal("callback page exposed a login credential")
					}
				}
				wantCalls := 2
				if tc.authError != "" {
					wantCalls = 0
				} else if tc.tokenStatus != 0 {
					wantCalls = 1
				}
				if calls != wantCalls {
					t.Fatalf("DingTalk requests = %d, want %d", calls, wantCalls)
				}
				status, body = doJSON(t, h, http.MethodPost, "/api/v1/auth/dingtalk/qr/poll", "", map[string]any{"session_id": body["session_id"]})
				if status != http.StatusOK {
					t.Fatalf("QR poll: status=%d body=%v", status, body)
				}
				if tc.wantFailure != "" {
					if body["status"] != "fail" || body["message"] != tc.wantFailure || body["access_token"] != nil || body["refresh_token"] != nil {
						t.Fatalf("failed login returned: %v", body)
					}
					users, err := s.ListUsers()
					if err != nil || len(users) != 1 {
						t.Fatalf("failed login created a user: count=%d err=%v", len(users), err)
					}
					return
				}
				access, _ := body["access_token"].(string)
				refresh, _ := body["refresh_token"].(string)
				if body["status"] != "ok" || access == "" || refresh == "" {
					t.Fatalf("successful login returned: %v", body)
				}
				account, err := s.GetUserByDingtalkID(tc.unionID)
				if err != nil {
					t.Fatal(err)
				}
				public, _ := body["user"].(map[string]any)
				if account.Username == "" || body["username"] != account.Username || public["id"] != float64(account.ID) || public["username"] != account.Username {
					t.Fatalf("login identity does not match account: body=%v account=%+v", body, account)
				}
				if public["display_name"] != wantDisplayName || account.DisplayName != wantDisplayName {
					t.Fatalf("login display name = %v, stored = %q, want %q", public["display_name"], account.DisplayName, wantDisplayName)
				}
				if attempt == 0 {
					firstID, firstUsername = account.ID, account.Username
				} else if account.ID != firstID || account.Username != firstUsername {
					t.Fatalf("repeat login changed identity: first=%d/%s current=%d/%s", firstID, firstUsername, account.ID, account.Username)
				}

				wantUserCount := 1
				if tc.newUser {
					wantUserCount = 2
					if account.ID == u.ID || account.Role != "user" || account.PasswordHash != "" {
						t.Fatalf("auto-created account has unexpected identity or credentials: %+v", account)
					}
				} else if account.ID != u.ID || account.Username != "employee" {
					t.Fatalf("existing account was not reused: %+v", account)
				}
				users, err := s.ListUsers()
				if err != nil || len(users) != wantUserCount {
					t.Fatalf("user count=%d, want %d; err=%v", len(users), wantUserCount, err)
				}
				status, body = doJSON(t, h, http.MethodGet, "/api/v1/client/bootstrap", access, nil)
				if status != http.StatusOK {
					t.Fatalf("issued access token rejected: status=%d body=%v", status, body)
				}
				bootstrapUser, _ := body["user"].(map[string]any)
				if bootstrapUser["display_name"] != wantDisplayName {
					t.Fatalf("bootstrap display name = %v, want %q", bootstrapUser["display_name"], wantDisplayName)
				}
				status, body = doJSON(t, h, http.MethodGet, "/api/v1/admin/users", access, nil)
				if status != http.StatusForbidden {
					t.Fatalf("employee accessed admin API: status=%d body=%v", status, body)
				}
			}
		})
	}
}

func TestDingtalkStartRejectsUntrustedAndroidPackage(t *testing.T) {
	h, s := newTestBackend(t)
	for key, value := range map[string]string{settingDingtalkKey: "app-key", settingDingtalkSecret: "app-secret"} {
		if err := s.SetSetting(key, value); err != nil {
			t.Fatal(err)
		}
	}
	status, _ := doJSON(t, h, http.MethodPost, "/api/v1/auth/dingtalk/qr/start", "", map[string]any{
		"client": "android", "android_package": "untrusted.app",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("untrusted Android package status = %d", status)
	}
}
