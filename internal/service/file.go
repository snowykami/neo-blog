package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"slices"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
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
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
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

// SavedFile 保存结果；Direct 表示 URL 为存储直链（非后端代理）
type SavedFile struct {
	ID     uint
	Hash   string
	URL    string
	Direct bool
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
	dir, fileNameHash := utils.FilePath(hash)
	storagePath := filepath.Join(dir, fileNameHash)
	if _, err := provider.Stat(ctx, storagePath); err != nil {
		if _, err := in.Src.Seek(0, io.SeekStart); err != nil {
			logrus.Error("无法重置文件流位置: ", err)
			return nil, errs.New(http.StatusBadRequest, "failed_to_read_file", err)
		}
		if err := provider.Save(ctx, storagePath, in.Src); err != nil {
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
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	// 非后端代理的存储直接返回直链
	if !provider.IsProxy() {
		url, err := provider.GetURL(ctx, storagePath, 0)
		if err != nil {
			logrus.Error("获取文件访问URL失败: ", err)
		}
		return &SavedFile{ID: fileModel.ID, Hash: hash, URL: url, Direct: true}, nil
	}
	return &SavedFile{
		ID:   fileModel.ID,
		Hash: hash,
		URL:  fmt.Sprintf("%s%s%s/%d", tools.GetBaseUrl(), constant.ApiPrefix, constant.FileUriPrefix, fileModel.ID),
	}, nil
}
