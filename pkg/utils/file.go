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

// DirectSafeContentType 可跳过后端 CSP 沙箱直接由外部对象存储提供的类型：SVG 可内嵌脚本，必须经后端附带 sandbox CSP 返回
func DirectSafeContentType(contentType string) bool {
	return InlineContentType(contentType) && !strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "image/svg+xml")
}

// ServedContentType 对象存储对外提供时的类型：可安全直连展示的保持原样，SVG 与其他类型一律按二进制存储（防止直链被当作网页或可执行 SVG 渲染）
func ServedContentType(contentType string) string {
	if DirectSafeContentType(contentType) {
		return contentType
	}
	return "application/octet-stream"
}
