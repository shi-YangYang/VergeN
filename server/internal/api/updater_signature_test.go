package api

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/blake2b"
)

func testUpdaterSigner(t *testing.T) (string, func([]byte, string) string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	keyID := []byte("test-key")
	key := append(append([]byte("Ed"), keyID...), public...)
	encodedKey := base64.StdEncoding.EncodeToString([]byte("untrusted comment: test key\n" + base64.StdEncoding.EncodeToString(key)))
	return encodedKey, func(data []byte, comment string) string {
		digest := blake2b.Sum512(data)
		signature := ed25519.Sign(private, digest[:])
		packet := append(append([]byte("ED"), keyID...), signature...)
		global := ed25519.Sign(private, append(append([]byte{}, signature...), []byte(comment)...))
		return base64.StdEncoding.EncodeToString([]byte("untrusted comment: test signature\n" + base64.StdEncoding.EncodeToString(packet) + "\ntrusted comment: " + comment + "\n" + base64.StdEncoding.EncodeToString(global) + "\n"))
	}
}

func TestUpdaterSignature(t *testing.T) {
	// Published Minisign fixture, independent of the test signer above.
	key := base64.StdEncoding.EncodeToString([]byte("untrusted comment: key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3"))
	sig := base64.StdEncoding.EncodeToString([]byte("untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ=="))
	if !verifyUpdaterSignature(strings.NewReader("test"), sig, key, "1.2.3") {
		t.Fatal("Minisign fixture rejected")
	}
	key, sign := testUpdaterSigner(t)
	data := []byte("Windows installer")
	sig = sign(data, "file:original.exe\tversion:1.2.3")
	otherKey, _ := testUpdaterSigner(t)
	decoded, err := base64.StdEncoding.DecodeString(sig)
	if err != nil {
		t.Fatal(err)
	}
	tampered := base64.StdEncoding.EncodeToString(bytes.ReplaceAll(decoded, []byte("version:1.2.3"), []byte("version:1.2.4")))
	for _, test := range []struct {
		name, signature, publicKey, version string
		data                                []byte
		want                                bool
	}{
		{"matching", sig, key, "1.2.3", data, true},
		{"another platform", sig, key, "1.2.3", []byte("Linux installer"), false},
		{"different build", sig, key, "1.2.3", append(data, '!'), false},
		{"another key", sig, otherKey, "1.2.3", data, false},
		{"wrong version", sig, key, "1.2.4", data, false},
		{"tampered comment", tampered, key, "1.2.4", data, false},
		{"invalid encoding", "invalid", key, "1.2.3", data, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := verifyUpdaterSignature(bytes.NewReader(test.data), test.signature, test.publicKey, test.version); got != test.want {
				t.Fatalf("verify = %v, want %v", got, test.want)
			}
		})
	}
}

func TestUpdaterPublicKeyMatchesClient(t *testing.T) {
	raw, err := os.ReadFile("../../../src-tauri/tauri.conf.json")
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Plugins struct {
			Updater struct {
				Pubkey string `json:"pubkey"`
			} `json:"updater"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	if config.Plugins.Updater.Pubkey != desktopUpdaterPublicKey {
		t.Fatal("server and client updater public keys differ")
	}
}
