package web

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FileRow is one published package file from the downloads directory.
type FileRow struct {
	Name string
	Size string
	Icon string
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
		for _, row := range Packages(downloadsDir) {
			if row.Name == name {
				found = true
				break
			}
		}
		if !found {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.android.package-archive")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
		http.ServeFile(w, r, filepath.Join(downloadsDir, name))
	}
}

// Packages lists the package files currently published in the directory.
// It is the only directory accessor shared with the api layer.
func Packages(dir string) []FileRow {
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var rows []FileRow
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !isPackageFile(name) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		rows = append(rows, FileRow{Name: name, Size: formatSize(info.Size()), Icon: packageIcon(name)})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	return rows
}

// packageIcon picks a platform hint for a package file name; unknown
// extensions get a plain download glyph.
func packageIcon(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".apk":
		return "🤖"
	case ".exe", ".msi":
		return "🪟"
	case ".dmg", ".pkg":
		return "🍎"
	case ".deb", ".rpm", ".appimage":
		return "🐧"
	default:
		return "⬇"
	}
}

func isPackageFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".apk", ".exe", ".msi", ".dmg", ".pkg", ".deb", ".rpm", ".appimage":
		return true
	}
	return false
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
