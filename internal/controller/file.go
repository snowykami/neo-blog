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
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const (
	userMaxUploadSize = 10 << 20 // 普通用户单个文件上传上限
	maxCachedFileSize = 8 << 20  // 超过该大小的文件不进入内存缓存，直接流式输出
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
	// 只有管理员可以指定存储提供者，其他用户统一使用默认存储
	if !(req.ProviderID == 0 || ctxutils.IsAdmin(ctx)) {
		resps.Forbidden(c, resps.ErrForbidden)
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
	mimeType := f.getContentType(file.Filename)
	// 普通用户只能上传有限大小的图片（头像、评论配图等），编辑和管理员不受限
	if !(ctxutils.IsEditor(ctx) || ctxutils.IsAdmin(ctx)) {
		if !strings.HasPrefix(mimeType, "image/") || mimeType == "image/svg+xml" {
			resps.BadRequest(c, "unsupported_file_type")
			return
		}
		if file.Size > userMaxUploadSize {
			resps.BadRequest(c, "file_too_large")
			return
		}
	}
	// 初始化文件驱动
	provider, ok := storage.GetStorageProvider(req.ProviderID)
	if !ok {
		resps.InternalServerError(c, "没有可用的存储提供者")
		return
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
	// 保存文件：相同内容已存在时直接复用（哈希由服务端计算，不信任客户端传入）
	if _, err := provider.Stat(ctx, storagePath); err != nil {
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
		MimeType:   mimeType,
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

	// 响应类型只取上传时记录的类型，不受请求中的文件名影响，避免把上传内容当作 HTML 渲染
	contentType := fileModel.MimeType
	if contentType == "" {
		contentType = f.getContentType(fileModel.Name)
	}
	if fileName != "" {
		fileModel.Name = fileName // 使用请求中的文件名，避免浏览器下载时文件名为id
	}
	inline := isInlineContentType(contentType)
	if !inline {
		contentType = "application/octet-stream"
	}
	setHeaders := func(size int64, cacheStatus string) {
		c.Header("Content-Length", fmt.Sprintf("%d", size))
		c.Header("Content-Disposition", f.buildContentDisposition(fileModel.Name, inline))
		c.Header("Cache-Control", "public, max-age=3600")
		c.Header("ETag", fmt.Sprintf("\"%s\"", fileModel.Hash))
		c.Header("X-Cache-Status", cacheStatus)
		c.Header("X-Content-Type-Options", "nosniff")
		// 直接打开文件时禁止执行脚本（如 SVG 内嵌脚本）；PDF 预览在沙箱中无法加载，单独放行
		if contentType != "application/pdf" {
			c.Header("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox")
		}
	}

	// 尝试从缓存中获取文件内容
	fileCache := cache.GetFileCache()
	if cachedData, found := fileCache.Get(fileId); found {
		logrus.Debugf("文件从缓存中获取, fileId: %d", fileId)
		setHeaders(int64(len(cachedData)), "HIT")
		c.Data(200, contentType, cachedData)
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
	size := readableFile.Size()
	setHeaders(size, "MISS")

	// 大文件直接流式输出，不读入内存；流读取完毕后由框架关闭文件
	if size > maxCachedFileSize {
		c.SetContentType(contentType)
		c.SetBodyStream(readableFile, int(size))
		return
	}
	defer readableFile.Close() // 确保文件关闭，避免资源泄漏

	// 小文件读取到内存，用于缓存
	fileData, err := io.ReadAll(readableFile)
	if err != nil {
		resps.Error(c, errs.NewInternalServer("failed_to_read_file"))
		return
	}

	// 将文件内容放入缓存
	fileCache.Put(fileId, fileData)
	logrus.Debugf("文件已缓存, fileId: %d, size: %d bytes", fileId, len(fileData))

	// 返回文件内容
	c.Data(200, contentType, fileData)
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
	if svcerr := repo.File.DeleteByID(fileId); svcerr != nil {
		logrus.Error("删除文件记录失败: ", svcerr)
		resps.InternalServerError(c, "删除文件记录失败")
		return
	}
	if err := f.deleteObjectIfUnused(ctx, provider, &fileModel); err != nil {
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
		if err := f.deleteObjectIfUnused(ctx, provider, &fileModel); err != nil {
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

// deleteObjectIfUnused 相同内容的文件共用一个存储对象，没有其他文件记录引用时才删除对象
func (f *FileController) deleteObjectIfUnused(ctx context.Context, provider storageprovider.StorageProvider, fileModel *model.File) error {
	count, err := repo.File.CountFilesByHash(fileModel.Hash, fileModel.ProviderID)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return provider.Delete(ctx, filepath.Join(utils.FilePath(fileModel.Hash)))
}

// isInlineContentType 只有图片、音视频、PDF 和纯文本允许在浏览器内直接打开，其余一律作为附件下载
// SVG 虽然按图片内联展示，但响应带有 CSP sandbox，内嵌脚本不会执行
func isInlineContentType(contentType string) bool {
	for _, prefix := range []string{"image/", "video/", "audio/", "application/pdf", "text/plain"} {
		if strings.HasPrefix(contentType, prefix) {
			return true
		}
	}
	return false
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

func (f *FileController) buildContentDisposition(fileName string, inline bool) string {
	disposition := "attachment"
	if inline {
		disposition = "inline"
	}
	// 如果文件名只包含ASCII字符（排除引号和控制字符，避免响应头注入）
	if utf8.ValidString(fileName) && isASCII(fileName) && !strings.ContainsAny(fileName, "\"\\\r\n") {
		return fmt.Sprintf("%s; filename=\"%s\"", disposition, fileName)
	}

	// 如果包含非ASCII字符，使用RFC5987编码
	encodedName := url.PathEscape(fileName)
	return fmt.Sprintf("%s; filename*=UTF-8''%s", disposition, encodedName)
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}
