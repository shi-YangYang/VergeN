package web

import (
	"fmt"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Landing renders the root page: admin sign-in and the client download
// link, nothing else.
func Landing() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		fmt.Fprint(w, landingPage)
	}
}

// ReleaseView is one published version on the download page; empty
// platform URLs drop their rows.
type ReleaseView struct {
	Version string
	Notes   string
	Win     string
	Linux   string
	Mac     string
	Android string
}

// FileRow is one published package file from the downloads directory.
type FileRow struct {
	Name string
	Size string
	Icon string
}

// DownloadPage renders the client download page: published versions
// newest first (each with its description and per-platform entries) and
// loose package files from the downloads directory.
func DownloadPage(releases []ReleaseView, files []FileRow) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body strings.Builder
		for _, rel := range releases {
			fmt.Fprintf(&body, `<section class="rel"><div class="ver">v%s</div>`, html.EscapeString(rel.Version))
			if strings.TrimSpace(rel.Notes) != "" {
				fmt.Fprintf(&body, `<p class="notes">%s</p>`, html.EscapeString(rel.Notes))
			}
			body.WriteString(`<ul>`)
			for _, row := range platformRows(rel) {
				fmt.Fprintf(&body,
					`<li><span class="plat">%s %s</span><a href="%s">下载</a></li>`,
					row.icon, row.label, html.EscapeString(row.url))
			}
			body.WriteString(`</ul></section>`)
		}
		if len(files) > 0 {
			body.WriteString(`<ul>`)
			for _, row := range files {
				fmt.Fprintf(&body,
					`<li><span class="name">%s %s</span><span class="size">%s</span><a href="/files/%s">下载</a></li>`,
					row.Icon, html.EscapeString(row.Name), row.Size, html.EscapeString(row.Name))
			}
			body.WriteString(`</ul>`)
		}
		if len(releases) == 0 && len(files) == 0 {
			fmt.Fprint(&body, `<ul><li class="empty">暂无发布文件</li></ul>`)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		fmt.Fprint(w, downloadPageHeader)
		w.Write([]byte(body.String()))
		fmt.Fprint(w, downloadPageFooter)
	}
}

// Files serves one of the published packages. The name is matched against
// a fresh directory scan, so traversal names never resolve.
func Files(downloadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		found := false
		for _, row := range packagesIn(downloadsDir) {
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

type platformRow struct {
	icon  string
	label string
	url   string
}

func platformRows(rel ReleaseView) []platformRow {
	var rows []platformRow
	add := func(icon, label, url string) {
		if strings.TrimSpace(url) != "" {
			rows = append(rows, platformRow{icon: icon, label: label, url: url})
		}
	}
	add("🪟", "Windows", rel.Win)
	add("🐧", "Linux", rel.Linux)
	add("🍎", "macOS", rel.Mac)
	add("🤖", "Android", rel.Android)
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

// Packages lists the package files currently published in the directory.
// It is the only directory accessor shared with the api layer.
func Packages(dir string) []FileRow {
	return packagesIn(dir)
}

func packagesIn(dir string) []FileRow {
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
  main { width:min(92vw,420px); text-align:center; }
  .brand { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:30px; }
  .brand svg { width:34px; height:34px; }
  h1 { font-size:30px; margin:0; letter-spacing:.5px; }
  a.btn { display:block; padding:14px 16px; border-radius:10px; font-size:16px;
          text-decoration:none; box-sizing:border-box; }
  a.primary { background:#1a73e8; color:#fff; margin-bottom:16px; }
  a.primary:hover { background:#1557b0; }
  a.ghost { background:#fff; color:#1a73e8; border:1px solid #dadce0; }
  a.ghost:hover { border-color:#1a73e8; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#1a73e8"/>
      <text x="32" y="45" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif"
            font-size="38" font-weight="700" fill="#fff">N</text>
    </svg>
    <h1>VergeN</h1>
  </div>
  <a class="btn primary" href="/admin">管理员登录</a>
  <a class="btn ghost" href="/download">下载客户端</a>
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
         padding:32px 36px; width:min(92vw,460px); box-sizing:border-box; }
  .brand { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:10px; }
  .brand svg { width:30px; height:30px; }
  h1 { font-size:22px; margin:0; letter-spacing:.5px; }
  section.rel { margin-top:22px; }
  .ver { font-weight:600; font-size:17px; }
  .notes { margin:6px 0 4px; color:#5f6368; font-size:14px; white-space:pre-wrap; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; align-items:center; gap:8px; padding:11px 0;
       border-top:1px solid #eceff1; font-size:14px; }
  li .plat, li .name { flex:1; }
  li:first-child { border-top:none; }
  li .size { color:#5f6368; font-size:12px; }
  li a { color:#1a73e8; text-decoration:none; white-space:nowrap; }
  li.empty { color:#9aa0a6; justify-content:center; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#1a73e8"/>
      <text x="32" y="45" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif"
            font-size="38" font-weight="700" fill="#fff">N</text>
    </svg>
    <h1>VergeN</h1>
  </div>
`

const downloadPageFooter = `</main>
</body>
</html>
`
