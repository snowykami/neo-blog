package tasks

import (
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

func InitStorageProvider() error {
	return ReloadStorageProviders()
}

func ReloadStorageProviders() error {
	providerModels, err := repo.File.ListStorageProviders()
	if err != nil {
		return err
	}
	next := make(map[uint]storageprovider.StorageProvider, len(providerModels))
	for _, p := range providerModels {
		storageProvider, err := storage.NewStorageProvider(p)
		if err != nil {
			logrus.Error("初始化存储提供者失败: ", err)
			continue
		}
		next[p.ID] = storageProvider
		logrus.Info("注册存储提供者: ", p.Name)
	}
	storage.ReplaceStorageProviders(next)
	_, ok := storage.GetDefaultStorageProvider()
	if !ok {
		logrus.Warn("没有找到默认存储提供者")
	}
	return nil
}
