package utils

import (
	"time"

	"github.com/snowykami/neo-blog/pkg/constant"
)

func RequestEmailVerify(email string) string {
	generatedVerificationCode := Strings.GenerateRandomStringWithCharset(6, "0123456789abcdef")
	kv := KV.GetInstance()
	kv.Set(constant.KVKeyEmailVerificationCode+email, generatedVerificationCode, time.Minute*10)
	return generatedVerificationCode
}

func VerifyEmailCode(email, code string) bool {
	kv := KV.GetInstance()
	storedCode, ok := kv.Get(constant.KVKeyEmailVerificationCode + email)
	if !ok {
		return false
	}
	if storedCode != code {
		return false
	}
	kv.Delete(constant.KVKeyEmailVerificationCode + email)
	return true
}
