package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIOSPoolAuthorization(t *testing.T) {
	_, s := newTestBackend(t)
	a, err := NewServer(s, "")
	if err != nil {
		t.Fatal(err)
	}
	var calls []iosPoolRequest
	a.iosPool = func(_ context.Context, req iosPoolRequest) (iosPoolReply, error) {
		calls = append(calls, req)
		return iosPoolReply{URL: "https://example.org/sub/personal/clash.yaml"}, nil
	}
	h, err := a.Handler()
	if err != nil {
		t.Fatal(err)
	}
	employee := withEmployeeDownloadSession(t, h, s)
	const adminPath = "/api/v1/admin/ios/subscriptions"
	const claimPath = "/api/v1/download/ios/claim"
	if code, _ := doJSON(t, h, "POST", claimPath, "", nil); code != 401 {
		t.Fatal("anonymous claim accepted")
	}
	if code, _ := doJSON(t, employee, "POST", adminPath+"/import", "", nil); code != 401 {
		t.Fatal("download session could manage pool")
	}
	if code, _ := doJSON(t, employee, "GET", "/api/v1/download/releases", "", nil); code != 200 || len(calls) != 0 {
		t.Fatal("opening the download page allocated an address")
	}
	req := httptest.NewRequest(http.MethodPost, claimPath, strings.NewReader("owner=other"))
	res := httptest.NewRecorder()
	employee.ServeHTTP(res, req)
	if res.Code != 415 {
		t.Fatal("form claim accepted")
	}
	code, body := doJSON(t, employee, "POST", claimPath, "", map[string]string{"owner": "other"})
	if code != 200 || body["url"] == nil || len(calls) != 1 || len(calls[0].Owner) != 64 || calls[0].Owner == "other" || calls[0].Action != "claim" {
		t.Fatal("claim did not use signed-in employee")
	}
	if code, _ := doJSON(t, employee, "GET", adminPath+"/7", "", nil); code != http.StatusUnauthorized {
		t.Fatal("employee could view another subscription")
	}
	token := adminLoginToken(t, h, s)
	input := map[string]string{"text": "one\ntwo", "action": "revoke"}
	if code, result := doJSON(t, h, "POST", adminPath+"/import", token, input); code != http.StatusOK || result["skipped"] == nil || calls[len(calls)-1].Action != "import" || calls[len(calls)-1].Text != input["text"] {
		t.Fatal("admin import did not forward the input to the importer")
	}
	if code, detail := doJSON(t, h, "GET", adminPath+"/7", token, nil); code != http.StatusOK || detail["url"] == nil || calls[len(calls)-1].Action != "address" {
		t.Fatal("admin could not view a subscription without claiming it")
	}
	if code, _ := doJSON(t, h, "DELETE", adminPath+"/7", token, nil); code != 200 || calls[len(calls)-1].ID != 7 {
		t.Fatal("admin could not revoke selected address")
	}
}
