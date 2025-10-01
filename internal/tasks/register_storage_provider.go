package tasks

import (
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
)

func InitStorageProvider() error {
	return ReloadStorageProviders()
}

func ReloadStorageProviders() error {
	providerModels, err := repo.File.ListStorageProviders()
	if err != nil {
		return err
	}
	for _, p := range providerModels {
		storageProvider, err := storage.NewStorageProvider(p)
		if err != nil {
			logrus.Error("初始化存储提供者失败: ", err)
			continue
		}
		storage.SetStorageProvider(p.ID, storageProvider)
		logrus.Info("注册存储提供者: ", p.Name)
	}
	_, ok := storage.GetDefaultStorageProvider()
	if !ok {
		logrus.Warn("没有找到默认存储提供者")
	}
	return nil
}
