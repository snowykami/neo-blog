package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"
)

func TestQQTEARoundTrip(t *testing.T) {
	key := []byte("0123456789abcdef")
	for _, size := range []int{0, 1, 7, 8, 15, 16, 33, 100} {
		data := bytes.Repeat([]byte{byte(size)}, size)
		encrypted := qqTEAEncrypt(data, key, rand.Reader)
		if len(encrypted)%8 != 0 || len(encrypted) < 16 {
			t.Fatalf("size %d: bad cipher length %d", size, len(encrypted))
		}
		decrypted, err := qqTEADecrypt(encrypted, key)
		if err != nil || !bytes.Equal(decrypted, data) {
			t.Fatalf("size %d: round trip failed: %v", size, err)
		}
		if _, err := qqTEADecrypt(encrypted, []byte("fedcba9876543210")); err == nil {
			t.Fatalf("size %d: wrong key should fail", size)
		}
	}
}

func TestQQSign(t *testing.T) {
	sign, mask := qqSign([]byte(`{"req":{}}`), "uid1", time.Unix(1700000000, 0), rand.Reader)
	raw, err := base64.StdEncoding.DecodeString(sign)
	// 12 个大写字母 + 20 字节 HMAC-SHA1
	if err != nil || len(raw) != 32 {
		t.Fatalf("sign = %q", sign)
	}
	for _, c := range raw[:12] {
		if c < 'A' || c > 'Z' {
			t.Fatalf("nonce should be uppercase letters: %q", raw[:12])
		}
	}
	cipher, err := base64.StdEncoding.DecodeString(mask)
	if err != nil {
		t.Fatal(err)
	}
	header, err := qqTEADecrypt(cipher, append([]byte(sign[:8]), sign[len(sign)-8:]...))
	if err != nil || string(header) != "6&111000&&&1700000000&uid1&" {
		t.Fatalf("mask header = %q, %v", header, err)
	}
}

// 真实请求 QQ 音乐（默认跳过）：NEO_LIVE_MUSIC=1 go test -run TestQQDesktopSearchLive ./internal/service/
func TestQQDesktopSearchLive(t *testing.T) {
	if os.Getenv("NEO_LIVE_MUSIC") == "" {
		t.Skip("set NEO_LIVE_MUSIC=1 to run against QQ Music")
	}
	candidates, err := searchQQSongsDesktop(context.Background(), "紫荆花盛开 李荣浩")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d candidates", len(candidates))
	for _, c := range candidates[:min(5, len(candidates))] {
		t.Logf("  %s | %s | %s | %.0fs | %s", c.Title, strings.Join(c.Artists, "/"), c.Album, c.Duration, c.MID)
	}
	best := bestLyricCandidate(candidates, lyricQuery{Title: "紫荆花盛开", Artists: []string{"李荣浩", "梁咏琪"}, Duration: 210})
	if best == nil {
		t.Fatal("no match")
	}
	t.Logf("best: %s %s", best.Title, best.MID)
}
