package web

import (
	"bytes"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FileRow is one published package file from the downloads directory.
type FileRow struct {
	Name     string `json:"name"`
	Size     string `json:"size"`
	Platform string `json:"platform"`
	Kind     string `json:"kind"`
}

// Files serves a published package by exact name. The name is matched
// against a fresh directory scan, so traversal names never resolve.
func Files(downloadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		found := false
		for _, row := range PackageFiles(downloadsDir) {
			if row.Name == name {
				found = true
				break
			}
		}
		if !found {
			http.NotFound(w, r)
			return
		}
		contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
		if strings.EqualFold(filepath.Ext(name), ".apk") {
			contentType = "application/vnd.android.package-archive"
		} else if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
		http.ServeFile(w, r, filepath.Join(downloadsDir, name))
	}
}

// Packages lists the package files currently published in the directory.
func Packages(dir string) []FileRow {
	var rows []FileRow
	for _, row := range PackageFiles(dir) {
		if row.Kind == "installer" {
			rows = append(rows, row)
		}
	}
	return rows
}

// PackageFiles includes the macOS archive used by the desktop updater.
func PackageFiles(dir string) []FileRow {
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var rows []FileRow
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if row, ok := PackageFile(entry.Name(), info.Size()); ok {
			rows = append(rows, row)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	return rows
}

// PackageFile validates a published installer name and describes its platform.
func PackageFile(name string, size int64) (FileRow, bool) {
	if name == "" || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		return FileRow{}, false
	}
	for _, c := range name {
		if c < 32 || c == 127 {
			return FileRow{}, false
		}
	}
	platform := packagePlatform(name)
	kind := "installer"
	if strings.HasSuffix(strings.ToLower(name), ".app.tar.gz") {
		platform, kind = "macos", "updater"
	}
	return FileRow{Name: name, Size: formatSize(size), Platform: platform, Kind: kind}, platform != ""
}

func packagePlatform(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".apk":
		return "android"
	case ".exe", ".msi":
		return "windows"
	case ".dmg", ".pkg":
		return "macos"
	case ".deb", ".rpm", ".appimage":
		return "linux"
	}
	return ""
}

func formatSize(size int64) string {
	var buf bytes.Buffer
	switch {
	case size >= 1024*1024*1024:
		fmt.Fprintf(&buf, "%.1f GB", float64(size)/(1024*1024*1024))
	case size >= 1024*1024:
		fmt.Fprintf(&buf, "%.1f MB", float64(size)/(1024*1024))
	default:
		fmt.Fprintf(&buf, "%.1f KB", float64(size)/1024)
	}
	return buf.String()
}
