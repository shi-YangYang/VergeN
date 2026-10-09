// Package web serves the embedded admin panel SPA built from ../../web.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

func Handler() (http.Handler, error) {
	content, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, err
	}
	fileServer := http.FileServerFS(content)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		const prefix = "/admin"
		if r.URL.Path == prefix {
			http.Redirect(w, r, prefix+"/", http.StatusFound)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, prefix)
		if candidate := strings.TrimPrefix(path, "/"); candidate != "" {
			if f, err := content.Open(candidate); err == nil {
				f.Close()
				clone := r.Clone(r.Context())
				clone.URL.Path = path
				fileServer.ServeHTTP(w, clone)
				return
			}
		}
		// SPA fallback: unknown client-side routes render the app shell.
		index, err := fs.ReadFile(content, "index.html")
		if err != nil {
			http.Error(w, "admin panel assets are missing", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	}), nil
}
