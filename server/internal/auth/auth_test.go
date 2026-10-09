package auth

import (
	"testing"
	"time"
)

func TestPasswordHashRoundtrip(t *testing.T) {
	hash, err := HashPassword("secret-pw-123")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if ok, err := VerifyPassword(hash, "secret-pw-123"); err != nil || !ok {
		t.Fatalf("expected valid password, ok=%v err=%v", ok, err)
	}
	if ok, err := VerifyPassword(hash, "wrong-pw"); err != nil || ok {
		t.Fatalf("expected invalid password, ok=%v err=%v", ok, err)
	}
	if _, err := VerifyPassword("garbage", "x"); err == nil {
		t.Fatal("expected error for malformed hash")
	}
}

func TestAccessTokenRoundtrip(t *testing.T) {
	secret := []byte("test-secret")
	tok, err := IssueAccessToken(secret, 42, "admin", time.Minute)
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	uid, role, err := ParseAccessToken(secret, tok)
	if err != nil || uid != 42 || role != "admin" {
		t.Fatalf("uid=%d role=%q err=%v", uid, role, err)
	}
	if _, _, err := ParseAccessToken([]byte("other"), tok); err == nil {
		t.Fatal("expected error for wrong secret")
	}
	expired, err := IssueAccessToken(secret, 42, "user", -time.Minute)
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	if _, _, err := ParseAccessToken(secret, expired); err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(time.Hour, 3)
	key := "ip|user"
	for range 3 {
		if l.Blocked(key) {
			t.Fatal("expected not blocked before limit")
		}
		l.RecordFail(key)
	}
	if !l.Blocked(key) {
		t.Fatal("expected blocked at limit")
	}
	if l.Blocked("other") {
		t.Fatal("expected other key unblocked")
	}
	l.Reset(key)
	if l.Blocked(key) {
		t.Fatal("expected unblocked after reset")
	}
}
