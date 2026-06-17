package utils

import "testing"

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
