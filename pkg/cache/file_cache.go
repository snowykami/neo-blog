package cache

import (
	"os"
	"strconv"

	"github.com/sirupsen/logrus"
)

var (
	// FileCache 全局文件缓存实例
	FileCache *LRUCache
)

// InitFileCache 初始化文件缓存
// 从环境变量 MAX_CACHE_FILE 读取缓存大小，默认为 100
// 从环境变量 MAX_CACHE_SIZE_MB 读取最大缓存字节数（MB），默认为 100MB
func InitFileCache() {
	maxCacheFile := 100 // 默认值

	if envValue := os.Getenv("MAX_CACHE_FILE"); envValue != "" {
		if val, err := strconv.Atoi(envValue); err == nil && val > 0 {
			maxCacheFile = val
		} else {
			logrus.Warnf("Invalid MAX_CACHE_FILE value: %s, using default: %d", envValue, maxCacheFile)
		}
	}

	maxCacheSizeMB := 100 // 默认100MB
	if envValue := os.Getenv("MAX_CACHE_SIZE_MB"); envValue != "" {
		if val, err := strconv.Atoi(envValue); err == nil && val > 0 {
			maxCacheSizeMB = val
		} else {
			logrus.Warnf("Invalid MAX_CACHE_SIZE_MB value: %s, using default: %d", envValue, maxCacheSizeMB)
		}
	}

	maxCacheBytes := int64(maxCacheSizeMB) * 1024 * 1024
	FileCache = NewLRUCacheWithSize(maxCacheFile, maxCacheBytes)
	logrus.Infof("File cache initialized with capacity: %d files, max size: %d MB", maxCacheFile, maxCacheSizeMB)
}

// GetFileCache 获取文件缓存实例
func GetFileCache() *LRUCache {
	if FileCache == nil {
		InitFileCache()
	}
	return FileCache
}
