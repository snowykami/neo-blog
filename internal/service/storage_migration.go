package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 存储迁移：把文件（及 HTML 页面）从一个存储复制到另一个存储，复制并校验大小后再修改 files.provider_id。
// 内容中只保存稳定链接，迁移不需要逐篇替换正文；开始前先把源存储遗留在内容中的直链还原为稳定链接。
// 源存储中的对象不会删除；存储中没有任何文件与 HTML 页面后才能删除该存储。中途失败或取消后重新发起即可继续。

const (
	storageMigrationActiveKey = "storage_migration:active" // 运行中的任务令牌，按租约续期，实例退出后自动过期
	storageMigrationStatusKey = "storage_migration:status"
	storageMigrationCancelKey = "storage_migration:cancel"
	storageMigrationLease     = time.Minute
	storageMigrationStatusTTL = 7 * 24 * time.Hour
	storageMigrationMaxErrors = 20
	storageMigrationMaxFiles  = 1000 // 按选中文件迁移时一次最多的文件数
	storageMigrationSaveEvery = time.Second
)

const (
	StorageMigrationRunning     = "running"
	StorageMigrationDone        = "done"
	StorageMigrationFailed      = "failed"
	StorageMigrationCanceled    = "canceled"
	StorageMigrationInterrupted = "interrupted"
)

// storageMigrationAfterRun 测试中等待后台任务结束
var storageMigrationAfterRun func()

// StartStorageMigration 校验并在后台启动迁移任务，返回初始进度
func StartStorageMigration(req *dto.StorageMigrationReq) (*dto.StorageMigrationStatus, *errs.ServiceError) {
	target, ok := storage.GetStorageProvider(req.TargetProviderID)
	if !ok {
		return nil, errs.NewBadRequest("storage_provider_not_found").WithField("target_provider_id", req.TargetProviderID)
	}
	fileIDs := slices.Compact(slices.Sorted(slices.Values(req.FileIDs)))
	if len(fileIDs) > storageMigrationMaxFiles {
		return nil, errs.NewBadRequest("too_many_files")
	}
	var sourceIDs []uint
	if len(fileIDs) > 0 {
		ids, err := repo.File.ProviderIDsOfFiles(fileIDs)
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("file")
		}
		sourceIDs = slices.DeleteFunc(ids, func(id uint) bool { return id == req.TargetProviderID })
	} else {
		if req.SourceProviderID == 0 || req.SourceProviderID == req.TargetProviderID {
			return nil, errs.NewBadRequest("invalid_storage_migration")
		}
		sourceIDs = []uint{req.SourceProviderID}
	}
	sources := make(map[uint]storageprovider.StorageProvider, len(sourceIDs))
	for _, id := range sourceIDs {
		provider, ok := storage.GetStorageProvider(id)
		if !ok {
			return nil, errs.NewBadRequest("storage_provider_not_found").WithField("source_provider_id", id)
		}
		sources[id] = provider
	}

	token := utils.Strings.GenerateRandomString(32)
	ok, err := sharedstate.Current().SetNX(storageMigrationActiveKey, token, storageMigrationLease)
	if err != nil {
		return nil, errs.Internal("failed_to_start_storage_migration", err)
	}
	if !ok {
		return nil, errs.NewConflict("storage_migration_running")
	}
	_ = sharedstate.Current().Delete(storageMigrationCancelKey)

	now := time.Now()
	m := &storageMigration{
		token:   token,
		fileIDs: fileIDs,
		target:  target,
		sources: sources,
		status: dto.StorageMigrationStatus{
			State:            StorageMigrationRunning,
			Phase:            "links",
			SourceProviderID: utils.Ternary(len(fileIDs) == 0, req.SourceProviderID, 0),
			TargetProviderID: req.TargetProviderID,
			ProviderIDs:      append(slices.Clone(sourceIDs), req.TargetProviderID),
			FileCount:        len(fileIDs),
			Errors:           []string{},
			StartedAt:        now,
			UpdatedAt:        now,
		},
	}
	m.save()
	go m.run()
	status := m.snapshot()
	return &status, nil
}

// GetStorageMigrationStatus 最近一次迁移的进度，没有时返回 nil
func GetStorageMigrationStatus() (*dto.StorageMigrationStatus, *errs.ServiceError) {
	var status dto.StorageMigrationStatus
	found, err := sharedstate.GetJSON(storageMigrationStatusKey, &status)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if !found {
		return nil, nil
	}
	if status.State == StorageMigrationRunning {
		if _, active, err := sharedstate.Current().Get(storageMigrationActiveKey); err == nil && !active {
			status.State = StorageMigrationInterrupted
		}
	}
	return &status, nil
}

// CancelStorageMigration 请求取消运行中的迁移，当前对象处理完后停止
func CancelStorageMigration() *errs.ServiceError {
	if _, active, err := sharedstate.Current().Get(storageMigrationActiveKey); err != nil {
		return errs.Internal("failed_to_cancel_storage_migration", err)
	} else if !active {
		return errs.NewBadRequest("storage_migration_not_running")
	}
	if err := sharedstate.Current().Set(storageMigrationCancelKey, "1", storageMigrationLease); err != nil {
		return errs.Internal("failed_to_cancel_storage_migration", err)
	}
	return nil
}

// storageMigrationBusy 存储是否正在参与迁移
func storageMigrationBusy(providerID uint) bool {
	status, svcerr := GetStorageMigrationStatus()
	return svcerr == nil && status != nil && status.State == StorageMigrationRunning && slices.Contains(status.ProviderIDs, providerID)
}

type storageMigration struct {
	token   string
	fileIDs []uint
	target  storageprovider.StorageProvider
	sources map[uint]storageprovider.StorageProvider

	mu       sync.Mutex
	status   dto.StorageMigrationStatus
	lastSave time.Time
}

func (m *storageMigration) snapshot() dto.StorageMigrationStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	status := m.status
	status.ProviderIDs = slices.Clone(m.status.ProviderIDs)
	status.Errors = slices.Clone(m.status.Errors)
	return status
}

func (m *storageMigration) update(fn func(s *dto.StorageMigrationStatus)) {
	m.mu.Lock()
	fn(&m.status)
	m.status.UpdatedAt = time.Now()
	due := time.Since(m.lastSave) >= storageMigrationSaveEvery
	m.mu.Unlock()
	if due {
		m.save()
	}
}

func (m *storageMigration) save() {
	status := m.snapshot()
	m.mu.Lock()
	m.lastSave = time.Now()
	m.mu.Unlock()
	if err := sharedstate.SetJSON(storageMigrationStatusKey, status, storageMigrationStatusTTL); err != nil {
		logrus.Warnf("保存存储迁移进度失败: %v", err)
	}
}

func (m *storageMigration) addError(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	logrus.Warn("存储迁移: ", msg)
	m.update(func(s *dto.StorageMigrationStatus) {
		s.Errors = append(s.Errors, msg)
		if len(s.Errors) > storageMigrationMaxErrors {
			s.Errors = s.Errors[len(s.Errors)-storageMigrationMaxErrors:]
		}
	})
}

func (m *storageMigration) canceled() bool {
	_, ok, err := sharedstate.Current().Get(storageMigrationCancelKey)
	return err == nil && ok
}

func (m *storageMigration) finish(state string) {
	now := time.Now()
	m.update(func(s *dto.StorageMigrationStatus) {
		s.State = state
		s.FinishedAt = &now
	})
	m.save()
}

// keepAlive 运行期间续期任务令牌
func (m *storageMigration) keepAlive(stop <-chan struct{}) {
	ticker := time.NewTicker(storageMigrationLease / 3)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if err := sharedstate.Current().Set(storageMigrationActiveKey, m.token, storageMigrationLease); err != nil {
				logrus.Warnf("续期存储迁移任务失败: %v", err)
			}
		}
	}
}

func (m *storageMigration) run() {
	stop := make(chan struct{})
	go m.keepAlive(stop)
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("存储迁移异常退出: %v", r)
			m.addError("panic: %v", r)
			m.finish(StorageMigrationFailed)
		}
		close(stop)
		if _, err := sharedstate.Current().CompareAndDelete(storageMigrationActiveKey, m.token); err != nil {
			logrus.Warnf("释放存储迁移任务失败: %v", err)
		}
		_ = sharedstate.Current().Delete(storageMigrationCancelKey)
		if storageMigrationAfterRun != nil {
			storageMigrationAfterRun()
		}
	}()
	ctx := context.Background()

	// 1. 先把源存储遗留在内容中的直链还原为稳定链接，否则迁移后这些直链会随源存储失效
	sourceIDs := make([]uint, 0, len(m.sources))
	for id := range m.sources {
		sourceIDs = append(sourceIDs, id)
	}
	if len(sourceIDs) > 0 {
		changed, err := normalizeStoredFileLinks(currentDirectLinkMatchers(sourceIDs...))
		m.update(func(s *dto.StorageMigrationStatus) { s.LinksUpdated = changed })
		if err != nil {
			m.addError("normalize links: %v", err)
			m.finish(StorageMigrationFailed)
			return
		}
	}

	// 2. 复制文件对象
	var objects []repo.StorageObject
	var err error
	if len(m.fileIDs) > 0 {
		objects, err = repo.File.ListStorageObjects(0, m.fileIDs)
	} else {
		objects, err = repo.File.ListStorageObjects(m.status.SourceProviderID, nil)
	}
	if err != nil {
		m.addError("list files: %v", err)
		m.finish(StorageMigrationFailed)
		return
	}
	objects = slices.DeleteFunc(objects, func(o repo.StorageObject) bool { return o.ProviderID == m.status.TargetProviderID })
	var totalBytes int64
	for _, o := range objects {
		totalBytes += o.Size
	}
	m.update(func(s *dto.StorageMigrationStatus) {
		s.Phase = "files"
		s.Objects = len(objects)
		s.TotalBytes = totalBytes
	})
	moved := false
	for _, object := range objects {
		if m.canceled() {
			m.afterMove(moved)
			m.finish(StorageMigrationCanceled)
			return
		}
		copied, size, err := copyStorageObject(ctx, m.sources[object.ProviderID], m.target, fileStoragePath(object.Hash))
		if err == nil {
			err = repo.File.MoveObject(object, m.fileIDs, m.status.TargetProviderID)
		}
		if err != nil {
			m.addError("file %s: %v", object.Hash, err)
		} else {
			moved = true
		}
		m.update(func(s *dto.StorageMigrationStatus) {
			s.Done++
			s.Bytes += size
			if err != nil {
				s.Failed++
			} else if copied {
				s.Copied++
			}
		})
	}

	// 3. 迁移整个存储时一并复制 HTML 页面的各个版本
	if len(m.fileIDs) == 0 {
		versions, err := repo.PageHTML.ListByProvider(m.status.SourceProviderID)
		if err != nil {
			m.addError("list page html versions: %v", err)
			m.afterMove(moved)
			m.finish(StorageMigrationFailed)
			return
		}
		m.update(func(s *dto.StorageMigrationStatus) {
			s.Phase = "pages"
			s.PageHTMLVersions = len(versions)
		})
		source := m.sources[m.status.SourceProviderID]
		for i := range versions {
			if m.canceled() {
				m.afterMove(moved)
				m.finish(StorageMigrationCanceled)
				return
			}
			err := m.copyPageHTMLVersion(ctx, source, &versions[i])
			if err != nil {
				m.addError("page %d version %d: %v", versions[i].PageID, versions[i].Version, err)
			}
			m.update(func(s *dto.StorageMigrationStatus) {
				s.PageHTMLDone++
				if err != nil {
					s.Failed++
				}
			})
		}
	}

	m.afterMove(moved)
	m.finish(utils.Ternary(m.snapshot().Failed > 0, StorageMigrationFailed, StorageMigrationDone))
}

// afterMove 文件改了存储后清空各实例的文件位置缓存，接口随即返回新存储的直链（或代理链接）
func (m *storageMigration) afterMove(moved bool) {
	if moved {
		fileLinksChanged()
	}
}

func (m *storageMigration) copyPageHTMLVersion(ctx context.Context, source storageprovider.StorageProvider, version *model.PageHTMLVersion) error {
	for _, f := range version.Files {
		if _, _, err := copyStorageObject(ctx, source, m.target, pageHTMLStoragePath(version.PageID, version.Key, f.Path)); err != nil {
			return fmt.Errorf("%s: %w", f.Path, err)
		}
	}
	return repo.PageHTML.UpdateProvider(version.ID, m.status.TargetProviderID)
}

// copyStorageObject 把对象复制到目标存储并校验大小；目标中已有同样大小的对象时跳过复制（对象按内容哈希命名）
func copyStorageObject(ctx context.Context, source, target storageprovider.StorageProvider, objectPath string) (copied bool, size int64, err error) {
	if source == nil {
		return false, 0, errors.New("source storage provider unavailable")
	}
	info, err := source.Stat(ctx, objectPath)
	if err != nil {
		return false, 0, fmt.Errorf("stat source: %w", err)
	}
	size = info.Size()
	if existing, err := target.Stat(ctx, objectPath); err == nil && existing.Size() == size {
		return false, size, nil
	}
	src, err := source.Open(ctx, objectPath)
	if err != nil {
		return false, size, fmt.Errorf("open source: %w", err)
	}
	defer src.Close()
	if err := target.Save(ctx, objectPath, src); err != nil {
		return false, size, fmt.Errorf("save target: %w", err)
	}
	info, err = target.Stat(ctx, objectPath)
	if err != nil {
		return true, size, fmt.Errorf("verify target: %w", err)
	}
	if info.Size() != size {
		return true, size, fmt.Errorf("size mismatch: source %d, target %d", size, info.Size())
	}
	return true, size, nil
}
