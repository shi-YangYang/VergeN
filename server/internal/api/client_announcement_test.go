package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"

	"testing"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
)

func TestClientAnnouncement(t *testing.T) {
	h, s := newTestBackend(t)
	const path = "/api/v1/client/announcement"
	for _, browser := range []http.Handler{h, withEmployeeDownloadSession(t, h, s)} {
		if code, _ := doJSON(t, browser, "GET", path, "", nil); code != http.StatusUnauthorized {
			t.Fatalf("no client session: got %d", code)
		}
	}
	now := time.Now()
	hash, err := auth.HashPassword("password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("employee", hash, "user", now); err != nil {
		t.Fatal(err)
	}
	status, body := login(t, h, "employee", "password")
	if status != 200 {
		t.Fatal(status)
	}
	read := func() *store.DeliveredAnnouncement {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+body["access_token"].(string))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(rec.Result())
		}
		var response map[string]*store.DeliveredAnnouncement
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		v, exists := response["announcement"]
		if !exists {
			t.Fatal("missing announcement field")
		}
		return v
	}
	if read() != nil {
		t.Fatal("unpublished announcement")
	}
	row, err := s.CreateAnnouncement("维护", "原时间", now)
	if err != nil {
		t.Fatal(err)
	}
	first := read()
	if first == nil || first.ID != row.ID || first.Title != row.Title || first.Content != row.Content || first.Revision == "" || *read() != *first {
		t.Fatalf("unexpected or unstable published announcement: %#v", first)
	}
	if ok, err := s.UpdateAnnouncement(row.ID, row.Title, "改期", now); !ok || err != nil {
		t.Fatal(ok, err)
	}
	edited := read()
	if edited == nil || edited.Content != "改期" || edited.Revision == first.Revision {
		t.Fatal("same-second edit did not change revision")
	}
	next, err := s.CreateAnnouncement(row.Title, "改期", now)
	if err != nil {
		t.Fatal(err)
	}
	if got := read(); got == nil || *got != *edited {
		t.Fatal("draft replaced active announcement")
	}
	if ok, err := s.EnableAnnouncement(row.ID, false); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if read() != nil {
		t.Fatal("withdrawn announcement still served")
	}
	if ok, err := s.EnableAnnouncement(next.ID, true); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if got := read(); got == nil || got.ID != next.ID || got.Revision == edited.Revision {
		t.Fatal("new announcement reused the old revision")
	}
	if ok, err := s.DeleteAnnouncement(next.ID); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if read() != nil {
		t.Fatal("deleted announcement still served")
	}
}

func TestClientAnnouncementAcknowledgement(t *testing.T) {
	h, s := newTestBackend(t)
	const path = "/api/v1/client/announcement"
	now := time.Now()
	hash, err := auth.HashPassword("password")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"alice", "bob"} {
		if _, err := s.CreateUser(name, hash, "user", now); err != nil {
			t.Fatal(err)
		}
	}
	session := func(name string) string {
		t.Helper()
		code, body := login(t, h, name, "password")
		if code != http.StatusOK {
			t.Fatal(code, body)
		}
		return body["access_token"].(string)
	}
	read := func(token string) map[string]any {
		t.Helper()
		code, body := doJSON(t, h, "GET", path, token, nil)
		if code != http.StatusOK {
			t.Fatal(code, body)
		}
		v, _ := body["announcement"].(map[string]any)
		return v
	}
	ack := func(token string, notice map[string]any, want int) {
		t.Helper()
		code, body := doJSON(t, h, "POST", path+"/ack", token, notice)
		if code != want {
			t.Fatalf("ack: status=%d want=%d body=%v", code, want, body)
		}
	}
	alice, bob := session("alice"), session("bob")
	first, err := s.CreateAnnouncement("A", "one", now)
	if err != nil {
		t.Fatal(err)
	}
	old := read(alice)
	identity := func(row map[string]any) map[string]any {
		return map[string]any{"id": row["id"], "revision": row["revision"]}
	}
	if _, err := s.UpdateAnnouncement(first.ID, "A", "two", now); err != nil {
		t.Fatal(err)
	}
	edited := read(alice)
	version, err := s.ConfigVersion()
	if err != nil {
		t.Fatal(err)
	}
	ack("", identity(old), http.StatusUnauthorized)
	if c, _ := doJSON(t, withEmployeeDownloadSession(t, h, s), "POST", path+"/ack", "", identity(old)); c != http.StatusUnauthorized {
		t.Fatalf("download session acknowledged announcement: %d", c)
	}
	for _, invalid := range []map[string]any{{"id": 0, "revision": old["revision"]}, {"id": first.ID, "revision": "BAD"}} {
		ack(alice, invalid, http.StatusBadRequest)
	}
	ack(alice, map[string]any{"id": first.ID, "revision": strings.Repeat("a", 64)}, http.StatusConflict)
	ack(alice, identity(old), http.StatusNoContent)
	if got := read(alice); got["revision"] != edited["revision"] {
		t.Fatal("late acknowledgement hid edited version", got)
	}
	ack(alice, identity(edited), http.StatusNoContent)
	ack(alice, identity(edited), http.StatusNoContent)
	if got := read(session("alice")); got != nil {
		t.Fatal("second device did not honor receipt", got)
	}
	if got := read(bob); got["revision"] != edited["revision"] {
		t.Fatal("receipt crossed accounts", got)
	}
	if v, err := s.ConfigVersion(); err != nil || v != version {
		t.Fatal("ack unexpectedly invalidated bootstrap", v, err)
	}
	if _, err := s.UpdateAnnouncement(first.ID, "A", "one", now); err != nil {
		t.Fatal(err)
	}
	if got := read(alice); got != nil {
		t.Fatal("reissued text lost historical receipt", got)
	}
	if _, err := s.DeleteAnnouncement(first.ID); err != nil {
		t.Fatal(err)
	}
	ack(bob, identity(old), http.StatusNoContent)
}
