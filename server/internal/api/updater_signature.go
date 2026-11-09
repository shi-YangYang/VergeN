package api

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/blake2b"
)

// Must match the public key embedded in src-tauri/tauri.conf.json.
const desktopUpdaterPublicKey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAxRUI1RUMwQkM1NjIxMTEKUldRUklWYTh3RjdyQVdyRDYyblFXZSt3MzZsOFB2N0VLT0J0bnZ6eWRZYWJ0M25PTG03UXFDNWEK"

func verifyUpdaterSignature(file io.Reader, signature, publicKey, version string) bool {
	if len(signature) > 16<<10 {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return false
	}
	lines := strings.Split(strings.TrimSpace(string(decoded)), "\n")
	if len(lines) != 4 || !strings.HasPrefix(lines[0], "untrusted comment:") || !strings.HasPrefix(lines[2], "trusted comment: ") {
		return false
	}
	packet, err := base64.StdEncoding.DecodeString(strings.TrimSpace(lines[1]))
	// Tauri produces prehashed Minisign signatures, allowing streaming verification.
	if err != nil || len(packet) != 74 || string(packet[:2]) != "ED" {
		return false
	}
	keyText, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil {
		return false
	}
	keyLines := strings.Split(strings.TrimSpace(string(keyText)), "\n")
	if len(keyLines) != 2 {
		return false
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(keyLines[1]))
	if err != nil || len(key) != 42 || string(key[:2]) != "Ed" || !bytes.Equal(key[2:10], packet[2:10]) {
		return false
	}
	comment := strings.TrimSuffix(strings.TrimPrefix(lines[2], "trusted comment: "), "\r")
	global, err := base64.StdEncoding.DecodeString(strings.TrimSpace(lines[3]))
	message := append(append([]byte{}, packet[10:]...), []byte(comment)...)
	if err != nil || !ed25519.Verify(key[10:], message, global) {
		return false
	}
	for _, field := range strings.Split(comment, "\t") {
		if signedVersion, ok := strings.CutPrefix(field, "version:"); ok && strings.TrimPrefix(signedVersion, "v") != version {
			return false
		}
	}
	digest, _ := blake2b.New512(nil)
	size, err := io.Copy(digest, io.LimitReader(file, maxPackageBytes+1))
	return err == nil && size > 0 && size <= maxPackageBytes && ed25519.Verify(key[10:], digest.Sum(nil), packet[10:])
}

func (a *Server) verifyUpdaterPackage(target, version string, artifact updaterPackage) bool {
	platform, extensions := updaterTarget(target)
	if platform == "" || !validReleaseVersion(version) || artifact.SignatureName != artifact.Name+".sig" || !hasPackageExtension(artifact.Name, extensions) {
		return false
	}
	if _, err := a.existingPackage(artifact.Name, platform); err != nil {
		return false
	}
	file, err := os.Open(filepath.Join(a.downloads, artifact.Name))
	if err != nil {
		return false
	}
	defer file.Close()
	return verifyUpdaterSignature(file, strings.TrimSpace(artifact.Signature), a.updaterPublicKey, version)
}

func (a *Server) handleAdminVerifySignature(w http.ResponseWriter, r *http.Request) {
	a.publicationMu.Lock()
	defer a.publicationMu.Unlock()
	req, ok := readJSON[struct {
		updaterPackage
		Target  string `json:"target"`
		Version string `json:"version"`
	}](w, r)
	if !ok {
		return
	}
	if !a.downloadsReady(w) {
		return
	}
	version := strings.TrimPrefix(strings.TrimSpace(req.Version), "v")
	if !a.verifyUpdaterPackage(req.Target, version, req.updaterPackage) {
		fail(w, http.StatusBadRequest, "invalid_updater", "signature does not match the selected update file, version or client signing key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
