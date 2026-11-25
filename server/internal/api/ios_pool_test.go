package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIOSPoolAuthorization(t *testing.T) {
	h, s := newTestBackend(t)
	employee := withEmployeeDownloadSession(t, h, s)
	const adminPath = "/api/v1/admin/ios/subscriptions"
	const claimPath = "/api/v1/download/ios/claim"
	if code, _ := doJSON(t, h, "POST", claimPath, "", nil); code != 401 {
		t.Fatal("anonymous claim accepted")
	}
	if code, _ := doJSON(t, employee, "POST", adminPath+"/import", "", nil); code != 401 {
		t.Fatal("download session could manage pool")
	}
	if code, _ := doJSON(t, employee, "GET", adminPath+"/1", "", nil); code != 401 {
		t.Fatal("employee could read admin link")
	}
	req := httptest.NewRequest(http.MethodPost, claimPath, strings.NewReader("owner=other"))
	res := httptest.NewRecorder()
	employee.ServeHTTP(res, req)
	if res.Code != 415 {
		t.Fatal("form claim accepted")
	}

	token := adminLoginToken(t, h, s)
	link := "https://example.org/sub/" + strings.Repeat("a", 64) + "/clash.yaml"
	input := map[string]string{"text": link + "\n" + link}
	if code, result := doJSON(t, h, "POST", adminPath+"/import", token, input); code != 200 || result["added"] != float64(1) || result["skipped"] != float64(1) {
		t.Fatalf("admin import: %d %v", code, result)
	}
	if code, _ := doJSON(t, employee, "GET", "/api/v1/download/releases", "", nil); code != 200 {
		t.Fatal("download page failed")
	}
	// Visiting the authenticated subscription dialog must not consume a link.
	open := httptest.NewRecorder()
	employee.ServeHTTP(open, httptest.NewRequest(http.MethodGet, iosDownloadPath, nil))
	if open.Code != http.StatusOK || strings.Contains(open.Body.String(), link) {
		t.Fatal("opening subscription dialog failed or disclosed the address")
	}
	code, list := doJSON(t, h, "GET", adminPath, token, nil)
	if code != 200 {
		t.Fatalf("list: %d", code)
	}
	row := list["items"].([]any)[0].(map[string]any)
	if row["status"] != "available" || row["address_preview"] == link {
		t.Fatal("unclaimed link was assigned or disclosed")
	}
	if code, result := doJSON(t, h, "GET", adminPath+"/1", token, nil); code != 200 || result["url"] != link {
		t.Fatal("admin could not view address")
	}
	for _, owner := range []string{"forged", "another"} {
		if code, result := doJSON(t, employee, "POST", claimPath, "", map[string]string{"owner": owner}); code != 200 || result["url"] != link {
			t.Fatalf("claim: %d %v", code, result)
		}
	}
	if code, _ := doJSON(t, h, "DELETE", adminPath+"/1", token, nil); code != 200 {
		t.Fatal("revoke failed")
	}
	if code, _ := doJSON(t, employee, "POST", claimPath, "", nil); code != 403 {
		t.Fatalf("revoked employee got %d", code)
	}
}
