package storage

import (
	"fmt"
	"maps"
	"sync"
	"sync/atomic"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/internal/storage/s3"
	"github.com/snowykami/neo-blog/internal/storage/webdav"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

var (
	providers        = make(map[uint]storageprovider.StorageProvider)
	providersMu      sync.RWMutex
	providersVersion atomic.Uint64
)

// ProvidersVersion 当前存储提供者快照的版本号，每次替换时自增（供正则缓存等按版本失效）
func ProvidersVersion() uint64 {
	return providersVersion.Load()
}

// SupportedProviderTypes 已实现的存储类型
var SupportedProviderTypes = []string{"local", "webdav", "s3"}

func GetStorageProvider(id uint) (storageprovider.StorageProvider, bool) {
	providersMu.RLock()
	defer providersMu.RUnlock()
	provider, ok := providers[id]
	return provider, ok
}

// ListStorageProviders 已注册存储提供者的快照
func ListStorageProviders() map[uint]storageprovider.StorageProvider {
	providersMu.RLock()
	defer providersMu.RUnlock()
	return maps.Clone(providers)
}

// ReplaceStorageProviders 整体替换已注册的存储提供者，已删除的提供者不会残留
func ReplaceStorageProviders(next map[uint]storageprovider.StorageProvider) {
	providersMu.Lock()
	providers = next
	providersVersion.Add(1)
	providersMu.Unlock()
}

func NewStorageProvider(providerConfig model.StorageProviderModelAndDto) (storageprovider.StorageProvider, error) {
	switch providerConfig.Type {
	case "local":
		return local.NewLocalStorageProvider(providerConfig)
	case "webdav":
		return webdav.NewWebDAVStorageProvider(providerConfig)
	case "s3":
		return s3.NewS3StorageProvider(providerConfig)
	default:
		return nil, fmt.Errorf("unsupported storage provider type: %s", providerConfig.Type)
	}
}

func GetDefaultStorageProvider() (storageprovider.StorageProvider, bool) {
	providersMu.RLock()
	defer providersMu.RUnlock()
	for _, provider := range providers {
		if provider != nil {
			if provider.IsDefault() {
				return provider, true
			}
		}
	}
	return nil, false
}

func GetDefaultStorageProviderID() uint {
	providersMu.RLock()
	defer providersMu.RUnlock()
	for id, provider := range providers {
		if provider != nil {
			if provider.IsDefault() {
				return id
			}
		}
	}
	return 0
}
