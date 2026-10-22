package service

import (
	"context"
	"slices"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
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
