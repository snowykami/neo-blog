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
// 源存储中的对象不会删除；存储中没有任何文件与 HTML 页面后才能删除该存储。中途失败或取消后重新发起即可继续；
// 执行的实例中途退出（如滚动更新）时，由定时任务 ResumeStorageMigration 按保存的参数在其他实例上自动继续。

const (
	storageMigrationActiveKey  = "storage_migration:active" // 运行中的任务令牌，按租约续期，实例退出后自动过期
	storageMigrationStatusKey  = "storage_migration:status"
	storageMigrationCancelKey  = "storage_migration:cancel"
	storageMigrationRequestKey = "storage_migration:request" // 运行中任务的参数，用于实例中途退出后自动继续
	storageMigrationMaxResumes = 5                           // 自动继续的次数上限，避免反复中断的任务无限重试
	storageMigrationLease      = time.Minute
	storageMigrationCancelTTL  = 24 * time.Hour
	storageMigrationStatusTTL  = 7 * 24 * time.Hour
	storageMigrationMaxErrors  = 20
	storageMigrationMaxFiles   = 1000 // 按选中文件迁移时一次最多的文件数
	storageMigrationSaveEvery  = time.Second
)

const (
	StorageMigrationRunning     = "running"
	StorageMigrationDone        = "done"
	StorageMigrationFailed      = "failed"
	StorageMigrationCanceled    = "canceled"
	StorageMigrationInterrupted = "interrupted"
)

// 测试用的钩子：storageMigrationBeforeRun 让后台任务停在开始处理之前，storageMigrationAfterRun 等待后台任务结束
var (
	storageMigrationBeforeRun func()
	storageMigrationAfterRun  func()
)

// storageMigrationRequest 保存的任务参数与已自动继续的次数
type storageMigrationRequest struct {
	dto.StorageMigrationReq
	Resumes int `json:"resumes"`
}

// StartStorageMigration 校验并在后台启动迁移任务，返回初始进度
func StartStorageMigration(req *dto.StorageMigrationReq) (*dto.StorageMigrationStatus, *errs.ServiceError) {
	return startStorageMigration(req, 0)
}

// ResumeStorageMigration 继续中途中断的迁移：进度仍为运行中、任务令牌已过期（执行的实例已退出）且保存了参数时，在本实例重新发起。
// 由定时任务调用；重新发起时用 SetNX 抢占任务令牌，多个实例不会同时继续
func ResumeStorageMigration() {
	var status dto.StorageMigrationStatus
	if found, err := sharedstate.GetJSON(storageMigrationStatusKey, &status); err != nil || !found || status.State != StorageMigrationRunning {
		return
	}
	if _, active, err := sharedstate.Current().Get(storageMigrationActiveKey); err != nil || active {
		return
	}
	var req storageMigrationRequest
	if found, err := sharedstate.GetJSON(storageMigrationRequestKey, &req); err != nil || !found {
		return
	}
	if req.Resumes >= storageMigrationMaxResumes {
		now := time.Now()
		status.State, status.FinishedAt, status.UpdatedAt = StorageMigrationFailed, &now, now
		status.Errors = append(status.Errors, "interrupted too many times, please start it again")
		if err := sharedstate.SetJSON(storageMigrationStatusKey, status, storageMigrationStatusTTL); err != nil {
			logrus.Warnf("保存存储迁移进度失败: %v", err)
		}
		_ = sharedstate.Current().Delete(storageMigrationRequestKey)
		return
	}
	if _, svcerr := startStorageMigration(&req.StorageMigrationReq, req.Resumes+1); svcerr != nil {
		logrus.Warnf("继续中断的存储迁移失败: %v", svcerr)
		return
	}
	logrus.Infof("已继续中断的存储迁移（第 %d 次）", req.Resumes+1)
}

func startStorageMigration(req *dto.StorageMigrationReq, resumes int) (*dto.StorageMigrationStatus, *errs.ServiceError) {
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

	lease, err := sharedstate.AcquireLease(storageMigrationActiveKey, storageMigrationLease)
	if err != nil {
		return nil, errs.Internal("failed_to_start_storage_migration", err)
	}
	if lease == nil {
		return nil, errs.NewConflict("storage_migration_running")
	}
	_ = sharedstate.Current().Delete(storageMigrationCancelKey)
	if err := sharedstate.SetJSON(storageMigrationRequestKey, storageMigrationRequest{StorageMigrationReq: *req, Resumes: resumes}, storageMigrationStatusTTL); err != nil {
		logrus.Warnf("保存存储迁移参数失败: %v", err)
	}

	now := time.Now()
	m := &storageMigration{
		lease:   lease,
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
	if err := sharedstate.Current().Set(storageMigrationCancelKey, "1", storageMigrationCancelTTL); err != nil {
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
	lease   *sharedstate.Lease
	fileIDs []uint
	target  storageprovider.StorageProvider
	sources map[uint]storageprovider.StorageProvider

	mu       sync.Mutex
	status   dto.StorageMigrationStatus
	lastSave time.Time
}

func (m *storageMigration) held() bool {
	return m.lease == nil || m.lease.Held()
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
	if !m.held() {
		return
	}
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
	if !m.held() {
		return
	}
	now := time.Now()
	m.update(func(s *dto.StorageMigrationStatus) {
		s.State = state
		s.FinishedAt = &now
	})
	m.save()
	// 已结束（完成、失败或取消）的任务不再自动继续
	_ = sharedstate.Current().Delete(storageMigrationRequestKey)
}

func (m *storageMigration) run() {
	ctx, cancel := context.WithCancel(context.Background())
	if m.lease != nil {
		go func() {
			select {
			case <-ctx.Done():
			case <-m.lease.Lost():
				logrus.Warn("存储迁移任务租约已失效，立即中止本实例迁移")
				cancel()
			}
		}()
	}
	defer func() {
		cancel()
		stillHeld := m.held()
		if r := recover(); r != nil {
			logrus.Errorf("存储迁移异常退出: %v", r)
			if stillHeld {
				m.addError("panic: %v", r)
				m.finish(StorageMigrationFailed)
			}
		}
		if stillHeld {
			_ = sharedstate.Current().Delete(storageMigrationCancelKey)
		}
		if m.lease != nil {
			m.lease.Release()
		}
		if storageMigrationAfterRun != nil {
			storageMigrationAfterRun()
		}
	}()
	if storageMigrationBeforeRun != nil {
		storageMigrationBeforeRun()
	}
	if !m.held() {
		return
	}

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
		if !m.held() {
			m.afterMove(moved)
			return
		}
		if m.canceled() {
			m.afterMove(moved)
			m.finish(StorageMigrationCanceled)
			return
		}
		copied, size, err := copyStorageObject(ctx, m.sources[object.ProviderID], m.target, fileStoragePath(object.Hash), utils.ServedContentType(object.MimeType))
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
			if !m.held() {
				m.afterMove(moved)
				return
			}
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
		if _, _, err := copyStorageObject(ctx, source, m.target, pageHTMLStoragePath(version.PageID, version.Key, f.Path), ""); err != nil {
			return fmt.Errorf("%s: %w", f.Path, err)
		}
	}
	return repo.PageHTML.UpdateProvider(version.ID, m.status.TargetProviderID)
}

// copyStorageObject 把对象复制到目标存储并校验大小；目标中已有同样大小的对象时跳过复制（对象按内容哈希命名）。
// contentType 为对象类型（可直连的存储由浏览器直接读取），为空时按扩展名推断
func copyStorageObject(ctx context.Context, source, target storageprovider.StorageProvider, objectPath, contentType string) (copied bool, size int64, err error) {
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
	if err := storageprovider.SaveWithContentType(ctx, target, objectPath, src, contentType); err != nil {
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
