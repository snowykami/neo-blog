package utils

import (
	"crypto/rand"
	"math/big"
)

type stringsUtils struct{}

var Strings = stringsUtils{}

func (s *stringsUtils) GenerateRandomString(length int) string {
	return s.GenerateRandomStringWithCharset(length, "")
}

func (s *stringsUtils) GenerateRandomStringWithCharset(length int, charset string) string {
	if charset == "" {
		charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	}
	// 使用 crypto/rand，用于会话 ID、OIDC state、验证码等安全场景
	result := make([]byte, length)
	for i := range result {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			panic(err) // 系统随机源不可用时无法安全继续
		}
		result[i] = charset[n.Int64()]
	}
	return string(result)
}
