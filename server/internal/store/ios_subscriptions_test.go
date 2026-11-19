package store

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

func TestIOSLocalAssignments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ops.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	url := func(n int) string { return fmt.Sprintf("https://example.org/sub/%064x/clash.yaml", n) }
	if _, _, err := s.ImportIOSSubscriptions(ctx, url(1)+"\ninvalid"); err == nil {
		t.Fatal("invalid batch accepted")
	}
	if rows, err := s.ListIOSSubscriptions(ctx); err != nil || len(rows) != 0 {
		t.Fatal("partially imported batch")
	}
	if _, err := s.ClaimIOSSubscription(ctx, "a", "Alice", 1); !errors.Is(err, ErrIOSPoolEmpty) {
		t.Fatal(err)
	}
	if n, skipped, err := s.ImportIOSSubscriptions(ctx, "\uFEFF"+url(1)+"\r\n"+url(2)); err != nil || n != 2 || skipped != 0 {
		t.Fatal(n, skipped, err)
	}

	var wg sync.WaitGroup
	type claim struct {
		owner, url string
		err        error
	}
	owners := []string{"a", "b", "a", "b", "a", "b"}
	results := make(chan claim, len(owners))
	for _, owner := range owners {
		wg.Add(1)
		go func(owner string) {
			defer wg.Done()
			u, err := s.ClaimIOSSubscription(ctx, owner, owner, 123)
			results <- claim{owner, u, err}
		}(owner)
	}
	wg.Wait()
	close(results)
	assigned := map[string]string{}
	for claim := range results {
		if claim.err != nil || claim.url == "" || (assigned[claim.owner] != "" && assigned[claim.owner] != claim.url) {
			t.Fatal("inconsistent assignment", claim.err)
		}
		assigned[claim.owner] = claim.url
	}
	if assigned["a"] == assigned["b"] {
		t.Fatal("shared address")
	}
	rows, err := s.ListIOSSubscriptions(ctx)
	if err != nil || len(rows) != 2 {
		t.Fatal("missing assignments", err)
	}
	if err = s.RevokeIOSSubscription(ctx, rows[0].ID); err != nil {
		t.Fatal(err)
	}
	revoked := rows[0].Employee
	if n, skipped, err := s.ImportIOSSubscriptions(ctx, url(1)+"\n"+url(2)+"\n"+url(3)); err != nil || n != 1 || skipped != 2 {
		t.Fatal(n, skipped, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	for owner, want := range assigned {
		got, err := reopened.ClaimIOSSubscription(ctx, owner, owner, 456)
		if owner == revoked {
			if !errors.Is(err, ErrIOSRevoked) {
				t.Fatal("lost revocation on restart", err)
			}
		} else if err != nil || got != want {
			t.Fatal("lost assignment on restart", err)
		}
	}
}
