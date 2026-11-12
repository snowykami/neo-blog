package tasks

import (
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

// storageProvidersChangedChannel 存储提供者增删改后通知其他实例重新加载
const storageProvidersChangedChannel = "storage_providers_changed"

func InitStorageProvider() error {
	return ReloadStorageProviders()
}

// StorageProvidersChanged 管理员增删改存储提供者后调用：重新加载本实例并通知其他实例
func StorageProvidersChanged() error {
	if err := ReloadStorageProviders(); err != nil {
		return err
	}
	sharedstate.Notify(storageProvidersChangedChannel, "")
	return nil
}

// ListenStorageProviderChanges 其他实例修改存储提供者后（或与 Redis 断线重连后）重新加载
func ListenStorageProviderChanges() {
	sharedstate.OnNotify(storageProvidersChangedChannel, func(string) {
		if err := ReloadStorageProviders(); err != nil {
			logrus.Errorf("reload storage providers failed: %v", err)
		}
	})
}

// ReloadStorageProviders 从数据库重新加载本实例的存储提供者
func ReloadStorageProviders() error {
	if repo.GetDB() == nil {
		return repo.ErrDatabaseNotInitialized
	}
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
		if p.Type == "local" && sharedstate.Shared() {
			logrus.Warnf("存储提供者 %s 为本地存储：多副本部署时文件只在写入的实例上，请改用 S3 / WebDAV，或为所有实例挂载同一个共享卷", p.Name)
		}
	}
	storage.ReplaceStorageProviders(next)
	_, ok := storage.GetDefaultStorageProvider()
	if !ok {
		logrus.Warn("没有找到默认存储提供者")
	}
	return nil
}
