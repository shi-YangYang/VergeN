package api

import (
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"

	"github.com/shi-YangYang/VergeN/server/internal/web"
)

const maxPackageBytes = 512 << 20

func (a *Server) downloadsReady(w http.ResponseWriter) bool {
	info, err := os.Stat(a.downloads)
	if err != nil || !info.IsDir() {
		fail(w, http.StatusServiceUnavailable, "downloads_unavailable", "configure --downloads with an existing writable directory")
		return false
	}
	return true
}

func (a *Server) handleAdminListPackages(w http.ResponseWriter, _ *http.Request) {
	if !a.downloadsReady(w) {
		return
	}
	packages := append([]web.FileRow{}, web.Packages(a.downloads)...)
	writeJSON(w, http.StatusOK, map[string]any{"packages": packages})
}

func (a *Server) handleAdminUploadPackage(w http.ResponseWriter, r *http.Request) {
	if !a.downloadsReady(w) {
		return
	}
	const maxRequestBytes = maxPackageBytes + 64<<10
	if r.ContentLength > maxRequestBytes {
		fail(w, http.StatusRequestEntityTooLarge, "package_too_large", "package must not exceed 512 MiB")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_request", "multipart form with one file field is required")
		return
	}
	part, err := reader.NextPart()
	if err != nil {
		packageUploadError(w, err)
		return
	}
	// Part.FileName strips directories, hiding traversal attempts from validation.
	_, params, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
	name := params["filename"]
	if _, ok := web.PackageFile(name, 0); err != nil || !ok || part.FormName() != "file" {
		fail(w, http.StatusBadRequest, "invalid_package", "file must have a plain installer filename")
		return
	}
	target := filepath.Join(a.downloads, name)
	if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		if err != nil {
			packageUploadError(w, err)
		} else {
			fail(w, http.StatusConflict, "package_exists", "delete the existing package before uploading the same filename")
		}
		return
	}
	temp, err := os.CreateTemp(a.downloads, ".upload-*")
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "downloads_unavailable", "downloads directory must be writable by the server")
		return
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	size, err := io.Copy(temp, io.LimitReader(part, maxPackageBytes+1))
	if size > maxPackageBytes {
		fail(w, http.StatusRequestEntityTooLarge, "package_too_large", "package must not exceed 512 MiB")
		return
	}
	if err != nil {
		packageUploadError(w, err)
		return
	}
	if size == 0 {
		fail(w, http.StatusBadRequest, "invalid_package", "package must not be empty")
		return
	}
	if _, err := reader.NextPart(); !errors.Is(err, io.EOF) {
		if err != nil {
			packageUploadError(w, err)
		} else {
			fail(w, http.StatusBadRequest, "bad_request", "upload exactly one file at a time")
		}
		return
	}
	if err := temp.Chmod(0o644); err != nil {
		packageUploadError(w, err)
		return
	}
	if err := temp.Close(); err != nil {
		packageUploadError(w, err)
		return
	}
	// Linking publishes the completed file atomically without replacing a concurrent upload.
	if err := os.Link(temp.Name(), target); err != nil {
		if errors.Is(err, os.ErrExist) {
			fail(w, http.StatusConflict, "package_exists", "delete the existing package before uploading the same filename")
		} else {
			packageUploadError(w, err)
		}
		return
	}
	row, _ := web.PackageFile(name, size)
	writeJSON(w, http.StatusCreated, map[string]any{"package": row})
}

func packageUploadError(w http.ResponseWriter, err error) {
	var limitErr *http.MaxBytesError
	var pathErr *os.PathError
	var linkErr *os.LinkError
	switch {
	case errors.As(err, &limitErr):
		fail(w, http.StatusRequestEntityTooLarge, "package_too_large", "package must not exceed 512 MiB")
	case errors.As(err, &pathErr), errors.As(err, &linkErr):
		slog.Error("package upload failed", "err", err)
		fail(w, http.StatusInternalServerError, "internal_error", "could not save package")
	default:
		fail(w, http.StatusBadRequest, "bad_request", "invalid or incomplete multipart upload")
	}
}

func (a *Server) handleAdminDeletePackage(w http.ResponseWriter, r *http.Request) {
	if !a.downloadsReady(w) {
		return
	}
	name := r.PathValue("name")
	if _, ok := web.PackageFile(name, 0); !ok {
		fail(w, http.StatusBadRequest, "invalid_package", "invalid installer filename")
		return
	}
	path := filepath.Join(a.downloads, name)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) || (err == nil && !info.Mode().IsRegular()) {
		fail(w, http.StatusNotFound, "package_not_found", "package does not exist")
		return
	}
	if err == nil {
		err = os.Remove(path)
	}
	if err != nil {
		slog.Error("package delete failed", "err", err)
		fail(w, http.StatusInternalServerError, "internal_error", "could not delete package")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
