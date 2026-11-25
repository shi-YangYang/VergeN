package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
)

type DeliveredAnnouncement struct {
	ID       int64  `json:"id"`
	Revision string `json:"revision"`
	Title    string `json:"title"`
	Content  string `json:"content"`
}

func (s *Store) migrateAnnouncementDelivery() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var hasRevision bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM pragma_table_info('announcements') WHERE name = 'delivery_revision')`).Scan(&hasRevision); err != nil {
		return err
	}
	if !hasRevision {
		if _, err := tx.Exec(`ALTER TABLE announcements ADD COLUMN delivery_revision TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	// Older split writes could leave multiple rows enabled. Preserve the row
	// the legacy bootstrap actually delivered, without changing its version.
	if _, err := tx.Exec(`UPDATE announcements SET active = 0 WHERE active = 1
		AND id != (SELECT MIN(id) FROM announcements WHERE active = 1);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_single_active ON announcements(active) WHERE active = 1`); err != nil {
		return err
	}
	if err := registerCurrentAnnouncement(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Keep only the identity of each published version for late, authenticated
// acknowledgements. The historical catalog deliberately outlives deletion.
func registerCurrentAnnouncement(tx *sql.Tx) error {
	var current DeliveredAnnouncement
	err := tx.QueryRow(`SELECT id, delivery_revision, title, content FROM announcements WHERE active = 1`).
		Scan(&current.ID, &current.Revision, &current.Title, &current.Content)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Preserve the revision format used by clients before receipts were centralized.
	digest := sha256.Sum256(fmt.Appendf(nil, "%d/%q/%q", current.ID, current.Title, current.Content))
	revision := hex.EncodeToString(digest[:])
	if current.Revision != revision {
		if _, err := tx.Exec(`UPDATE announcements SET delivery_revision = ? WHERE id = ?`, revision, current.ID); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`INSERT INTO announcement_publications (announcement_id, revision) VALUES (?, ?)
		ON CONFLICT (announcement_id, revision) DO NOTHING`, current.ID, revision)
	return err
}

func (s *Store) UnreadAnnouncement(userID int64) (*DeliveredAnnouncement, error) {
	var notice DeliveredAnnouncement
	err := s.db.QueryRow(`SELECT a.id, a.delivery_revision, a.title, a.content FROM announcements a
		WHERE a.active = 1 AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE
			r.user_id = ? AND r.announcement_id = a.id AND r.revision = a.delivery_revision)`, userID).
		Scan(&notice.ID, &notice.Revision, &notice.Title, &notice.Content)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &notice, nil
}

func (s *Store) AcknowledgeAnnouncement(userID, id int64, revision string) error {
	result, err := s.db.Exec(`INSERT INTO announcement_reads (user_id, announcement_id, revision)
		SELECT ?, announcement_id, revision FROM announcement_publications WHERE announcement_id = ? AND revision = ?
		ON CONFLICT (user_id, announcement_id, revision) DO NOTHING`, userID, id, revision)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil || n != 0 {
		return err
	}
	// A replay and an unknown revision both inserted zero rows. Publications
	// are append-only, so only a previously published version is a valid replay.
	var exists bool
	if err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM announcement_reads
		WHERE user_id = ? AND announcement_id = ? AND revision = ?)`, userID, id, revision).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrConflict
	}
	return nil
}
