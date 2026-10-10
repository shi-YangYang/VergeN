package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound = errors.New("store: not found")
	ErrConflict = errors.New("store: conflict")
)

type User struct {
	ID             int64
	Username       string
	PasswordHash   string
	DingTalkUserID string
	Role           string
	Status         string
	CreatedAt      int64
	UpdatedAt      int64
	LastSeenAt     sql.NullInt64
	LastVersion    string
	LastOS         string
}

type Store struct{ db *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
	password_hash   TEXT NOT NULL DEFAULT '',
	dingtalk_userid TEXT NOT NULL DEFAULT '',
	role            TEXT NOT NULL DEFAULT 'user',
	status          TEXT NOT NULL DEFAULT 'active',
	created_at      INTEGER NOT NULL,
	updated_at      INTEGER NOT NULL,
	last_seen_at    INTEGER,
	last_version    TEXT NOT NULL DEFAULT '',
	last_os         TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
`

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	// Single connection sidesteps SQLITE_BUSY under concurrent writes.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Secret() ([]byte, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = 'jwt_secret'`).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		v = hex.EncodeToString(b)
		if _, err := s.db.Exec(`INSERT INTO meta (key, value) VALUES ('jwt_secret', ?)`, v); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	return []byte(v), nil
}

const userCols = `id, username, password_hash, dingtalk_userid, role, status,
	created_at, updated_at, last_seen_at, last_version, last_os`

func scanUser(row interface{ Scan(dest ...any) error }) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.DingTalkUserID, &u.Role,
		&u.Status, &u.CreatedAt, &u.UpdatedAt, &u.LastSeenAt, &u.LastVersion, &u.LastOS)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) GetUser(id int64) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE id = ?`, id))
}

func (s *Store) GetUserByUsername(username string) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE username = ?`, username))
}

func (s *Store) CreateUser(username, passwordHash, role string, now time.Time) (*User, error) {
	res, err := s.db.Exec(
		`INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		username, passwordHash, role, now.Unix(), now.Unix())
	if err != nil {
		if _, lookupErr := s.GetUserByUsername(username); lookupErr == nil {
			return nil, ErrConflict
		}
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.GetUser(id)
}

func (s *Store) ListUsers() ([]*User, error) {
	rows, err := s.db.Query(`SELECT ` + userCols + ` FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Store) SetUserStatus(id int64, status string, now time.Time) (bool, error) {
	res, err := s.db.Exec(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`, status, now.Unix(), id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) SetUserPassword(id int64, passwordHash string, now time.Time) (bool, error) {
	res, err := s.db.Exec(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
		passwordHash, now.Unix(), id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) GetUserByDingtalkID(dingtalkUserID string) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE dingtalk_userid = ?`, dingtalkUserID))
}

func (s *Store) SetUserDingtalkID(id int64, dingtalkUserID string, now time.Time) (bool, error) {
	res, err := s.db.Exec(`UPDATE users SET dingtalk_userid = ?, updated_at = ? WHERE id = ?`,
		dingtalkUserID, now.Unix(), id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) TouchHeartbeat(id int64, version, os string, now int64) error {
	_, err := s.db.Exec(`UPDATE users SET last_seen_at = ?, last_version = ?, last_os = ? WHERE id = ?`,
		now, version, os, id)
	return err
}

func (s *Store) CreateRefreshToken(userID int64, tokenHash string, expiresAt, now int64) error {
	_, err := s.db.Exec(
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		userID, tokenHash, expiresAt, now)
	return err
}

func (s *Store) GetValidRefreshToken(tokenHash string, now int64) (userID, tokenID int64, err error) {
	err = s.db.QueryRow(
		`SELECT id, user_id FROM refresh_tokens
		 WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
		tokenHash, now).Scan(&tokenID, &userID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, ErrNotFound
	}
	if err != nil {
		return 0, 0, err
	}
	return userID, tokenID, nil
}

func (s *Store) RevokeRefreshToken(tokenID, now int64) error {
	_, err := s.db.Exec(`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now, tokenID)
	return err
}

func (s *Store) RevokeRefreshTokenByValue(tokenHash string, now int64) error {
	_, err := s.db.Exec(
		`UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, now, tokenHash)
	return err
}

func (s *Store) GetSetting(key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// Release is the company client update manifest the employee client polls.
type Release struct {
	Version string `json:"version"`
	Notes   string `json:"notes"`
	URL     string `json:"url"`
	PubDate int64  `json:"pub_date"`
}

// GetRelease parses the stored release manifest; nil means nothing published.
func (s *Store) GetRelease() (*Release, error) {
	raw, found, err := s.GetSetting("release_manifest")
	if err != nil || !found || raw == "" {
		return nil, err
	}
	if err != nil || !found || raw == "" {
		return nil, err
	}
	var r Release
	if err := json.Unmarshal([]byte(raw), &r); err != nil || r.Version == "" {
		return nil, nil
	}
	return &r, nil
}

func (s *Store) SetRelease(r *Release) error {
	if r == nil || r.Version == "" {
		return s.SetSetting("release_manifest", "")
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return s.SetSetting("release_manifest", string(raw))
}

// UpdaterManifest is the raw tauri-format update.json fed to the updater
// plugin verbatim; empty means only the simplified manifest is published.
func (s *Store) UpdaterManifest() (string, error) {
	raw, found, err := s.GetSetting("updater_manifest")
	if err != nil {
		return "", err
	}
	if !found {
		return "", nil
	}
	return raw, nil
}

func (s *Store) SetUpdaterManifest(manifest string) error {
	return s.SetSetting("updater_manifest", manifest)
}

type DashboardStats struct {
	TotalUsers    int64
	DisabledUsers int64
	Online        int64
	Active24h     int64
	VersionDist   map[string]int64
	OSDist        map[string]int64
}

func (s *Store) DashboardStats(now, onlineWindow, activeWindow int64) (*DashboardStats, error) {
	stats := &DashboardStats{VersionDist: map[string]int64{}, OSDist: map[string]int64{}}
	err := s.db.QueryRow(
		`SELECT COUNT(*),
			COALESCE(SUM(status = 'disabled'), 0),
			COALESCE(SUM(last_seen_at IS NOT NULL AND last_seen_at > ?), 0),
			COALESCE(SUM(last_seen_at IS NOT NULL AND last_seen_at > ?), 0)
		 FROM users`, now-onlineWindow, now-activeWindow).
		Scan(&stats.TotalUsers, &stats.DisabledUsers, &stats.Online, &stats.Active24h)
	if err != nil {
		return nil, err
	}
	if err := s.scanDist(`SELECT last_version, COUNT(*) FROM users WHERE last_version != '' GROUP BY last_version`, stats.VersionDist); err != nil {
		return nil, err
	}
	if err := s.scanDist(`SELECT last_os, COUNT(*) FROM users WHERE last_os != '' GROUP BY last_os`, stats.OSDist); err != nil {
		return nil, err
	}
	return stats, nil
}

func (s *Store) scanDist(query string, into map[string]int64) error {
	rows, err := s.db.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var n int64
		if err := rows.Scan(&k, &n); err != nil {
			return err
		}
		into[k] = n
	}
	return rows.Err()
}
