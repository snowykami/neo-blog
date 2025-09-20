package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime/multipart"
)

// FilePath 根据哈希值生成文件路径，前4位为目录位hash[0:4]/hash
func FilePath(hash string) (dir, file string) {
	dir = hash[0:4]
	file = hash
	return
}

func FileHashFromStream(file multipart.File) (string, error) {
	// 创建哈希计算器
	hash := sha256.New()

	// 将文件流内容拷贝到哈希计算器
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	// 计算哈希值并转换为十六进制字符串
	hashInBytes := hash.Sum(nil)
	hashString := hex.EncodeToString(hashInBytes)

	return hashString, nil
}
