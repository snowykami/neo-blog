package utils

import (
	"crypto/subtle"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

const (
	emailVerifyCodeTTL     = 10 * time.Minute
	emailVerifyMaxAttempts = 5 // 同一个验证码最多尝试次数，超过即作废
	emailVerifyAttemptsKey = "email_verify_attempts:"
	emailVerifyCodeCharset = "0123456789abcdef"
	emailVerifyCodeLength  = 6
)

// EmailVerifyCodeTTL 验证码有效期：邮件正文里的说明取它，避免文案与实际有效期不一致
func EmailVerifyCodeTTL() time.Duration { return emailVerifyCodeTTL }

// RequestEmailVerify 生成验证码并存入共享状态（多实例部署时在任一实例都能校验）
func RequestEmailVerify(email string) string {
	email = strings.ToLower(email)
	generatedVerificationCode := Strings.GenerateRandomStringWithCharset(emailVerifyCodeLength, emailVerifyCodeCharset)
	store := sharedstate.Current()
	if err := store.Set(constant.KVKeyEmailVerificationCode+email, generatedVerificationCode, emailVerifyCodeTTL); err != nil {
		logrus.Errorf("save email verification code failed: %v", err)
	}
	_ = store.Delete(emailVerifyAttemptsKey + email)
	return generatedVerificationCode
}

// VerifyEmailCode 校验验证码，成功后作废；共享状态不可用时校验失败
func VerifyEmailCode(email, code string) bool {
	email = strings.ToLower(email)
	store := sharedstate.Current()
	codeKey := constant.KVKeyEmailVerificationCode + email
	stored, ok, err := store.Get(codeKey)
	if err != nil || !ok {
		return false
	}
	if stored == "" || subtle.ConstantTimeCompare([]byte(stored), []byte(strings.ToLower(code))) != 1 {
		// 失败次数过多时作废验证码，防止暴力枚举
		if attempts, err := store.Incr(emailVerifyAttemptsKey+email, emailVerifyCodeTTL); err == nil && attempts >= emailVerifyMaxAttempts {
			_ = store.Delete(codeKey, emailVerifyAttemptsKey+email)
		}
		return false
	}
	// 原子作废，同一个验证码并发提交时只有一次成功
	if used, err := store.CompareAndDelete(codeKey, stored); err != nil || !used {
		return false
	}
	_ = store.Delete(emailVerifyAttemptsKey + email)
	return true
}
