package utils

import (
	"testing"
	"time"
)

func TestAllowRequest(t *testing.T) {
	key := "test_allow_request"
	for i := 0; i < 3; i++ {
		if !AllowRequest(key, 3, time.Minute) {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if AllowRequest(key, 3, time.Minute) {
		t.Fatalf("4th request should be limited")
	}
}

func TestVerifyEmailCodeAttemptsLimit(t *testing.T) {
	email := "Limit@Test.local"
	code := RequestEmailVerify(email)
	for i := 0; i < emailVerifyMaxAttempts; i++ {
		if VerifyEmailCode(email, "zzzzzz") {
			t.Fatalf("wrong code should fail")
		}
	}
	// 失败次数达到上限后，正确的验证码也已作废
	if VerifyEmailCode(email, code) {
		t.Fatalf("code should be invalidated after too many failures")
	}
	code = RequestEmailVerify(email)
	if !VerifyEmailCode("limit@test.local", code) {
		t.Fatalf("new code should verify (case-insensitive email)")
	}
	if VerifyEmailCode(email, code) {
		t.Fatalf("code should be single-use")
	}
}
