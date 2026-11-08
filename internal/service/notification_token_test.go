package service

import (
	"strings"
	"testing"
	"time"
)

func TestNotificationPrefsToken(t *testing.T) {
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	token := SignNotificationPrefsToken(42, now)
	userID, err := ParseNotificationPrefsToken(token, now)
	if err != nil || userID != 42 {
		t.Fatalf("parse = %d, %v", userID, err)
	}
	// 72 小时内有效
	if _, err := ParseNotificationPrefsToken(token, now.Add(71*time.Hour)); err != nil {
		t.Fatalf("token should still be valid: %v", err)
	}
	if _, err := ParseNotificationPrefsToken(token, now.Add(73*time.Hour)); err == nil {
		t.Fatal("token should expire after 72 hours")
	}
	// 篡改负载或签名都无效
	parts := strings.Split(token, ".")
	if _, err := ParseNotificationPrefsToken("x"+parts[0]+"."+parts[1], now); err == nil {
		t.Fatal("tampered payload should be rejected")
	}
	if _, err := ParseNotificationPrefsToken(parts[0]+".x"+parts[1], now); err == nil {
		t.Fatal("tampered signature should be rejected")
	}
	if _, err := ParseNotificationPrefsToken("garbage", now); err == nil {
		t.Fatal("malformed token should be rejected")
	}
	// 同一用户同一时刻签出的凭据稳定，便于排查
	if SignNotificationPrefsToken(42, now) != token {
		t.Fatal("token should be deterministic")
	}
	if SignNotificationPrefsToken(43, now) == token {
		t.Fatal("different users must not share a token")
	}
}
