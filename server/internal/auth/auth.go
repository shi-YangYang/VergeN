package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/argon2"
)

const (
	argonMemory  uint32 = 64 * 1024
	argonTime    uint32 = 2
	argonThreads uint8  = 4
	argonKeyLen  uint32 = 32
	argonSaltLen int    = 16
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func VerifyPassword(encoded, password string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errors.New("auth: invalid password hash format")
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, err
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false, err
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}
	computed := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(key)))
	return subtle.ConstantTimeCompare(computed, key) == 1, nil
}

type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func IssueAccessToken(secret []byte, userID int64, role string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

func ParseAccessToken(secret []byte, tokenStr string) (userID int64, role string, err error) {
	var c Claims
	tok, err := jwt.ParseWithClaims(tokenStr, &c, func(*jwt.Token) (any, error) {
		return secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil || !tok.Valid {
		return 0, "", errors.New("auth: invalid access token")
	}
	uid, err := strconv.ParseInt(c.Subject, 10, 64)
	if err != nil {
		return 0, "", errors.New("auth: invalid access token subject")
	}
	return uid, c.Role, nil
}

func NewRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// Limiter counts failures per key inside a sliding window; Blocked is checked
// before password verification to cut off brute force early.
type Limiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	fails  map[string][]time.Time
}

func NewLimiter(window time.Duration, max int) *Limiter {
	return &Limiter{window: window, max: max, fails: map[string][]time.Time{}}
}

func (l *Limiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(key)
	return len(l.fails[key]) >= l.max
}

func (l *Limiter) RecordFail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(key)
	l.fails[key] = append(l.fails[key], time.Now())
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	delete(l.fails, key)
	l.mu.Unlock()
}

func (l *Limiter) pruneLocked(key string) {
	cutoff := time.Now().Add(-l.window)
	list := l.fails[key]
	i := 0
	for i < len(list) && !list[i].After(cutoff) {
		i++
	}
	if i == 0 {
		return
	}
	if i == len(list) {
		delete(l.fails, key)
		return
	}
	l.fails[key] = append([]time.Time(nil), list[i:]...)
}
