package storage

import (
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/internal/storage/s3"
	"github.com/snowykami/neo-blog/internal/storage/webdav"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

var providers = make(map[uint]storageprovider.StorageProvider)

func GetStorageProvider(id uint) (storageprovider.StorageProvider, bool) {
	provider, ok := providers[id]
	return provider, ok
}

func SetStorageProvider(id uint, provider storageprovider.StorageProvider) {
	providers[id] = provider
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
		return nil, nil
	}
}

func GetDefaultStorageProvider() (storageprovider.StorageProvider, bool) {
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
	for id, provider := range providers {
		if provider != nil {
			if provider.IsDefault() {
				return id
			}
		}
	}
	return 0
}
