package service

import (
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// storageLocationChanged 存放位置是否变化：已有文件的存储改了位置，原有文件就找不到了；
// 名称、凭证、区域、端点、公开地址等不影响对象所在位置，可以随时修改
func storageLocationChanged(current, next *model.StorageProviderModelAndDto) bool {
	trim := func(s string) string { return strings.Trim(strings.TrimSpace(s), "/") }
	return current.Type != next.Type ||
		trim(current.BaseDir) != trim(next.BaseDir) ||
		trim(current.S3Bucket) != trim(next.S3Bucket) ||
		trim(current.S3Prefix) != trim(next.S3Prefix) ||
		trim(current.WebDAVEndpoint) != trim(next.WebDAVEndpoint)
}

// UpdateStorageProvider 修改存储提供者：迁移中的存储不能修改，有文件的存储不能修改存放位置；
// 修改公开地址前先把内容中旧地址的直链还原为稳定链接，之后接口按新地址返回直链
func UpdateStorageProvider(id uint, next *model.StorageProviderModelAndDto) *errs.ServiceError {
	if storageMigrationBusy(id) {
		return errs.NewConflict("storage_migration_running")
	}
	current, err := repo.File.GetStorageProvider(id)
	if err != nil {
		return errs.FromDB(err, "storage_provider", "failed_to_get_target")
	}
	usage, err := repo.File.ProviderUsage(id)
	if err != nil {
		return errs.Internal("failed_to_check_target", err).WithResource("storage_provider")
	}
	if usage.InUse() && storageLocationChanged(&current, next) {
		return errs.NewBadRequest("storage_provider_location_locked")
	}
	if usage.Files > 0 {
		if svcerr := normalizeLinksBeforeURLChange(id, next); svcerr != nil {
			return svcerr
		}
	}
	return repo.File.UpdateStorageProvider(id, next)
}

// normalizeLinksBeforeURLChange 直链地址将要变化（或不再直连）时，把内容中按当前地址保存的直链还原为稳定链接
func normalizeLinksBeforeURLChange(id uint, next *model.StorageProviderModelAndDto) *errs.ServiceError {
	provider, ok := storage.GetStorageProvider(id)
	if !ok {
		return nil
	}
	old, ok := newDirectLinkMatcher(id, provider)
	if !ok {
		return nil
	}
	if nextProvider, err := storage.NewStorageProvider(*next); err == nil {
		if m, ok := newDirectLinkMatcher(id, nextProvider); ok && m.prefix == old.prefix {
			return nil
		}
	}
	changed, err := normalizeStoredFileLinks([]directLinkMatcher{old})
	if err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("storage_provider")
	}
	logrus.Infof("存储 %d 的公开地址变化，已把 %d 条记录中的直链还原为稳定链接", id, changed)
	return nil
}

// DeleteStorageProvider 删除存储提供者：迁移中、仍有文件或 HTML 页面的存储不能删除
func DeleteStorageProvider(id uint) *errs.ServiceError {
	if storageMigrationBusy(id) {
		return errs.NewConflict("storage_migration_running")
	}
	return repo.File.DeleteStorageProvider(id)
}

// ListStorageProviderUsage 各存储提供者存放的文件数、字节数与 HTML 页面版本数
func ListStorageProviderUsage() (map[uint]repo.StorageProviderUsage, *errs.ServiceError) {
	usage, err := repo.File.ListProviderUsage()
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("storage_provider")
	}
	return usage, nil
}
