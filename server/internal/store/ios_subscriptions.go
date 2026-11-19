package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var (
	ErrIOSPoolEmpty   = errors.New("no available iOS subscription")
	ErrIOSRevoked     = errors.New("iOS assignment revoked")
	ErrIOSImportEmpty = errors.New("empty iOS import")
	ErrIOSImportSize  = errors.New("iOS import exceeds limit")
	iosPath           = regexp.MustCompile(`^/sub/([0-9a-f]{64})/clash\.yaml$`)
)

type InvalidIOSLink struct{ Line int }

func (e *InvalidIOSLink) Error() string {
	return fmt.Sprintf("invalid subscription link on line %d", e.Line)
}

type IOSSubscription struct {
	ID             int64  `json:"id"`
	Status         string `json:"status"`
	Employee       string `json:"employee"`
	AssignedAt     int64  `json:"assigned_at"`
	AddressPreview string `json:"address_preview"`
}

func (s *Store) ListIOSSubscriptions(ctx context.Context) ([]IOSSubscription, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, status, employee, assigned_at,
		origin || '/sub/…' || substr(token,-8) || '/clash.yaml' FROM ios_subscriptions ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []IOSSubscription{}
	for rows.Next() {
		var item IOSSubscription
		if err := rows.Scan(&item.ID, &item.Status, &item.Employee, &item.AssignedAt, &item.AddressPreview); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ImportIOSSubscriptions(ctx context.Context, text string) (added, skipped int64, err error) {
	if len(text) > 256*1024 {
		return 0, 0, ErrIOSImportSize
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	var origin string
	err = tx.QueryRowContext(ctx, `SELECT origin FROM ios_subscriptions ORDER BY id LIMIT 1`).Scan(&origin)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, 0, err
	}
	for i, line := range strings.Split(strings.TrimPrefix(text, "\uFEFF"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if added+skipped >= 1000 {
			return 0, 0, ErrIOSImportSize
		}
		u, err := url.Parse(line)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return 0, 0, &InvalidIOSLink{Line: i + 1}
		}
		key := iosPath.FindStringSubmatch(u.Path)
		if key == nil || line != "https://"+u.Host+u.Path {
			return 0, 0, &InvalidIOSLink{Line: i + 1}
		}
		host := "https://" + strings.ToLower(u.Host)
		if origin == "" {
			origin = host
		}
		if host != origin {
			return 0, 0, &InvalidIOSLink{Line: i + 1}
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO ios_subscriptions(origin, token) VALUES(?,?) ON CONFLICT(token) DO NOTHING`, host, key[1])
		if err != nil {
			return 0, 0, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return 0, 0, err
		}
		added += n
		skipped += 1 - n
	}
	if added+skipped == 0 {
		return 0, 0, ErrIOSImportEmpty
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return added, skipped, nil
}

func (s *Store) IOSSubscriptionURL(ctx context.Context, id int64) (string, error) {
	var address string
	err := s.db.QueryRowContext(ctx, `SELECT origin || '/sub/' || token || '/clash.yaml' FROM ios_subscriptions WHERE id=?`, id).Scan(&address)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return address, err
}

func (s *Store) RevokeIOSSubscription(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `UPDATE ios_subscriptions SET status='revoked' WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) ClaimIOSSubscription(ctx context.Context, owner, employee string, now int64) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	// Take the write lock before looking up the owner so simultaneous copies share one assignment.
	_, err = tx.ExecContext(ctx, `UPDATE ios_subscriptions SET status='assigned', owner_hash=?, employee=?, assigned_at=?
		WHERE id=(SELECT id FROM ios_subscriptions WHERE status='available' ORDER BY id LIMIT 1)
		AND NOT EXISTS (SELECT 1 FROM ios_subscriptions WHERE owner_hash=?)`, owner, employee, now, owner)
	if err != nil {
		return "", err
	}
	var status, address string
	err = tx.QueryRowContext(ctx, `SELECT status, origin || '/sub/' || token || '/clash.yaml'
		FROM ios_subscriptions WHERE owner_hash=?`, owner).Scan(&status, &address)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", ErrIOSPoolEmpty
	case err != nil:
		return "", err
	case status == "revoked":
		return "", ErrIOSRevoked
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return address, nil
}
