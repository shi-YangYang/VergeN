package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,31}$`)

const (
	settingSubscription   = "subscription_url"
	settingManagedFlags   = "managed_flags"
	settingAnnouncement   = "announcement"
	settingDingtalkKey    = "dingtalk_app_key"
	settingDingtalkSecret = "dingtalk_app_secret"
	settingDingtalkAgent  = "dingtalk_agent_id"
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

type setDingtalkReq struct {
	DingtalkUserID string `json:"dingtalk_userid"`
}

// Binding a DingTalk union id is what authorizes an employee to scan; an
// empty string unbinds.
func (a *Server) handleAdminSetUserDingtalk(w http.ResponseWriter, r *http.Request) {
	req, ok := readJSON[setDingtalkReq](w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	if req.DingtalkUserID != "" {
		// Union ids are opaque tokens from DingTalk's side; only reject
		// sketchy shapes (length, whitespace, separators, html).
		if len(req.DingtalkUserID) > 128 || strings.ContainsAny(req.DingtalkUserID, " \t\r\n\"'") {
			fail(w, http.StatusBadRequest, "bad_request", "dingtalk_userid looks invalid")
			return
		}
	}
	found, err := a.store.SetUserDingtalkID(id, req.DingtalkUserID, time.Now())
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
	DingtalkAppKey  string        `json:"dingtalk_app_key"`
	// The secret never round-trips to the panel; only its presence is shown.
	DingtalkAppSecretSet bool   `json:"dingtalk_app_secret_set"`
	DingtalkAgentID      string `json:"dingtalk_agent_id"`
}

type settingsPatch struct {
	SubscriptionURL *string       `json:"subscription_url"`
	ManagedFlags    *managedFlags `json:"managed_flags"`
	// Announcement with empty title and content clears the current one.
	Announcement *announcement `json:"announcement"`

	// Secret pointers follow "present means set": omitted leaves the stored
	// value untouched, an empty string clears it.
	DingtalkAppKey    *string `json:"dingtalk_app_key"`
	DingtalkAppSecret *string `json:"dingtalk_app_secret"`
	DingtalkAgentID   *string `json:"dingtalk_agent_id"`
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
	if appKey, found, err := a.store.GetSetting(settingDingtalkKey); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found {
		view.DingtalkAppKey = appKey
	}
	if agentID, found, err := a.store.GetSetting(settingDingtalkAgent); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found {
		view.DingtalkAgentID = agentID
	}
	if secret, found, err := a.store.GetSetting(settingDingtalkSecret); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	} else if found && secret != "" {
		view.DingtalkAppSecretSet = true
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
	if req.DingtalkAppKey != nil {
		if err := a.store.SetSetting(settingDingtalkKey, *req.DingtalkAppKey); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.DingtalkAppSecret != nil {
		if err := a.store.SetSetting(settingDingtalkSecret, *req.DingtalkAppSecret); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
		}
	}
	if req.DingtalkAgentID != nil {
		if err := a.store.SetSetting(settingDingtalkAgent, *req.DingtalkAgentID); err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "internal error")
			return
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
