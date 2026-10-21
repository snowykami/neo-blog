package utils

import (
	"crypto/subtle"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/pkg/constant"
)

const (
	emailVerifyCodeTTL     = 10 * time.Minute
	emailVerifyMaxAttempts = 5 // 同一个验证码最多尝试次数，超过即作废
	emailVerifyAttemptsKey = "email_verify_attempts:"
	emailVerifyCodeCharset = "0123456789abcdef"
	emailVerifyCodeLength  = 6
)

func RequestEmailVerify(email string) string {
	email = strings.ToLower(email)
	generatedVerificationCode := Strings.GenerateRandomStringWithCharset(emailVerifyCodeLength, emailVerifyCodeCharset)
	kv := KV.GetInstance()
	kv.Set(constant.KVKeyEmailVerificationCode+email, generatedVerificationCode, emailVerifyCodeTTL)
	kv.Delete(emailVerifyAttemptsKey + email)
	return generatedVerificationCode
}

func VerifyEmailCode(email, code string) bool {
	email = strings.ToLower(email)
	kv := KV.GetInstance()
	storedCode, ok := kv.Get(constant.KVKeyEmailVerificationCode + email)
	if !ok {
		return false
	}
	stored, _ := storedCode.(string)
	if stored == "" || subtle.ConstantTimeCompare([]byte(stored), []byte(strings.ToLower(code))) != 1 {
		// 失败次数过多时作废验证码，防止暴力枚举
		if kv.Incr(emailVerifyAttemptsKey+email, emailVerifyCodeTTL) >= emailVerifyMaxAttempts {
			kv.Delete(constant.KVKeyEmailVerificationCode + email)
			kv.Delete(emailVerifyAttemptsKey + email)
		}
		return false
	}
	kv.Delete(constant.KVKeyEmailVerificationCode + email)
	kv.Delete(emailVerifyAttemptsKey + email)
	return true
}
