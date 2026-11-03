package utils

import (
	"testing"
	"time"
)

func TestJwtNew2TokensSetsTokenTypes(t *testing.T) {
	token, refreshToken, err := Jwt.New2Tokens(1, "session-id", false)
	if err != nil {
		t.Fatalf("New2Tokens failed: %v", err)
	}

	tokenClaims, err := Jwt.ParseJsonWebTokenWithoutState(token)
	if err != nil {
		t.Fatalf("Parse access token failed: %v", err)
	}
	if tokenClaims.TokenType != JwtTokenTypeAccess {
		t.Fatalf("access token type = %q, want %q", tokenClaims.TokenType, JwtTokenTypeAccess)
	}

	refreshClaims, err := Jwt.ParseJsonWebTokenWithoutState(refreshToken)
	if err != nil {
		t.Fatalf("Parse refresh token failed: %v", err)
	}
	if refreshClaims.TokenType != JwtTokenTypeRefresh {
		t.Fatalf("refresh token type = %q, want %q", refreshClaims.TokenType, JwtTokenTypeRefresh)
	}
}

// 有效期由注入的配置决定；「记住我」写入刷新令牌并在续期时可读出，旧令牌按签发时的有效期判断
func TestJwtDurationsAndRememberMe(t *testing.T) {
	t.Cleanup(func() { Jwt.Durations = nil })
	Jwt.Durations = func() JwtDurations {
		return JwtDurations{Access: 5 * time.Minute, Refresh: 7 * 24 * time.Hour, RefreshRemember: 30 * 24 * time.Hour}
	}
	lifetime := func(claims *Claims) time.Duration { return claims.ExpiresAt.Sub(claims.IssuedAt.Time) }

	if got := lifetime(Jwt.NewTokenClaims(1, "s")); got != 5*time.Minute {
		t.Fatalf("access lifetime = %v", got)
	}
	normal := Jwt.NewRefreshClaims(1, "s", false)
	remember := Jwt.NewRefreshClaims(1, "s", true)
	if lifetime(normal) != 7*24*time.Hour || normal.RememberMe() {
		t.Fatalf("normal refresh: %v remember=%v", lifetime(normal), normal.RememberMe())
	}
	if lifetime(remember) != 30*24*time.Hour || !remember.RememberMe() {
		t.Fatalf("remember refresh: %v remember=%v", lifetime(remember), remember.RememberMe())
	}

	// 旧令牌没有 remember 标记：签发时的有效期（旧版记住我为 15 天）超过普通有效期即视为记住我
	legacy := Jwt.NewClaims(1, "s", 15*24*time.Hour, JwtTokenTypeRefresh)
	if !legacy.RememberMe() {
		t.Fatal("legacy 15-day refresh token should count as remember me")
	}
	if Jwt.NewClaims(1, "s", 3*24*time.Hour, JwtTokenTypeRefresh).RememberMe() {
		t.Fatal("legacy 3-day refresh token should not count as remember me")
	}

	// Cookie 保留到令牌真正到期（「记住我」为 30 天，而不是普通有效期）
	_, refreshToken, err := Jwt.New2Tokens(1, "s", true)
	if err != nil {
		t.Fatal(err)
	}
	if age := Jwt.CookieMaxAge(refreshToken, time.Hour); age < 30*24*60*60-5 || age > 30*24*60*60 {
		t.Fatalf("cookie max age = %d", age)
	}
	if age := Jwt.CookieMaxAge("not-a-token", time.Hour); age != 3600 {
		t.Fatalf("fallback max age = %d", age)
	}
}
