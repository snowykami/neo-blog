package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"golang.org/x/crypto/bcrypt"
)

type PasswordType struct {
}

var Password = PasswordType{}

// HashPassword 密码哈希函数
func (u *PasswordType) HashPassword(password string, salt string) (string, error) {
	saltedPassword := Password.addSalt(password, salt)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(saltedPassword), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hashedPassword), nil
}

// VerifyPassword 验证密码
func (u *PasswordType) VerifyPassword(password, hashedPassword string, salt string) bool {
	if len(hashedPassword) == 0 || len(salt) == 0 {
		// 防止oidc空密码出问题
		return false
	}
	saltedPassword := Password.addSalt(password, salt)
	err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(saltedPassword))
	return err == nil
}

// addSalt 加盐函数
func (u *PasswordType) addSalt(password string, salt string) string {
	combined := password + salt
	hash := sha256.New()
	hash.Write([]byte(combined))
	return hex.EncodeToString(hash.Sum(nil))
}
