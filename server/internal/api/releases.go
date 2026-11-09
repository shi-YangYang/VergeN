package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/store"
	"github.com/shi-YangYang/VergeN/server/internal/web"
)

type updaterPackage struct {
	Name          string `json:"name"`
	Signature     string `json:"signature"`
	SignatureName string `json:"signature_name"`
}

type updaterArtifact struct {
	URL       string `json:"url"`
	Signature string `json:"signature"`
}

type updaterManifest struct {
	Version   string                     `json:"version"`
	Notes     string                     `json:"notes"`
	PubDate   string                     `json:"pub_date"`
	Platforms map[string]updaterArtifact `json:"platforms"`
}

var releaseVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+\.)*[0-9A-Za-z-]+)?(\+([0-9A-Za-z-]+\.)*[0-9A-Za-z-]+)?$`)

func validReleaseVersion(version string) bool {
	if !releaseVersionPattern.MatchString(version) {
		return false
	}
	core := strings.SplitN(version, "+", 2)[0]
	if prerelease := strings.SplitN(core, "-", 2); len(prerelease) == 2 {
		for _, part := range strings.Split(prerelease[1], ".") {
			if len(part) > 1 && part[0] == '0' && strings.Trim(part, "0123456789") == "" {
				return false
			}
		}
	}
	return true
}

func (a *Server) existingPackage(name, platform string) (web.FileRow, error) {
	row, ok := web.PackageFile(name, 0)
	if !ok || row.Platform != platform {
		return row, fmt.Errorf("invalid %s package filename", platform)
	}
	info, err := os.Lstat(filepath.Join(a.downloads, name))
	if err != nil || !info.Mode().IsRegular() {
		return row, fmt.Errorf("package %s must be uploaded before publishing", name)
	}
	return row, nil
}

func (a *Server) publishRelease(w http.ResponseWriter, req releasePayload) {
	req.Version = strings.TrimPrefix(strings.TrimSpace(req.Version), "v")
	if !validReleaseVersion(req.Version) {
		fail(w, http.StatusBadRequest, "invalid_version", "use a semantic version such as 1.0.2")
		return
	}
	origin, err := url.Parse(req.BaseURL)
	if err != nil || origin.Host == "" || (origin.Scheme != "http" && origin.Scheme != "https") || origin.User != nil || (origin.Path != "" && origin.Path != "/") || origin.RawQuery != "" || origin.Fragment != "" {
		fail(w, http.StatusBadRequest, "invalid_base_url", "base_url must be an http(s) origin")
		return
	}
	if len(req.Updater) > 0 && origin.Scheme != "https" && !strings.EqualFold(origin.Hostname(), "localhost") && !net.ParseIP(origin.Hostname()).IsLoopback() {
		fail(w, http.StatusBadRequest, "insecure_update_url", "open the ops panel over HTTPS to publish online updates; HTTP is only allowed for localhost testing")
		return
	}
	if !a.downloadsReady(w) {
		return
	}
	fileURL := func(name string) string {
		return origin.Scheme + "://" + origin.Host + "/files/" + url.PathEscape(name)
	}
	now := time.Now()
	release := &store.Release{Version: req.Version, Notes: req.Notes, PubDate: now.Unix()}
	urls := map[string]*string{"windows": &release.WinURL, "macos": &release.MacURL, "linux": &release.LinuxURL, "android": &release.AndroidURL}
	count := 0
	for platform, name := range req.Packages {
		destination, ok := urls[platform]
		if !ok {
			fail(w, http.StatusBadRequest, "invalid_package", "unsupported installer platform")
			return
		}
		if name == "" {
			continue
		}
		row, err := a.existingPackage(name, platform)
		if err != nil || row.Kind != "installer" {
			fail(w, http.StatusBadRequest, "invalid_package", "select an uploaded installer for "+platform)
			return
		}
		*destination = fileURL(name)
		count++
	}
	if count == 0 {
		fail(w, http.StatusBadRequest, "invalid_package", "select at least one installer")
		return
	}
	manifest := updaterManifest{Version: release.Version, Notes: release.Notes, PubDate: now.UTC().Format(time.RFC3339), Platforms: map[string]updaterArtifact{}}
	for target, artifact := range req.Updater {
		platform, extensions := updaterTarget(target)
		if platform == "" || req.Packages[platform] == "" {
			fail(w, http.StatusBadRequest, "invalid_updater", "each updater target requires a matching installer platform")
			return
		}
		artifact.Signature = strings.TrimSpace(artifact.Signature)
		if !hasPackageExtension(artifact.Name, extensions) || !a.verifyUpdaterPackage(target, release.Version, artifact) {
			fail(w, http.StatusBadRequest, "invalid_updater", "updater package and signature must match this platform, version and the client signing key")
			return
		}
		manifest.Platforms[target] = updaterArtifact{URL: fileURL(artifact.Name), Signature: artifact.Signature}
	}
	raw := ""
	if len(manifest.Platforms) > 0 {
		encoded, err := json.Marshal(manifest)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal_error", "could not generate updater manifest")
			return
		}
		raw = string(encoded)
	}
	created, err := a.store.PublishRelease(release, raw, now)
	if errors.Is(err, store.ErrConflict) {
		fail(w, http.StatusConflict, "release_exists", "this version is already published; unpublish it before replacing it")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "could not publish release")
		return
	}
	_ = a.store.BumpConfigVersion()
	writeJSON(w, http.StatusCreated, map[string]any{"release": created})
}

func updaterTarget(target string) (string, []string) {
	switch target {
	case "windows-x86_64":
		return "windows", []string{".exe", ".msi"}
	case "darwin-aarch64":
		return "macos", []string{".app.tar.gz"}
	case "linux-x86_64-deb":
		return "linux", []string{".deb"}
	case "linux-x86_64-rpm":
		return "linux", []string{".rpm"}
	}
	return "", nil
}

func (a *Server) packageReferenced(name string) (bool, error) {
	usesFile := func(rawURL string) bool {
		u, err := url.Parse(rawURL)
		return err == nil && u.Path == "/files/"+name
	}
	usesManifest := func(raw string) bool {
		var manifest updaterManifest
		_ = json.Unmarshal([]byte(raw), &manifest)
		for _, artifact := range manifest.Platforms {
			if usesFile(artifact.URL) {
				return true
			}
		}
		return false
	}
	releases, err := a.store.ListReleases()
	if err != nil {
		return false, err
	}
	for _, release := range releases {
		for _, rawURL := range []string{release.WinURL, release.MacURL, release.LinuxURL, release.AndroidURL} {
			if usesFile(rawURL) {
				return true, nil
			}
		}
		raw, err := a.store.ReleaseUpdater(release.ID)
		if err != nil {
			return false, err
		}
		if usesManifest(raw) {
			return true, nil
		}
	}
	raw, err := a.store.UpdaterManifest()
	return usesManifest(raw), err
}

func clientUpdaterTarget(r *http.Request) string {
	query := r.URL.Query()
	platform, arch := query.Get("platform"), query.Get("arch")
	if arch != "x86_64" && arch != "aarch64" {
		return ""
	}
	switch platform {
	case "windows":
		return "windows-" + arch
	case "macos":
		return "darwin-" + arch
	case "linux":
		switch bundle := query.Get("bundle_type"); bundle {
		case "deb", "rpm":
			return "linux-" + arch + "-" + bundle
		}
	}
	return ""
}

func matchingUpdater(raw string, release *store.Release, target string) (updaterArtifact, bool) {
	var manifest updaterManifest
	if release == nil || target == "" || json.Unmarshal([]byte(raw), &manifest) != nil || manifest.Version != release.Version {
		return updaterArtifact{}, false
	}
	artifact, ok := manifest.Platforms[target]
	return artifact, ok && artifact.URL != "" && artifact.Signature != ""
}
