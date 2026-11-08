package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/pkg/utils"
)

// 邮件里「通知设置」链接用的免登录凭据：只能操作通知偏好，不落库、可过期（见 N11）。
// 密钥从 JWT 签名密钥派生，避免多个用途共用同一个原始密钥

const (
	notificationTokenTTL     = 72 * time.Hour
	notificationTokenPurpose = "notif-prefs"
)

// ErrNotificationToken 凭据无效或已过期
var ErrNotificationToken = errors.New("invalid notification token")

// notificationTokenKey 派生出的专用密钥
func notificationTokenKey() []byte {
	mac := hmac.New(sha256.New, []byte(utils.Jwt.SigningSecret()))
	mac.Write([]byte(notificationTokenPurpose))
	return mac.Sum(nil)
}

// SignNotificationPrefsToken 签发凭据，格式 base64url(userID|purpose|exp).base64url(hmac)
func SignNotificationPrefsToken(userID uint, now time.Time) string {
	payload := fmt.Sprintf("%d|%s|%d", userID, notificationTokenPurpose, now.Add(notificationTokenTTL).Unix())
	signature := signNotificationPayload(payload)
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(signature)
}

// ParseNotificationPrefsToken 校验凭据并返回用户 id；过期、签名不符、格式不对一律视为无效
func ParseNotificationPrefsToken(token string, now time.Time) (uint, error) {
	encodedPayload, encodedSignature, ok := strings.Cut(strings.TrimSpace(token), ".")
	if !ok {
		return 0, ErrNotificationToken
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(encodedPayload)
	if err != nil {
		return 0, ErrNotificationToken
	}
	signature, err := base64.RawURLEncoding.DecodeString(encodedSignature)
	if err != nil {
		return 0, ErrNotificationToken
	}
	payload := string(payloadBytes)
	if !hmac.Equal(signature, signNotificationPayload(payload)) {
		return 0, ErrNotificationToken
	}
	parts := strings.Split(payload, "|")
	if len(parts) != 3 || parts[1] != notificationTokenPurpose {
		return 0, ErrNotificationToken
	}
	userID, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil || userID == 0 {
		return 0, ErrNotificationToken
	}
	expiresAt, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || now.Unix() > expiresAt {
		return 0, ErrNotificationToken
	}
	return uint(userID), nil
}

func signNotificationPayload(payload string) []byte {
	mac := hmac.New(sha256.New, notificationTokenKey())
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}
