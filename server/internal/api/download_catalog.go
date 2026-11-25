package api

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/shi-YangYang/VergeN/server/internal/store"
	"github.com/shi-YangYang/VergeN/server/internal/web"
)

const releaseDownloadPrefix = "/download/releases/"

func releaseDownloadTarget(path string) (int64, string, bool) {
	remainder, ok := strings.CutPrefix(path, releaseDownloadPrefix)
	if !ok {
		return 0, "", false
	}
	rawID, platform, ok := strings.Cut(remainder, "/")
	id, err := strconv.ParseInt(rawID, 10, 64)
	if !ok || err != nil || id < 1 || strconv.FormatInt(id, 10) != rawID {
		return 0, "", false
	}
	switch platform {
	case "windows", "macos", "linux", "android":
		return id, platform, true
	}
	return 0, "", false
}

type catalogRelease struct {
	ID         int64  `json:"id"`
	Version    string `json:"version"`
	Notes      string `json:"notes"`
	PubDate    int64  `json:"pub_date"`
	CreatedAt  int64  `json:"created_at"`
	WinURL     string `json:"win_url"`
	MacURL     string `json:"mac_url"`
	LinuxURL   string `json:"linux_url"`
	AndroidURL string `json:"android_url"`
}

// The public catalog contains only local entry points, not external download
// credentials, updater data or employee-specific subscription addresses.
func (a *Server) handleDownloadReleases(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	list, err := a.store.ListDownloadReleases()
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	out := make([]catalogRelease, 0, len(list))
	for _, release := range list {
		link := func(platform, raw string) string {
			if name := a.localPackageName(r, raw); name != "" {
				return "/files/" + url.PathEscape(name)
			}
			if !validateSubscriptionURL(raw) {
				return ""
			}
			return releaseDownloadPrefix + strconv.FormatInt(release.ID, 10) + "/" + platform
		}
		out = append(out, catalogRelease{
			ID: release.ID, Version: release.Version, Notes: release.Notes,
			PubDate: release.PubDate, CreatedAt: release.CreatedAt,
			WinURL: link("windows", release.WinURL), MacURL: link("macos", release.MacURL),
			LinuxURL: link("linux", release.LinuxURL), AndroidURL: link("android", release.AndroidURL),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"releases": out, "packages": web.Packages(a.downloads)})
}

func (a *Server) serveReleaseDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	id, platform, ok := releaseDownloadTarget(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if a.downloadUser(r) == nil {
		http.Redirect(w, r, "/download/login?"+downloadTarget(r.URL.Path).query().Encode(), http.StatusSeeOther)
		return
	}
	release, err := a.store.GetReleaseByID(id)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	raw := map[string]string{
		"windows": release.WinURL, "macos": release.MacURL,
		"linux": release.LinuxURL, "android": release.AndroidURL,
	}[platform]
	if name := a.localPackageName(r, raw); name != "" {
		raw = "/files/" + url.PathEscape(name)
	} else if !validateSubscriptionURL(raw) {
		http.NotFound(w, r)
		return
	}
	http.Redirect(w, r, raw, http.StatusSeeOther)
}
