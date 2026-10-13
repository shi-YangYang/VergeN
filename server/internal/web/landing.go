package web

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// The root page is a call-through page: sign in to the admin panel or
// open the client download page. No store access is involved.
func Landing(downloadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		fmt.Fprint(w, landingPage)
	}
}

// Download lists the published client packages. The list is a fresh
// scan of the downloads directory.
func Download(downloadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows := downloadRows(downloadsDir)
		var list strings.Builder
		for _, row := range rows {
			fmt.Fprintf(&list,
				`<li><span class="name">%s</span><span class="size">%s</span><a href="/files/%s">下载</a></li>`,
				row.name, row.size, row.name)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		fmt.Fprint(w, downloadPageHeader)
		if len(rows) == 0 {
			fmt.Fprint(w, `<li class="empty">暂无发布文件</li>`)
		} else {
			w.Write([]byte(list.String()))
		}
		fmt.Fprint(w, downloadPageFooter)
	}
}

type downloadRow struct {
	name string
	size string
}

func downloadRows(dir string) []downloadRow {
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var rows []downloadRow
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(name), ".apk") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		rows = append(rows, downloadRow{name: name, size: formatSize(info.Size())})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].name < rows[j].name })
	return rows
}

func formatSize(size int64) string {
	switch {
	case size >= 1024*1024*1024:
		return fmt.Sprintf("%.1f GB", float64(size)/(1024*1024*1024))
	case size >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(size)/(1024*1024))
	default:
		return fmt.Sprintf("%.1f KB", float64(size)/1024)
	}
}

// Files serves one of the landing-listed packages. The name is matched
// against a fresh directory scan, so traversal names never resolve.
func Files(downloadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		found := false
		for _, row := range downloadRows(downloadsDir) {
			if row.name == name {
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

const landingPage = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VergeN</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family:-apple-system,"Helvetica Neue","PingFang SC",sans-serif;
         background:#f5f6f8; color:#202124; }
  main { text-align:center; }
  h1 { font-size:30px; margin:0 0 34px; letter-spacing:.5px; }
  a.btn { display:block; width:260px; margin:0 auto 16px; padding:14px 16px;
          border-radius:8px; background:#1a73e8; color:#fff; text-decoration:none;
          font-size:16px; }
  a.btn:hover { background:#1557b0; }
</style>
</head>
<body>
<main>
  <h1>VergeN</h1>
  <a class="btn" href="/admin">登录</a>
  <a class="btn" href="/download">下载页</a>
</main>
</body>
</html>
`

const downloadPageHeader = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VergeN · 下载</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family:-apple-system,"Helvetica Neue","PingFang SC",sans-serif;
         background:#f5f6f8; color:#202124; }
  main { background:#fff; border-radius:14px; box-shadow:0 1px 3px rgba(0,0,0,.08);
         padding:32px 36px; width:min(92vw,420px); }
  h1 { font-size:24px; margin:0 0 18px; letter-spacing:.5px; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; align-items:center; gap:8px; padding:11px 0;
       border-top:1px solid #eceff1; font-size:14px; }
  li .name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  li .size { color:#5f6368; font-size:12px; }
  li a { color:#1a73e8; text-decoration:none; white-space:nowrap; }
  li.empty { color:#9aa0a6; justify-content:center; border-top:none; }
</style>
</head>
<body>
<main>
  <h1>VergeN</h1>
  <ul>
`

const downloadPageFooter = `</ul>
</main>
</body>
</html>
`
