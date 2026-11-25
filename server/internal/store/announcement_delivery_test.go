package store

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestAnnouncementDeliveryVersion(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "notices.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now()
	makeRow := func(name string) *Announcement {
		t.Helper()
		a, err := s.CreateAnnouncement(name, "same", now)
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	state := func(wantID, wantVersion int64) {
		t.Helper()
		a, err := s.CurrentAnnouncement()
		if wantID == 0 {
			if !errors.Is(err, ErrNotFound) {
				t.Fatal(a, err)
			}
		} else if err != nil || a.ID != wantID {
			t.Fatal(a, err)
		}
		if got, err := s.ConfigVersion(); err != nil || got != wantVersion {
			t.Fatalf("version=%d want=%d err=%v", got, wantVersion, err)
		}
	}
	ok := func(found bool, err error) {
		t.Helper()
		if err != nil || !found {
			t.Fatal(found, err)
		}
	}
	a := makeRow("A")
	b := makeRow("B")
	ok(s.UpdateAnnouncement(b.ID, "draft", "edited", now))
	ok(s.UpdateAnnouncement(a.ID, a.Title, a.Content, now))
	ok(s.EnableAnnouncement(a.ID, true))
	state(a.ID, 1)
	ok(s.EnableAnnouncement(b.ID, true))
	ok(s.EnableAnnouncement(a.ID, false))
	ok(s.DeleteAnnouncement(a.ID))
	if found, err := s.EnableAnnouncement(a.ID, true); err != nil || found {
		t.Fatal(found, err)
	}
	state(b.ID, 2)
	ok(s.UpdateAnnouncement(b.ID, "changed", "published", now))
	state(b.ID, 3)
	// Even a failure after changing the active row must leave the original delivery intact.
	c := makeRow("C")
	if _, err := s.db.Exec(`CREATE TRIGGER fail_config BEFORE UPDATE ON meta WHEN OLD.key='config_version' BEGIN SELECT RAISE(ABORT,'test'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnableAnnouncement(c.ID, true); err == nil {
		t.Fatal("expected whole transaction to fail")
	}
	state(b.ID, 3)
	if _, err := s.db.Exec(`DROP TRIGGER fail_config`); err != nil {
		t.Fatal(err)
	}
	ok(s.EnableAnnouncement(b.ID, false))
	ok(s.EnableAnnouncement(b.ID, false))
	state(0, 4)
	ok(s.EnableAnnouncement(c.ID, true))
	ok(s.DeleteAnnouncement(c.ID))
	state(0, 6)
}

func TestAnnouncementMigrationAndPermanentReceipts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE announcements(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,content TEXT NOT NULL,active INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
	INSERT INTO announcements VALUES(1,'First','Original',1,1,1),(2,'Second','Not delivered',1,1,1)`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	u, err := s.CreateUser("employee", "hash", "user", now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE announcements SET active=1 WHERE id=2`); err == nil {
		t.Fatal("invalid second active row accepted")
	}
	first, err := s.UnreadAnnouncement(u.ID)
	if err != nil || first == nil || first.ID != 1 {
		t.Fatal(first, err)
	}
	for i := 0; i < 300; i++ {
		_, err := s.UpdateAnnouncement(1, "First", fmt.Sprintf("edit %d", i), now)
		if err != nil {
			t.Fatal(err)
		}
		current, err := s.UnreadAnnouncement(u.ID)
		if err != nil || current == nil {
			t.Fatal(current, err)
		}
		if err := s.AcknowledgeAnnouncement(u.ID, 1, current.Revision); err != nil {
			t.Fatal(err)
		}
	}
	// The migration registered the old active version before the first edit.
	if err := s.AcknowledgeAnnouncement(u.ID, 1, first.Revision); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.UpdateAnnouncement(1, "First", "edit 0", now); err != nil {
		t.Fatal(err)
	}
	if notice, err := s.UnreadAnnouncement(u.ID); err != nil || notice != nil {
		t.Fatal("historical read lost on reopening", notice, err)
	}
}

func TestConcurrentAnnouncementCreation(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "notices.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() {
			if _, err := s.CreateAnnouncement("A", "content", time.Now()); err != nil {
				t.Error(err)
			}
		})
	}
	workers.Wait()
	rows, err := s.ListAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	active := 0
	for _, r := range rows {
		if r.Enabled {
			active++
		}
	}
	if active != 1 || len(rows) != 8 {
		t.Fatal("unexpected concurrent delivery", active, len(rows))
	}
	if v, err := s.ConfigVersion(); err != nil || v != 1 {
		t.Fatal(v, err)
	}
}
