package api

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/shi-YangYang/VergeN/server/internal/store"
)

var announcementRevision = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (a *Server) handleClientAnnouncement(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	current, err := a.store.UnreadAnnouncement(userFrom(r).ID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "could not read announcement")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"announcement": current})
}

func (a *Server) handleAcknowledgeAnnouncement(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	req, ok := readJSON[struct {
		ID       int64  `json:"id"`
		Revision string `json:"revision"`
	}](w, r)
	if !ok {
		return
	}
	if req.ID <= 0 || !announcementRevision.MatchString(req.Revision) {
		fail(w, http.StatusBadRequest, "bad_request", "invalid announcement identity or revision")
		return
	}
	err := a.store.AcknowledgeAnnouncement(userFrom(r).ID, req.ID, req.Revision)
	if errors.Is(err, store.ErrConflict) {
		fail(w, http.StatusConflict, "unknown_revision", "this announcement revision was never published")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "could not acknowledge announcement")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
