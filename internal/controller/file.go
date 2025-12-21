package v1

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/tasks"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

type FileController struct{}

func NewFileController() *FileController {
	return &FileController{}
}

func (f *FileController) UploadFileStream(ctx context.Context, c *app.RequestContext) {
	// 获取文件信息
	req := &dto.FileUploadReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if req.ProviderID == 0 {
		req.ProviderID = storage.GetDefaultStorageProviderID()
	}
	file, err := c.FormFile("file")
	if err != nil {
		logrus.Error("无法读取文件: ", err)
		resps.BadRequest(c, err.Error())
		return
	}
	// 初始化文件驱动
	provider, ok := storage.GetStorageProvider(req.ProviderID)
	if !ok {
		resps.InternalServerError(c, "没有可用的存储提供者")
		return
	}

	// 校验文件哈希
	if hashForm := string(c.FormValue("hash")); hashForm != "" {
		dir, fileName := utils.FilePath(hashForm)
		storagePath := filepath.Join(dir, fileName)
		if _, err := provider.Stat(ctx, storagePath); err == nil {
			resps.Ok(c, "文件已存在", map[string]any{"hash": hashForm})
			return
		}
	}

	// 打开文件
	src, err := file.Open()
	if err != nil {
		logrus.Error("无法打开文件: ", err)
		resps.BadRequest(c, err.Error())
		return
	}
	defer src.Close()

	// 计算文件哈希值
	hash, err := utils.FileHashFromStream(src)
	if err != nil {
		logrus.Error("计算文件哈希失败: ", err)
		resps.BadRequest(c, err.Error())
		return
	}

	// 根据哈希值生成存储路径
	dir, fileNameHash := utils.FilePath(hash)
	storagePath := filepath.Join(dir, fileNameHash)
	// 保存文件
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		logrus.Error("无法重置文件流位置: ", err)
		resps.BadRequest(c, err.Error())
		return
	}
	if err := provider.Save(ctx, storagePath, src); err != nil {
		logrus.Error("保存文件失败: ", err)
		resps.InternalServerError(c, err.Error())
		return
	}
	// 数据库索引建立
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		resps.InternalServerError(c, "获取当前用户失败")
		return
	}
	fileModel := &model.File{
		Hash:       hash,
		UserID:     currentUser.ID,
		Group:      req.Group,
		Name:       req.Name,
		ProviderID: req.ProviderID,
		Size:       file.Size,
		MimeType:   f.getContentType(file.Filename),
	}

	if err := repo.File.Create(fileModel); err != nil {
		logrus.Error("数据库索引建立失败: ", err)
		resps.InternalServerError(c, "数据库索引建立失败")
		return
	}

	// 非后端代理请求，直接返回文件URL
	if !provider.IsProxy() {
		url, err := provider.GetURL(ctx, storagePath, 0)
		if err != nil {
			logrus.Error("获取文件访问URL失败: ", err)
		}
		resps.Ok(c, "文件上传成功(直链)", map[string]any{
			"hash": hash,
			"id":   fileModel.ID,
			"url":  url,
		})
		return
	}

	resps.Ok(c, "文件上传成功", map[string]any{
		"hash": hash,
		"id":   fileModel.ID,
		"url":  fmt.Sprintf("%s%s%s/%d", tools.GetBaseUrl(), constant.ApiPrefix, constant.FileUriPrefix, fileModel.ID),
	})
}

func (f *FileController) GetFile(ctx context.Context, c *app.RequestContext) {
	fileId := ctxutils.GetIDParam(c).Uint
	fileName := c.Param("filename") // 此处的filename是请求时传入的文件名，可以整治浏览器直接访问时响应id作为文件名的情况
	fileModel, svcerr := repo.File.GetByID(fileId)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}

	if fileName != "" {
		fileModel.Name = fileName // 使用请求中的文件名，避免浏览器下载时文件名为id
	}

	// 尝试从缓存中获取文件内容
	fileCache := cache.GetFileCache()
	if cachedData, found := fileCache.Get(fileId); found {
		logrus.Debugf("文件从缓存中获取, fileId: %d", fileId)
		// 设置响应头
		c.Header("Content-Type", f.getContentType(fileModel.Name))
		c.Header("Content-Length", fmt.Sprintf("%d", len(cachedData)))
		c.Header("Content-Disposition", f.buildContentDisposition(fileModel.Name))
		c.Header("Accept-Ranges", "bytes")
		c.Header("Cache-Control", "public, max-age=3600")
		c.Header("ETag", fmt.Sprintf("\"%s\"", fileModel.Hash))
		c.Header("X-Cache-Status", "HIT")

		// 直接返回缓存的字节数据
		c.Data(200, f.getContentType(fileModel.Name), cachedData)
		return
	}

	provider, ok := storage.GetStorageProvider(fileModel.ProviderID)
	if !ok {
		resps.Error(c, errs.NewBadRequest("storage_provider_not_found"))
		return
	}

	filePath := filepath.Join(utils.FilePath(fileModel.Hash))
	readableFile, err := provider.Open(ctx, filePath)
	if err != nil {
		resps.Error(c, errs.NewInternalServer("failed_to_open_file"))
		return
	}

	// 设置响应头
	c.Header("Content-Type", f.getContentType(fileModel.Name))
	c.Header("Content-Length", fmt.Sprintf("%d", readableFile.Size()))
	c.Header("Content-Disposition", f.buildContentDisposition(fileModel.Name))
	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "public, max-age=3600")
	c.Header("ETag", fmt.Sprintf("\"%s\"", fileModel.Hash))
	c.Header("X-Cache-Status", "MISS")

	// 读取文件内容到内存，用于缓存
	fileData, err := io.ReadAll(readableFile)
	readableFile.Close()
	if err != nil {
		resps.Error(c, errs.NewInternalServer("failed_to_read_file"))
		return
	}

	// 将文件内容放入缓存
	fileCache.Put(fileId, fileData)
	logrus.Debugf("文件已缓存, fileId: %d, size: %d bytes", fileId, len(fileData))

	// 返回文件内容
	c.Data(200, f.getContentType(fileModel.Name), fileData)
}

func (f *FileController) ListFiles(ctx context.Context, c *app.RequestContext) {
	// 列出用户自己的文件
	var paginationParams dto.PaginationParams
	if err := c.BindAndValidate(&paginationParams); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}

	queryStr := []string{}
	query := c.Query("query")
	if query != "" {
		queryStr = strings.Split(query, ",")
	}
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		resps.InternalServerError(c, "获取当前用户失败")
		return
	}
	files, total, err := repo.File.ListFiles(currentUser.ID, &paginationParams, queryStr)
	if err != nil {
		logrus.Error("获取文件列表失败: ", err)
		resps.InternalServerError(c, "获取文件列表失败")
		return
	}
	resps.Ok(c, "获取文件列表成功", map[string]any{
		"files": func() []map[string]any {
			dtos := make([]map[string]any, 0, len(files))
			for _, file := range files {
				dtos = append(dtos, file.ToDto())
			}
			return dtos
		}(),
		"total": total,
	})
}

func (f *FileController) DeleteFile(ctx context.Context, c *app.RequestContext) {
	fileId := ctxutils.GetIDParam(c).Uint
	fileModel, err := repo.File.GetByID(fileId)
	if err != nil {
		logrus.Error("获取文件信息失败: ", err)
		resps.InternalServerError(c, "获取文件信息失败")
		return
	}
	// 只有文件所有者或管理员可以删除文件
	if !(ctxutils.IsOwnerOfTarget(ctx, fileModel.UserID) || ctxutils.IsAdmin(ctx)) {
		resps.Forbidden(c, "没有权限删除该文件")
		return
	}
	provider, ok := storage.GetStorageProvider(fileModel.ProviderID)
	if !ok {
		resps.BadRequest(c, "文件存储提供者不存在")
		return
	}
	if svcerr := repo.File.DeleteByID(fileId); err != nil {
		logrus.Error("删除文件记录失败: ", svcerr)
		resps.InternalServerError(c, "删除文件记录失败")
		return
	}
	filePath := filepath.Join(utils.FilePath(fileModel.Hash))
	if err := provider.Delete(ctx, filePath); err != nil {
		logrus.Error("删除文件失败: ", err)
		resps.InternalServerError(c, "删除文件失败")
		return
	}
	// 从缓存中删除文件
	cache.GetFileCache().Remove(fileId)
	logrus.Debugf("文件已从缓存中删除, fileId: %d", fileId)
	
	resps.Ok(c, "文件删除成功", nil)
}

func (f *FileController) CreateStorageProvider(ctx context.Context, c *app.RequestContext) {
	var req model.StorageProviderModelAndDto
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if req.Type == "" || req.Name == "" {
		resps.BadRequest(c, "存储提供者名称和类型不能为空")
		return
	}
	svcerr := repo.File.CreateStorageProvider(&req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if err := tasks.ReloadStorageProviders(); err != nil {
		logrus.Error("重载存储提供者失败: ", err)
		resps.InternalServerError(c, "重载存储提供者失败")
		return
	}
	resps.Ok(c, "存储提供者创建成功", req)
}

func (f *FileController) UpdateStorageProvider(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	var req model.StorageProviderModelAndDto
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if req.Type == "" || req.Name == "" {
		resps.BadRequest(c, "存储提供者名称和类型不能为空")
		return
	}

	if svcerr := repo.File.UpdateStorageProvider(id, &req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}

	if err := tasks.ReloadStorageProviders(); err != nil {
		logrus.Error("重载存储提供者失败: ", err)
		resps.InternalServerError(c, "重载存储提供者失败")
		return
	}
	resps.Ok(c, "存储提供者更新成功", req)
}

func (f *FileController) DeleteStorageProvider(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	// 先检查是否有文件在使用该存储提供者
	count, err := repo.File.CountFilesByProviderID(id)
	if err != nil {
		logrus.Error("检查存储提供者使用情况失败: ", err)
		resps.InternalServerError(c, "检查存储提供者使用情况失败")
		return
	}
	if count > 0 {
		resps.BadRequest(c, "无法删除存储提供者，有文件正在使用该提供者")
		return
	}

	if svcerr := repo.File.DeleteStorageProvider(id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}

	if err := tasks.ReloadStorageProviders(); err != nil {
		logrus.Error("重载存储提供者失败: ", err)
		resps.InternalServerError(c, "重载存储提供者失败")
		return
	}
	resps.Ok(c, "存储提供者删除成功", nil)
}

func (f *FileController) BatchDeleteFiles(ctx context.Context, c *app.RequestContext) {
	ids := c.Query("ids")
	if ids == "" {
		resps.BadRequest(c, "missing_request_parameters")
		return
	}
	idStrs := strings.Split(ids, ",")
	idUints := make([]uint, 0, len(idStrs))
	for _, idStr := range idStrs {
		id, err := strconv.ParseUint(idStr, 10, 64)
		if err != nil {
			resps.BadRequest(c, "参数ids格式不正确")
			return
		}
		idUints = append(idUints, uint(id))
	}

	// 权限判断
	for _, id := range idUints {
		fileModel, err := repo.File.GetByID(id)
		if err != nil {
			logrus.Error("获取文件信息失败，跳过: ", err)
			continue
		}
		if !(ctxutils.IsOwnerOfTarget(ctx, fileModel.UserID) || ctxutils.IsAdmin(ctx)) {
			resps.Forbidden(c, fmt.Sprintf("没有权限删除文件ID为%d的文件", id))
			return
		}
	}

	// 批量删除文件记录和存储中的文件
	for _, id := range idUints {
		// 删除数据库记录
		fileModel, err := repo.File.GetByID(id)
		if err != nil {
			logrus.Error("获取文件信息失败: ", err)
			continue
		}
		if err := repo.File.DeleteByID(id); err != nil {
			logrus.Error("删除文件记录失败: ", err)
			continue
		}
		// 删除实体文件
		provider, ok := storage.GetStorageProvider(fileModel.ProviderID)
		if !ok {
			resps.BadRequest(c, "文件存储提供者不存在")
			return
		}
		filePath := filepath.Join(utils.FilePath(fileModel.Hash))
		if err := provider.Delete(ctx, filePath); err != nil {
			logrus.Error("删除文件失败: ", err)
			continue
		}
		// 从缓存中删除文件
		cache.GetFileCache().Remove(id)
		logrus.Debugf("文件已从缓存中删除, fileId: %d", id)
	}

	resps.Ok(c, "文件批量删除成功", nil)
}

func (f *FileController) ListStorageProviders(ctx context.Context, c *app.RequestContext) {
	providers, err := repo.File.ListStorageProviders()
	if err != nil {
		resps.Error(c, errs.NewInternalServer("failed_to_get_target"))
		return
	}
	resps.Ok(c, "存储提供者列表", map[string]any{"providers": providers})
}

func (f *FileController) getContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	contentTypes := map[string]string{
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".png":  "image/png",
		".gif":  "image/gif",
		".webp": "image/webp",
		".svg":  "image/svg+xml",
		".mp4":  "video/mp4",
		".webm": "video/webm",
		".avi":  "video/x-msvideo",
		".mov":  "video/quicktime",
		".mp3":  "audio/mpeg",
		".wav":  "audio/wav",
		".flac": "audio/flac",
		".pdf":  "application/pdf",
		".txt":  "text/plain; charset=utf-8",
		".html": "text/html; charset=utf-8",
		".css":  "text/css; charset=utf-8",
		".js":   "application/javascript; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".xml":  "application/xml; charset=utf-8",
		".zip":  "application/zip",
		".rar":  "application/x-rar-compressed",
		".7z":   "application/x-7z-compressed",
	}

	if contentType, exists := contentTypes[ext]; exists {
		return contentType
	}
	return "application/octet-stream"
}

func (f *FileController) buildContentDisposition(fileName string) string {
	// 如果文件名只包含ASCII字符
	if utf8.ValidString(fileName) && isASCII(fileName) {
		return fmt.Sprintf("inline; filename=\"%s\"", fileName)
	}

	// 如果包含非ASCII字符，使用RFC5987编码
	encodedName := url.QueryEscape(fileName)
	return fmt.Sprintf("inline; filename*=UTF-8''%s", encodedName)
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}
