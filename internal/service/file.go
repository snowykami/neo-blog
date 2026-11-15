package service

import (
	"cmp"
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const maxFileListSize = 100 // 单页最多返回的文件数

var fileTypeFilters = []string{"", constant.FileTypeImage, constant.FileTypeVideo, constant.FileTypeAudio, constant.FileTypeOther}

type FileService struct{}

func NewFileService() *FileService {
	return &FileService{}
}

// ListFiles 资产库列表：默认只列出当前用户自己的文件，只有管理员可以查看全部文件
func (f *FileService) ListFiles(ctx context.Context, req *dto.FileListReq) ([]model.File, int64, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, 0, errs.NewUnauthorized("login_required")
	}
	if !(req.Scope == "" || req.Scope == constant.FileScopeMine || req.Scope == constant.FileScopeAll) {
		return nil, 0, errs.NewBadRequest("invalid_scope")
	}
	if !slices.Contains(fileTypeFilters, req.Type) {
		return nil, 0, errs.NewBadRequest("invalid_file_type")
	}
	userID := currentUser.ID
	if req.Scope == constant.FileScopeAll {
		if !ctxutils.IsAdmin(ctx) {
			return nil, 0, errs.NewForbidden("permission_denied")
		}
		userID = 0
	}
	if req.Size == 0 || req.Size > maxFileListSize {
		req.Size = maxFileListSize
	}
	var keywords []string
	if req.Query != "" {
		keywords = strings.Split(req.Query, ",")
	}
	files, total, err := repo.File.ListFiles(userID, &req.PaginationParams, keywords, req.Type)
	if err != nil {
		logrus.Error("获取文件列表失败: ", err)
		return nil, 0, errs.Internal("failed_to_get_target", err)
	}
	return files, total, nil
}

// SaveFileInput 待保存的上传文件；权限、类型与大小由调用方校验
type SaveFileInput struct {
	Name       string
	Group      string
	ProviderID uint // 0 表示默认存储
	Size       int64
	MimeType   string
	Src        io.ReadSeeker
}

// SavedFile 保存结果；URL 为稳定链接（站内相对路径，换域名不失效）
type SavedFile struct {
	ID   uint
	Hash string
	URL  string
}

// LockFileBlob 对同一存储对象的引用计数与物理读写加跨实例锁，防止秒传复用与并发删除之间产生孤儿记录
func LockFileBlob(ctx context.Context, providerID uint, hash string) (func(), error) {
	return sharedstate.Lock(ctx, fmt.Sprintf("file_blob:%d:%s", providerID, hash), 2*time.Minute)
}

// SaveFile 按内容哈希保存文件并建立索引：相同内容已存在时直接复用（哈希由服务端计算，不信任客户端传入）
func (f *FileService) SaveFile(ctx context.Context, in *SaveFileInput) (*SavedFile, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	providerID := in.ProviderID
	if providerID == 0 {
		providerID = storage.GetDefaultStorageProviderID()
	}
	provider, ok := storage.GetStorageProvider(providerID)
	if !ok {
		return nil, errs.NewInternalServer("storage_provider_unavailable")
	}
	hash, err := utils.FileHashFromStream(in.Src)
	if err != nil {
		logrus.Error("计算文件哈希失败: ", err)
		return nil, errs.New(http.StatusBadRequest, "failed_to_read_file", err)
	}
	unlock, err := LockFileBlob(ctx, providerID, hash)
	if err != nil {
		return nil, errs.Internal("failed_to_save_file", err)
	}
	defer unlock()

	dir, fileNameHash := utils.FilePath(hash)
	storagePath := path.Join(dir, fileNameHash)
	if _, err := provider.Stat(ctx, storagePath); err != nil {
		if _, err := in.Src.Seek(0, io.SeekStart); err != nil {
			logrus.Error("无法重置文件流位置: ", err)
			return nil, errs.New(http.StatusBadRequest, "failed_to_read_file", err)
		}
		// 可直连的存储由浏览器直接读取对象，类型随对象保存（与经后端返回时的类型一致，附件按二进制）
		if err := storageprovider.SaveWithContentType(ctx, provider, storagePath, in.Src, utils.ServedContentType(in.MimeType)); err != nil {
			logrus.Error("保存文件失败: ", err)
			return nil, errs.New(http.StatusInternalServerError, "failed_to_save_file", err)
		}
	}
	fileModel := &model.File{
		Hash:       hash,
		UserID:     currentUser.ID,
		Group:      in.Group,
		Name:       in.Name,
		ProviderID: providerID,
		Size:       in.Size,
		MimeType:   in.MimeType,
	}
	if err := repo.File.Create(fileModel); err != nil {
		logrus.Error("数据库索引建立失败: ", err)
		return nil, errs.Internal("failed_to_create_target", err)
	}
	// 始终返回稳定链接（相对路径）：内容中只保存稳定链接，文件换存储、存储改地址或站点换域名时都无需改动内容；
	// 可直连的存储在接口返回时再改写为直链
	return &SavedFile{ID: fileModel.ID, Hash: hash, URL: FileLink(fileModel.ID)}, nil
}

// GetFileCached 按文件 ID 读取带缓存的文件元数据
func (f *FileService) GetFileCached(fileID uint) (model.File, *errs.ServiceError) {
	return repo.File.GetByIDCached(fileID)
}

// DeleteFile 删除单个文件记录并在无其他引用时回收底层物理存储对象
func (f *FileService) DeleteFile(ctx context.Context, fileID uint) *errs.ServiceError {
	fileModel, err := repo.File.GetByID(fileID)
	if err != nil {
		return errs.FromDB(err, "file", "failed_to_get_target")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, fileModel.UserID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	provider, ok := storage.GetStorageProvider(fileModel.ProviderID)
	if !ok {
		return errs.NewBadRequest("storage_provider_not_found")
	}
	if err := f.deleteFileRecordAndBlob(ctx, provider, &fileModel); err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("file")
	}
	cache.EvictFile(fileID)
	logrus.Debugf("文件已从缓存中删除, fileId: %d", fileID)
	return nil
}

// BatchDeleteFiles 批量校验权限并删除文件记录及无引用物理存储对象
func (f *FileService) BatchDeleteFiles(ctx context.Context, ids []uint) *errs.ServiceError {
	uniqueIDs := make([]uint, 0, len(ids))
	seenID := make(map[uint]struct{}, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, exists := seenID[id]; exists {
			continue
		}
		seenID[id] = struct{}{}
		uniqueIDs = append(uniqueIDs, id)
	}
	if len(uniqueIDs) == 0 {
		return nil
	}

	files, err := repo.File.ListByIDs(uniqueIDs)
	if err != nil {
		return errs.Internal("failed_to_get_target", err).WithResource("file")
	}
	if len(files) == 0 {
		return nil
	}

	providers := make(map[uint]storageprovider.StorageProvider)
	type blobKey struct {
		providerID uint
		hash       string
	}
	blobSeen := make(map[blobKey]struct{})
	blobs := make([]blobKey, 0, len(files))

	// 先一次性校验整批文件权限与存储提供者，避免删到一半报错
	for i := range files {
		if !(ctxutils.IsOwnerOfTarget(ctx, files[i].UserID) || ctxutils.IsAdmin(ctx)) {
			return errs.NewForbidden("permission_denied")
		}
		pid := files[i].ProviderID
		if _, ok := providers[pid]; !ok {
			provider, exists := storage.GetStorageProvider(pid)
			if !exists {
				return errs.NewBadRequest("storage_provider_not_found")
			}
			providers[pid] = provider
		}
		if files[i].Hash != "" {
			k := blobKey{providerID: pid, hash: files[i].Hash}
			if _, ok := blobSeen[k]; !ok {
				blobSeen[k] = struct{}{}
				blobs = append(blobs, k)
			}
		}
	}

	// 按固定顺序加对象锁，防止并发 BatchDeleteFiles 互锁以及与 SaveFile 秒传复用竞争
	slices.SortFunc(blobs, func(a, b blobKey) int {
		if c := cmp.Compare(a.providerID, b.providerID); c != 0 {
			return c
		}
		return cmp.Compare(a.hash, b.hash)
	})
	lockedBlobs := make(map[blobKey]struct{}, len(blobs))
	for _, k := range blobs {
		unlock, lockErr := LockFileBlob(ctx, k.providerID, k.hash)
		if lockErr != nil {
			logrus.Error("获取文件对象锁失败，跳过: ", lockErr)
			continue
		}
		defer unlock()
		lockedBlobs[k] = struct{}{}
	}

	deleteIDs := make([]uint, 0, len(files))
	hashesByProvider := make(map[uint][]string)
	providerHashSeen := make(map[blobKey]struct{})
	for i := range files {
		if files[i].Hash != "" {
			k := blobKey{providerID: files[i].ProviderID, hash: files[i].Hash}
			if _, ok := lockedBlobs[k]; !ok {
				continue
			}
			if _, seen := providerHashSeen[k]; !seen {
				providerHashSeen[k] = struct{}{}
				hashesByProvider[files[i].ProviderID] = append(hashesByProvider[files[i].ProviderID], files[i].Hash)
			}
		}
		deleteIDs = append(deleteIDs, files[i].ID)
	}
	if len(deleteIDs) == 0 {
		return nil
	}

	if err := repo.File.DeleteByIDs(deleteIDs); err != nil {
		logrus.Error("批量删除文件记录失败: ", err)
		return errs.Internal("failed_to_delete_target", err).WithResource("file")
	}
	for _, id := range deleteIDs {
		cache.EvictFile(id)
		logrus.Debugf("文件已从缓存中删除, fileId: %d", id)
	}

	for pid, hashes := range hashesByProvider {
		remaining, countErr := repo.File.CountFilesByHashes(pid, hashes)
		if countErr != nil {
			logrus.Error("统计剩余文件引用失败: ", countErr)
			continue
		}
		provider := providers[pid]
		for _, hash := range hashes {
			if remaining[hash] > 0 {
				continue
			}
			if delErr := provider.Delete(ctx, filepath.Join(utils.FilePath(hash))); delErr != nil {
				logrus.Error("删除物理存储对象失败: ", delErr)
			}
		}
	}
	return nil
}

// deleteFileRecordAndBlob 在对象锁保护下删除文件记录并在无其他引用时回收底层存储对象
func (f *FileService) deleteFileRecordAndBlob(ctx context.Context, provider storageprovider.StorageProvider, fileModel *model.File) error {
	unlock, err := LockFileBlob(ctx, fileModel.ProviderID, fileModel.Hash)
	if err != nil {
		return err
	}
	defer unlock()
	if err := repo.File.DeleteByID(fileModel.ID); err != nil {
		return err
	}
	count, err := repo.File.CountFilesByHash(fileModel.Hash, fileModel.ProviderID)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return provider.Delete(ctx, filepath.Join(utils.FilePath(fileModel.Hash)))
}
