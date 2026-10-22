package storage

import (
	"fmt"
	"sync"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/internal/storage/s3"
	"github.com/snowykami/neo-blog/internal/storage/webdav"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

var (
	providers   = make(map[uint]storageprovider.StorageProvider)
	providersMu sync.RWMutex
)

// SupportedProviderTypes 已实现的存储类型
var SupportedProviderTypes = []string{"local", "webdav", "s3"}

func GetStorageProvider(id uint) (storageprovider.StorageProvider, bool) {
	providersMu.RLock()
	defer providersMu.RUnlock()
	provider, ok := providers[id]
	return provider, ok
}

// ReplaceStorageProviders 整体替换已注册的存储提供者，已删除的提供者不会残留
func ReplaceStorageProviders(next map[uint]storageprovider.StorageProvider) {
	providersMu.Lock()
	defer providersMu.Unlock()
	providers = next
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
