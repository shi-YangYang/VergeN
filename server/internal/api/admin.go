package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,31}$`)

const (
	settingSubscription = "subscription_url"
	settingManagedFlags = "managed_flags"
	settingAnnouncement = "announcement"
)

type createUserReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (a *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[createUserReq](w, r)
	if !ok {
		return
	}
	if !usernamePattern.MatchString(req.Username) {
		fail(w, http.StatusBadRequest, "bad_request", "username must be 2-32 chars of letters, digits, '_', '.', '-'")
		return
	}
	if len(req.Password) < 8 {
		fail(w, http.StatusBadRequest, "bad_request", "password must be at least 8 characters")
		return
	}
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Role != "user" && req.Role != "admin" {
		fail(w, http.StatusBadRequest, "bad_request", "role must be 'user' or 'admin'")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	u, err := a.store.CreateUser(req.Username, hash, req.Role, time.Now())
	if errors.Is(err, store.ErrConflict) {
		fail(w, http.StatusConflict, "username_taken", "username already exists")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": toPublic(u)})
}

func (a *Server) handleAdminListUsers(w http.ResponseWriter, _ *http.Request) {
	users, err := a.store.ListUsers()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	out := make([]userPublic, 0, len(users))
	for _, u := range users {
		out = append(out, toPublic(u))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

type setStatusReq struct {
	Status string `json:"status"`
}

func (a *Server) handleAdminSetUserStatus(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[setStatusReq](w, r)
	if !ok {
		return
	}
	if req.Status != "active" && req.Status != "disabled" {
		fail(w, http.StatusBadRequest, "bad_request", "status must be 'active' or 'disabled'")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	found, err := a.store.SetUserStatus(id, req.Status, time.Now())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "user_not_found", "user does not exist")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setPasswordReq struct {
	Password string `json:"password"`
}

func (a *Server) handleAdminSetUserPassword(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[setPasswordReq](w, r)
	if !ok {
		return
	}
	if len(req.Password) < 8 {
		fail(w, http.StatusBadRequest, "bad_request", "password must be at least 8 characters")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	found, err := a.store.SetUserPassword(id, hash, time.Now())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "user_not_found", "user does not exist")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type settingsView struct {
	SubscriptionURL string        `json:"subscription_url"`
	ManagedFlags    managedFlags  `json:"managed_flags"`
	Announcement    *announcement `json:"announcement"`
}

type settingsPatch struct {
	SubscriptionURL *string       `json:"subscription_url"`
	ManagedFlags    *managedFlags `json:"managed_flags"`
	// Announcement with empty title and content clears the current one.
	Announcement *announcement `json:"announcement"`
}

func (a *Server) handleAdminGetSettings(w http.ResponseWriter, _ *http.Request) {
	view := settingsView{ManagedFlags: managedFlags{}}
	subURL, found, err := a.store.GetSetting(settingSubscription)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	if found {
		view.SubscriptionURL = subURL
	}
	if raw, found, err := a.store.GetSetting(settingManagedFlags); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found && raw != "" {
		if err := json.Unmarshal([]byte(raw), &view.ManagedFlags); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if raw, found, err := a.store.GetSetting(settingAnnouncement); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found && raw != "" {
		var ann announcement
		if err := json.Unmarshal([]byte(raw), &ann); err == nil && ann.Title != "" {
			view.Announcement = &ann
		}
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *Server) handleAdminSetSettings(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[settingsPatch](w, r)
	if !ok {
		return
	}
	if req.SubscriptionURL != nil {
		if *req.SubscriptionURL != "" && !validateSubscriptionURL(*req.SubscriptionURL) {
			fail(w, http.StatusBadRequest, "bad_request", "subscription_url must be a valid http(s) URL")
			return
		}
		if err := a.store.SetSetting(settingSubscription, *req.SubscriptionURL); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.ManagedFlags != nil {
		raw, err := json.Marshal(req.ManagedFlags)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
		if err := a.store.SetSetting(settingManagedFlags, string(raw)); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.Announcement != nil {
		if req.Announcement.Title == "" && req.Announcement.Content == "" {
			if err := a.store.SetSetting(settingAnnouncement, ""); err != nil {
				fail(w, http.StatusInternalServerError, "internal_error", "internal error")
				return
			}
		} else {
			if req.Announcement.Title == "" {
				fail(w, http.StatusBadRequest, "bad_request", "announcement title is required")
				return
			}
			raw, err := json.Marshal(req.Announcement)
			if err != nil {
				fail(w, http.StatusInternalServerError, "internal_error", "internal error")
				return
			}
			if err := a.store.SetSetting(settingAnnouncement, string(raw)); err != nil {
				fail(w, http.StatusInternalServerError, "internal_error", "internal error")
				return
			}
		}
	}
	a.handleAdminGetSettings(w, r)
}

type dashboardResp struct {
	TotalUsers          int64            `json:"total_users"`
	DisabledUsers       int64            `json:"disabled_users"`
	Online              int64            `json:"online"`
	Active24h           int64            `json:"active_24h"`
	OnlineWindowSeconds int64            `json:"online_window_seconds"`
	VersionDist         map[string]int64 `json:"version_distribution"`
	OSDist              map[string]int64 `json:"os_distribution"`
}

func (a *Server) handleAdminDashboard(w http.ResponseWriter, _ *http.Request) {
	stats, err := a.store.DashboardStats(time.Now().Unix(), 5*60, 24*60*60)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeJSON(w, http.StatusOK, dashboardResp{
		TotalUsers:          stats.TotalUsers,
		DisabledUsers:       stats.DisabledUsers,
		Online:              stats.Online,
		Active24h:           stats.Active24h,
		OnlineWindowSeconds: 300,
		VersionDist:         stats.VersionDist,
		OSDist:              stats.OSDist,
	})
}
