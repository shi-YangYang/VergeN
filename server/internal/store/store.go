package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
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
CREATE TABLE IF NOT EXISTS subscriptions (
	id        INTEGER PRIMARY KEY AUTOINCREMENT,
	name      TEXT NOT NULL DEFAULT '',
	url       TEXT NOT NULL,
	active    INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS releases (
	id        INTEGER PRIMARY KEY AUTOINCREMENT,
	version   TEXT NOT NULL,
	notes     TEXT NOT NULL DEFAULT '',
	win_url   TEXT NOT NULL DEFAULT '',
	linux_url TEXT NOT NULL DEFAULT '',
	mac_url   TEXT NOT NULL DEFAULT '',
	android_url TEXT NOT NULL DEFAULT '',
	pub_date   INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
	id        INTEGER PRIMARY KEY AUTOINCREMENT,
	title     TEXT NOT NULL,
	content   TEXT NOT NULL DEFAULT '',
	active    INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
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
	store := &Store{db: db}
	if err := store.migrateSubscription(); err != nil {
		db.Close()
		return nil, err
	}
	if err := store.migrateAnnouncement(); err != nil {
		db.Close()
		return nil, err
	}
	if err := store.migrateReleaseAndroidURL(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

// migrateSubscription lifts the legacy single-subscription setting into the
// subscriptions table so upgrades keep serving the same url.
// migrateReleaseAndroidURL adds the android_url column to releases tables
// created before multi-platform support; duplicate-column errors are a no-op.
func (s *Store) migrateReleaseAndroidURL() error {
	if _, err := s.db.Exec(`ALTER TABLE releases ADD COLUMN android_url TEXT NOT NULL DEFAULT ''`); err != nil {
		if strings.Contains(err.Error(), "duplicate column") {
			return nil
		}
		return err
	}
	return nil
}

func (s *Store) migrateSubscription() error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM subscriptions`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	legacy, found, err := s.GetSetting("subscription_url")
	if err != nil {
		return err
	}
	if found && legacy != "" {
		if _, err := s.db.Exec(
			`INSERT INTO subscriptions (name, url, active, created_at) VALUES ('公司订阅', ?, 1, ?)`,
			legacy, time.Now().Unix()); err != nil {
			return err
		}
		_ = s.SetSetting("subscription_url", "")
	}
	return nil
}

// migrateAnnouncement lifts the legacy announcement setting into the
// announcements table as the initial active row.
func (s *Store) migrateAnnouncement() error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM announcements`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	raw, found, err := s.GetSetting("announcement")
	if err != nil {
		return err
	}
	if found && raw != "" {
		var legacy struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		}
		if err := json.Unmarshal([]byte(raw), &legacy); err == nil && legacy.Title != "" {
			now := time.Now().Unix()
			if _, err := s.db.Exec(
				`INSERT INTO announcements (title, content, active, created_at, updated_at)
				 VALUES (?, ?, 1, ?, ?)`, legacy.Title, legacy.Content, now, now); err != nil {
				return err
			}
		}
		_ = s.SetSetting("announcement", "")
	}
	return nil
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

// ConfigVersion stamps the delivered bootstrap payload; clients compare
// against their stored value via heartbeat and sync on drift.
func (s *Store) ConfigVersion() (int64, error) {
	var raw int64
	err := s.db.QueryRow(
		`SELECT COALESCE(CAST(value AS INTEGER), 0) FROM meta WHERE key = 'config_version'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return raw, err
}

// BumpConfigVersion invalidates every client's cached bootstrap view.
func (s *Store) BumpConfigVersion() error {
	_, err := s.db.Exec(
		`INSERT INTO meta (key, value) VALUES ('config_version', '1')
		 ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`)
	return err
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

func (s *Store) DeleteUser(id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
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

// Release is a published client version with per-platform download URLs;
// the newest row is what /client/update and the updater feed reference.
type Release struct {
	Version          string   `json:"version"`
	Notes            string   `json:"notes"`
	WinURL           string   `json:"win_url"`
	LinuxURL         string   `json:"linux_url"`
	MacURL           string   `json:"mac_url"`
	AndroidURL       string   `json:"android_url"`
	PubDate          int64    `json:"pub_date"`
	CreatedAt        int64    `json:"created_at"`
	ID               int64    `json:"id"`
	UpdaterPlatforms []string `json:"updater_platforms"`
}

const releaseCols = `id, version, notes, win_url, linux_url, mac_url, android_url, pub_date, created_at`

func scanRelease(row interface{ Scan(dest ...any) error }) (*Release, error) {
	r := Release{UpdaterPlatforms: []string{}}
	err := row.Scan(&r.ID, &r.Version, &r.Notes, &r.WinURL, &r.LinuxURL, &r.MacURL, &r.AndroidURL, &r.PubDate, &r.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ListReleases newest-first.
func (s *Store) ListReleases() ([]*Release, error) {
	rows, err := s.db.Query(`SELECT ` + releaseCols + ` FROM releases ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []*Release
	for rows.Next() {
		r, err := scanRelease(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for _, r := range list {
		raw, _, err := s.GetSetting(releaseUpdaterKey(r.ID))
		if err != nil {
			return nil, err
		}
		r.UpdaterPlatforms = updaterPlatforms(raw)
	}
	return list, nil
}

// GetRelease resolves the manifest the employee client sees (newest row);
// nil when nothing has been published yet.
func (s *Store) GetRelease() (*Release, error) {
	return scanRelease(s.db.QueryRow(
		`SELECT ` + releaseCols + ` FROM releases ORDER BY id DESC LIMIT 1`))
}

func (s *Store) CreateRelease(r *Release, now time.Time) (*Release, error) {
	// The legacy single-release manifest migrates here so upgrades keep
	// serving the published version.
	if legacy, found, _ := s.GetSetting("release_manifest"); found && legacy != "" {
		var old Release
		_ = json.Unmarshal([]byte(legacy), &old)
		if old.Version != "" {
			_, _ = s.db.Exec(
				`INSERT INTO releases (version, notes, win_url, linux_url, mac_url, pub_date, created_at)
				 SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM releases)`,
				old.Version, old.Notes, old.WinURL, old.MacURL, old.LinuxURL,
				time_now_or(old.PubDate, now.Unix()), now.Unix())
			_ = s.SetSetting("release_manifest", "")
		} else {
			_ = s.SetSetting("release_manifest", "")
		}
	}
	res, err := s.db.Exec(
		`INSERT INTO releases (version, notes, win_url, linux_url, mac_url, android_url, pub_date, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Version, r.Notes, r.WinURL, r.LinuxURL, r.MacURL, r.AndroidURL,
		r.PubDate, now.Unix())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return scanRelease(s.db.QueryRow(`SELECT `+releaseCols+` FROM releases WHERE id = ?`, id))
}

func releaseUpdaterKey(id int64) string {
	return "release_updater_" + strconv.FormatInt(id, 10)
}

func updaterPlatforms(raw string) []string {
	var manifest struct {
		Platforms map[string]json.RawMessage `json:"platforms"`
	}
	_ = json.Unmarshal([]byte(raw), &manifest)
	platforms := make([]string, 0, len(manifest.Platforms))
	for target := range manifest.Platforms {
		platforms = append(platforms, target)
	}
	sort.Strings(platforms)
	return platforms
}

// PublishRelease commits the download links and updater feed as one version.
func (s *Store) PublishRelease(r *Release, manifest string, now time.Time) (*Release, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM releases WHERE version = ?`, r.Version).Scan(&count); err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, ErrConflict
	}
	// Preserve an existing manually configured feed when an older release is restored.
	var priorID int64
	var priorVersion string
	if err := tx.QueryRow(`SELECT id, version FROM releases ORDER BY id DESC LIMIT 1`).Scan(&priorID, &priorVersion); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if priorID != 0 {
		var raw string
		err := tx.QueryRow(`SELECT value FROM settings WHERE key = 'updater_manifest'`).Scan(&raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		var previous struct {
			Version string `json:"version"`
		}
		_ = json.Unmarshal([]byte(raw), &previous)
		if previous.Version != priorVersion {
			raw = ""
		}
		if _, err := tx.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`, releaseUpdaterKey(priorID), raw); err != nil {
			return nil, err
		}
	}
	res, err := tx.Exec(`INSERT INTO releases (version, notes, win_url, linux_url, mac_url, android_url, pub_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Version, r.Notes, r.WinURL, r.LinuxURL, r.MacURL, r.AndroidURL, r.PubDate, now.Unix())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	for _, key := range []string{releaseUpdaterKey(id), "updater_manifest"} {
		if _, err := tx.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, manifest); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	created := *r
	created.ID, created.CreatedAt = id, now.Unix()
	created.UpdaterPlatforms = updaterPlatforms(manifest)
	return &created, nil
}

func (s *Store) ReleaseUpdater(id int64) (string, error) {
	raw, _, err := s.GetSetting(releaseUpdaterKey(id))
	return raw, err
}

func time_now_or(stored, now int64) int64 {
	if stored > 0 {
		return stored
	}
	return now
}

func (s *Store) DeleteRelease(id int64) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var latestID int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM releases`).Scan(&latestID); err != nil {
		return false, err
	}
	res, err := tx.Exec(`DELETE FROM releases WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil || n == 0 {
		return false, err
	}
	if _, err := tx.Exec(`DELETE FROM settings WHERE key = ?`, releaseUpdaterKey(id)); err != nil {
		return false, err
	}
	if id == latestID {
		var raw string
		err := tx.QueryRow(`SELECT value FROM settings WHERE key = 'release_updater_' || (SELECT MAX(id) FROM releases)`).Scan(&raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return false, err
		}
		if _, err := tx.Exec(`INSERT INTO settings (key, value) VALUES ('updater_manifest', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, raw); err != nil {
			return false, err
		}
	}
	return true, tx.Commit()
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

// --- Subscriptions ---

type Subscription struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"created_at"`
}

const subscriptionCols = `id, name, url, active, created_at`

func scanSubscription(row interface{ Scan(dest ...any) error }) (*Subscription, error) {
	var sub Subscription
	var enabled int
	err := row.Scan(&sub.ID, &sub.Name, &sub.URL, &enabled, &sub.CreatedAt)
	sub.Enabled = enabled == 1
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &sub, nil
}

func (s *Store) ListSubscriptions() ([]*Subscription, error) {
	rows, err := s.db.Query(`SELECT ` + subscriptionCols + ` FROM subscriptions ORDER BY active DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []*Subscription
	for rows.Next() {
		sub, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, sub)
	}
	return list, rows.Err()
}

// EnabledSubscriptions lists every subscription employees may pick; the
// first entry is the fallback for devices that never chose one.
func (s *Store) EnabledSubscriptions() ([]*Subscription, error) {
	rows, err := s.db.Query(`SELECT ` + subscriptionCols + ` FROM subscriptions WHERE active = 1 ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []*Subscription
	for rows.Next() {
		sub, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, sub)
	}
	return list, rows.Err()
}

func (s *Store) CreateSubscription(name, url string, now time.Time) (*Subscription, error) {
	// The very first subscription goes live immediately; later ones stay
	// drafts until the admin activates them.
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM subscriptions`).Scan(&count); err != nil {
		return nil, err
	}
	active := 0
	if count == 0 {
		active = 1
	}
	res, err := s.db.Exec(
		`INSERT INTO subscriptions (name, url, active, created_at) VALUES (?, ?, ?, ?)`,
		name, url, active, now.Unix())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return scanSubscription(s.db.QueryRow(`SELECT `+subscriptionCols+` FROM subscriptions WHERE id = ?`, id))
}

func (s *Store) UpdateSubscription(id int64, name, url string) (bool, error) {
	res, err := s.db.Exec(`UPDATE subscriptions SET name = ?, url = ? WHERE id = ?`, name, url, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) DeleteSubscription(id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM subscriptions WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// SetSubscriptionEnabled toggles one subscription as pickable by clients;
// enabling is additive, several stay eligible at once.
func (s *Store) SetSubscriptionEnabled(id int64, enabled bool) (bool, error) {
	value := 0
	if enabled {
		value = 1
	}
	res, err := s.db.Exec(`UPDATE subscriptions SET active = ? WHERE id = ?`, value, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// --- Announcements (single-pick delivery: enabling one blanks the rest) ---

type Announcement struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

const announcementCols = `id, title, content, active, created_at, updated_at`

func scanAnnouncement(row interface{ Scan(dest ...any) error }) (*Announcement, error) {
	var a Announcement
	var active int
	err := row.Scan(&a.ID, &a.Title, &a.Content, &active, &a.CreatedAt, &a.UpdatedAt)
	a.Enabled = active == 1
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Store) ListAnnouncements() ([]*Announcement, error) {
	rows, err := s.db.Query(`SELECT ` + announcementCols + ` FROM announcements ORDER BY active DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []*Announcement
	for rows.Next() {
		a, err := scanAnnouncement(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// CurrentAnnouncement resolves the row the login page displays; an empty
// string means nothing is published.
func (s *Store) CurrentAnnouncement() (*Announcement, error) {
	return scanAnnouncement(s.db.QueryRow(
		`SELECT ` + announcementCols + ` FROM announcements WHERE active = 1 ORDER BY id LIMIT 1`))
}

func (s *Store) CreateAnnouncement(title, content string, now time.Time) (*Announcement, error) {
	// The first announcement becomes the delivered one immediately.
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM announcements`).Scan(&count); err != nil {
		return nil, err
	}
	active := 0
	if count == 0 {
		active = 1
	}
	res, err := s.db.Exec(
		`INSERT INTO announcements (title, content, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		title, content, active, now.Unix(), now.Unix())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return scanAnnouncement(s.db.QueryRow(`SELECT `+announcementCols+` FROM announcements WHERE id = ?`, id))
}

func (s *Store) UpdateAnnouncement(id int64, title, content string, now time.Time) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE announcements SET title = ?, content = ?, updated_at = ? WHERE id = ?`,
		title, content, now.Unix(), id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) DeleteAnnouncement(id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM announcements WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// EnableAnnouncement makes this row the delivered one and blanks the rest;
// the login page shows the enabled row only, none when all are off.
func (s *Store) EnableAnnouncement(id int64, enabled bool) (bool, error) {
	value := 0
	if enabled {
		value = 1
	}
	if _, err := s.db.Exec(`UPDATE announcements SET active = 0 WHERE id != ?`, id); err != nil {
		return false, err
	}
	res, err := s.db.Exec(`UPDATE announcements SET active = ? WHERE id = ?`, value, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
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
