package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"
)

// FilePath 根据哈希值生成文件路径，前4位为目录位hash[0:4]/hash
func FilePath(hash string) (dir, file string) {
	dir = hash[0:4]
	file = hash
	return
}

func FileHashFromStream(file io.Reader) (string, error) {
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

// InlineContentType 浏览器可以直接显示的类型（图片、音视频、PDF、纯文本）；其他类型按附件下载
func InlineContentType(contentType string) bool {
	for _, prefix := range []string{"image/", "video/", "audio/", "application/pdf", "text/plain"} {
		if strings.HasPrefix(contentType, prefix) {
			return true
		}
	}
	return false
}

// ServedContentType 文件对外提供时的类型：可直接显示的保持原样，其他一律按二进制下载（上传的 HTML 等不会被当作网页渲染）
func ServedContentType(contentType string) string {
	if InlineContentType(contentType) {
		return contentType
	}
	return "application/octet-stream"
}
