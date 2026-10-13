package store

import (
	"database/sql"
	"path/filepath"
	"regexp"
	"testing"
	"time"
)

func TestGetOrCreateDingtalkUser(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	now := time.Unix(1_700_000_000, 0)

	if _, err := s.GetOrCreateDingtalkUser("", "", now); err == nil {
		t.Fatal("empty union ID accepted")
	}

	const callers = 16
	type result struct {
		user *User
		err  error
	}
	start := make(chan struct{})
	results := make(chan result, callers)
	for range callers {
		go func() {
			<-start
			u, err := s.GetOrCreateDingtalkUser("new-union", " 张三 ", now)
			results <- result{user: u, err: err}
		}()
	}
	close(start)
	var userID int64
	usernamePattern := regexp.MustCompile(`^dingtalk_[a-zA-Z0-9_.-]{1,23}$`)
	for range callers {
		res := <-results
		if res.err != nil {
			t.Fatal(res.err)
		}
		u := res.user
		if u == nil {
			t.Fatal("missing created user")
		}
		if userID != 0 && u.ID != userID {
			t.Fatalf("concurrent login created another account: %d != %d", u.ID, userID)
		}
		userID = u.ID
		if u.PasswordHash != "" || u.Role != "user" || u.Status != "active" || u.DingTalkUserID != "new-union" || u.DisplayName != "张三" {
			t.Fatalf("unexpected account: %+v", u)
		}
		if !usernamePattern.MatchString(u.Username) {
			t.Fatalf("invalid generated username: %q", u.Username)
		}
	}

	sameName, err := s.GetOrCreateDingtalkUser("other-union", "张三", now)
	if err != nil {
		t.Fatal(err)
	}
	if sameName.ID == userID || sameName.DisplayName != "张三" || sameName.DingTalkUserID != "other-union" {
		t.Fatalf("same display name merged distinct users: %+v", sameName)
	}

	bound, err := s.CreateUser("existing-admin", "existing-password-hash", "admin", now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetUserDingtalkID(bound.ID, "bound-union", now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetUserStatus(bound.ID, "disabled", now); err != nil {
		t.Fatal(err)
	}
	bound, err = s.GetUser(bound.ID)
	if err != nil {
		t.Fatal(err)
	}
	reused, err := s.GetOrCreateDingtalkUser("bound-union", " 李四 ", now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	bound.DisplayName, bound.UpdatedAt = "李四", now.Add(time.Hour).Unix()
	if *reused != *bound {
		t.Fatalf("existing account changed: got %+v, want %+v", reused, bound)
	}
	for _, displayName := range []string{"", " \t\n"} {
		reused, err = s.GetOrCreateDingtalkUser("bound-union", displayName, now.Add(2*time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		if *reused != *bound {
			t.Fatalf("empty display name changed existing account: got %+v, want %+v", reused, bound)
		}
	}
	stored, err := s.GetUser(bound.ID)
	if err != nil {
		t.Fatal(err)
	}
	if *stored != *bound {
		t.Fatalf("display name update was not persisted: got %+v, want %+v", stored, bound)
	}
	users, err := s.ListUsers()
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 3 {
		t.Fatalf("got %d accounts, want 3", len(users))
	}
}

func TestUserDisplayNameMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = legacy.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL UNIQUE COLLATE NOCASE,
		password_hash TEXT NOT NULL DEFAULT '',
		dingtalk_userid TEXT NOT NULL DEFAULT '',
		role TEXT NOT NULL DEFAULT 'user',
		status TEXT NOT NULL DEFAULT 'active',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		last_seen_at INTEGER,
		last_version TEXT NOT NULL DEFAULT '',
		last_os TEXT NOT NULL DEFAULT ''
	);
	INSERT INTO users VALUES (7, 'legacy-admin', 'password-hash', 'legacy-union', 'admin', 'disabled', 100, 200, 300, '0.1.0', 'macos');`)
	closeErr := legacy.Close()
	if err != nil {
		t.Fatal(err)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	want := User{
		ID: 7, Username: "legacy-admin", PasswordHash: "password-hash", DingTalkUserID: "legacy-union",
		Role: "admin", Status: "disabled", CreatedAt: 100, UpdatedAt: 200,
		LastSeenAt: sql.NullInt64{Int64: 300, Valid: true}, LastVersion: "0.1.0", LastOS: "macos",
	}
	for range 2 {
		s, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		got, err := s.GetUser(want.ID)
		closeErr := s.Close()
		if err != nil {
			t.Fatal(err)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		if *got != want {
			t.Fatalf("migration changed existing account: got %+v, want %+v", got, want)
		}
	}
}
