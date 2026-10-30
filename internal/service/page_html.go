package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
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
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 版本标识：32 位小写字母与数字（约 165 bit），访问路径凭它找到版本，不可猜测
const (
	pageHTMLKeyLength  = 32
	pageHTMLKeyCharset = "abcdefghijklmnopqrstuvwxyz0123456789"
	pageHTMLStorageDir = "page-html"
)

// PageHTMLService HTML 页面：管理员上传静态 HTML 包，解压到存储后经后端代理、在沙箱中访问
//
// 访问控制：沙箱 iframe 为不透明源，加载子资源时不会携带站点的 Cookie，无法按登录态鉴权，
// 因此访问路径中带有随机的版本标识（能力地址）：公开页面的标识随页面详情公开，
// 私密页面与未生效版本的标识只返回给管理员
type PageHTMLService struct{}

func NewPageHTMLService() *PageHTMLService {
	return &PageHTMLService{}
}

// PageHTMLUploadInput 上传的静态文件包；Src 需支持随机读取（zip 的目录位于文件末尾）
type PageHTMLUploadInput struct {
	PageID   uint
	FileName string
	Size     int64
	Src      io.ReaderAt
	Entry    string // 可选：指定入口文件
}

// Upload 校验并解压上传的文件包，创建新版本并设为页面当前生效的版本，超出保留数量的旧版本随之清理
func (s *PageHTMLService) Upload(ctx context.Context, in *PageHTMLUploadInput) (*dto.PageHTMLVersionDto, *errs.ServiceError) {
	page, svcerr := s.getPage(ctx, in.PageID)
	if svcerr != nil {
		return nil, svcerr
	}
	if model.NormalizePageKind(page.Kind) != model.PageKindHTML {
		return nil, errs.NewBadRequest("page_not_html")
	}
	bundle, bundleErr := parseHTMLBundle(in.FileName, in.Src, in.Size, pageHTMLLimitsFromEnv())
	if bundleErr != nil {
		return nil, errs.New(http.StatusBadRequest, bundleErr.Code, bundleErr)
	}
	entry := bundle.Entry
	if in.Entry != "" {
		if !isPageHTMLDocument(in.Entry) || !bundleHasFile(bundle.Files, in.Entry) {
			return nil, errs.NewBadRequest("invalid_page_html_entry")
		}
		entry = in.Entry
	}
	providerID := storage.GetDefaultStorageProviderID()
	provider, ok := storage.GetStorageProvider(providerID)
	if !ok {
		return nil, errs.NewInternalServer("storage_provider_unavailable")
	}
	maxVersion, err := repo.PageHTML.MaxVersion(page.ID)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}

	key := utils.Strings.GenerateRandomStringWithCharset(pageHTMLKeyLength, pageHTMLKeyCharset)
	manifest := make(model.PageHTMLFiles, 0, len(bundle.Files))
	written := make([]string, 0, len(bundle.Files))
	var totalSize int64
	for _, f := range bundle.Files {
		storagePath := pageHTMLStoragePath(page.ID, key, f.Path)
		written = append(written, storagePath) // 写入失败时可能残留不完整的文件，一并清理
		if svcerr := saveBundleFile(ctx, provider, storagePath, f); svcerr != nil {
			deleteStoredFiles(ctx, provider, written)
			return nil, svcerr
		}
		manifest = append(manifest, model.PageHTMLFile{Path: f.Path, Size: f.Size})
		totalSize += f.Size
	}

	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	version := &model.PageHTMLVersion{
		PageID:     page.ID,
		UserID:     currentUserID,
		Version:    maxVersion + 1,
		Key:        key,
		ProviderID: providerID,
		Entry:      entry,
		SourceName: utils.Truncate(path.Base(in.FileName), 200),
		TotalSize:  totalSize,
		Files:      manifest,
	}
	if err := repo.PageHTML.Create(version); err != nil {
		deleteStoredFiles(ctx, provider, written)
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	if err := repo.Page.SetHTMLVersion(page.ID, version.ID); err != nil {
		return nil, errs.NewInternalServer("failed_to_update_target")
	}
	page.HTMLVersionID = version.ID
	s.pruneVersions(ctx, page)
	return toPageHTMLVersionDto(version, true), nil
}

// ListVersions 页面的全部版本，新版本在前
func (s *PageHTMLService) ListVersions(ctx context.Context, pageID uint) ([]*dto.PageHTMLVersionDto, *errs.ServiceError) {
	page, svcerr := s.getPage(ctx, pageID)
	if svcerr != nil {
		return nil, svcerr
	}
	versions, err := repo.PageHTML.ListByPage(page.ID)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := make([]*dto.PageHTMLVersionDto, 0, len(versions))
	for i := range versions {
		result = append(result, toPageHTMLVersionDto(&versions[i], versions[i].ID == page.HTMLVersionID))
	}
	return result, nil
}

// UpdateVersion 修改版本的入口文件，或切换为页面当前生效的版本（用于回退到旧版本）
func (s *PageHTMLService) UpdateVersion(ctx context.Context, req *dto.UpdatePageHTMLVersionReq) (*dto.PageHTMLVersionDto, *errs.ServiceError) {
	page, svcerr := s.getPage(ctx, req.PageID)
	if svcerr != nil {
		return nil, svcerr
	}
	version, err := repo.PageHTML.GetByID(req.VersionID)
	if err != nil || version.PageID != page.ID {
		return nil, errs.NewNotFound("target_not_found")
	}
	if req.Entry != nil {
		entry := *req.Entry
		if _, ok := version.HasFile(entry); !(ok && isPageHTMLDocument(entry)) {
			return nil, errs.NewBadRequest("invalid_page_html_entry")
		}
		if err := repo.PageHTML.UpdateEntry(version.ID, entry); err != nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
		version.Entry = entry
	}
	if req.Active != nil && *req.Active {
		if err := repo.Page.SetHTMLVersion(page.ID, version.ID); err != nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
		page.HTMLVersionID = version.ID
	}
	return toPageHTMLVersionDto(version, version.ID == page.HTMLVersionID), nil
}

// DeleteAllForPage 删除页面的全部版本与存储中的文件，页面删除时调用
func (s *PageHTMLService) DeleteAllForPage(ctx context.Context, pageID uint) error {
	versions, err := repo.PageHTML.ListByPage(pageID)
	if err != nil {
		return err
	}
	for i := range versions {
		deletePageHTMLVersion(ctx, &versions[i])
	}
	return nil
}

// BundleForPage HTML 页面当前生效版本的访问信息，不是 HTML 页面或尚未上传时返回 nil
func (s *PageHTMLService) BundleForPage(page *model.Page) *dto.PageHTMLBundleDto {
	if model.NormalizePageKind(page.Kind) != model.PageKindHTML || page.HTMLVersionID == 0 {
		return nil
	}
	version, err := repo.PageHTML.GetByID(page.HTMLVersionID)
	if err != nil {
		logrus.Warnf("get html version %d of page %d failed: %v", page.HTMLVersionID, page.ID, err)
		return nil
	}
	return &dto.PageHTMLBundleDto{
		Version:         version.Version,
		Entry:           version.Entry,
		URL:             pageHTMLEntryURL(version),
		AllowSameOrigin: PageHTMLOrigin() != "",
	}
}

// PageHTMLServeFile 待输出的静态文件，调用方负责关闭 File
type PageHTMLServeFile struct {
	File        storageprovider.ReadableFile
	ContentType string
}

// OpenFile 按访问路径打开版本内的文件：只允许访问文件清单内的路径，目录路径指向其下的 index.html
func (s *PageHTMLService) OpenFile(ctx context.Context, pageID uint, key, filePath string) (*PageHTMLServeFile, *errs.ServiceError) {
	if !isPageHTMLKey(key) {
		return nil, errs.NewNotFound("target_not_found")
	}
	version, err := repo.PageHTML.GetByKey(key)
	if err != nil || version.PageID != pageID {
		return nil, errs.NewNotFound("target_not_found")
	}
	// 页面删除后立即停止访问，即使清理存储失败
	if _, err := repo.Page.GetPageMeta(pageID); err != nil {
		return nil, errs.NewNotFound("target_not_found")
	}
	filePath = strings.TrimPrefix(filePath, "/")
	if filePath == "" || strings.HasSuffix(filePath, "/") {
		filePath += "index.html"
	}
	if _, ok := version.HasFile(filePath); !ok {
		return nil, errs.NewNotFound("target_not_found")
	}
	provider, ok := storage.GetStorageProvider(version.ProviderID)
	if !ok {
		return nil, errs.NewInternalServer("storage_provider_unavailable")
	}
	file, err := provider.Open(ctx, pageHTMLStoragePath(pageID, key, filePath))
	if err != nil {
		logrus.Errorf("open html file %s of page %d failed: %v", filePath, pageID, err)
		return nil, errs.NewInternalServer("failed_to_open_file")
	}
	return &PageHTMLServeFile{File: file, ContentType: PageHTMLContentType(filePath)}, nil
}

// PageHTMLOrigin 托管 HTML 页面的独立源（scheme://host[:port]），未配置或配置无效时为空字符串
// 与站点同一主机名（不论端口，Cookie 不按端口隔离）的配置视为无效：否则 allow-same-origin 会让上传的脚本拿到站点的 Cookie
func PageHTMLOrigin() string {
	raw := strings.TrimSpace(utils.Env.Get(constant.EnvKeyPageHTMLOrigin, ""))
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || !(u.Scheme == "http" || u.Scheme == "https") || u.Host == "" || u.User != nil ||
		!(u.Path == "" || u.Path == "/") || u.RawQuery != "" {
		logrus.Warnf("ignore invalid %s: %q", constant.EnvKeyPageHTMLOrigin, raw)
		return ""
	}
	if base, err := url.Parse(tools.GetBaseUrl()); err == nil && strings.EqualFold(base.Hostname(), u.Hostname()) {
		logrus.Warnf("ignore %s: it must not share the host with the site (%s)", constant.EnvKeyPageHTMLOrigin, base.Host)
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// IsPageHTMLOriginRequest 请求是否经由独立源访问：Host 必须是独立源的主机，且 X-Forwarded-Host（若有）也都必须是它。
// Next.js 的 rewrites 等反向代理会把 Host 改写为后端地址、把原始主机放进 X-Forwarded-Host；
// 若独立源恰好配置成前端转发的同一个后端地址，只看 Host 会让站点源上的请求也放开 allow-same-origin。
// X-Forwarded-Host 只用来收紧、不会放宽，浏览器也无法为页面导航设置这两个头
func IsPageHTMLOriginRequest(host, forwardedHost string) bool {
	origin := PageHTMLOrigin()
	if origin == "" || host == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || !strings.EqualFold(u.Host, host) {
		return false
	}
	if forwardedHost == "" {
		return true
	}
	for _, h := range strings.Split(forwardedHost, ",") {
		if !strings.EqualFold(strings.TrimSpace(h), u.Host) {
			return false
		}
	}
	return true
}

func (s *PageHTMLService) getPage(ctx context.Context, pageID uint) (*model.Page, *errs.ServiceError) {
	// HTML 页面可运行任意脚本，上传与版本管理只开放给管理员
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	page, err := repo.Page.GetPageByID(pageID)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found")
	}
	return page, nil
}

// pruneVersions 只保留最近的若干个版本，当前生效的版本始终保留
func (s *PageHTMLService) pruneVersions(ctx context.Context, page *model.Page) {
	versions, err := repo.PageHTML.ListByPage(page.ID)
	if err != nil {
		logrus.Warnf("list html versions of page %d failed: %v", page.ID, err)
		return
	}
	for i := range versions {
		if i < constant.PageHTMLKeepVersions || versions[i].ID == page.HTMLVersionID {
			continue
		}
		deletePageHTMLVersion(ctx, &versions[i])
	}
}

// deletePageHTMLVersion 删除版本记录与存储中的文件；存储删除失败只记录日志，记录删除后文件不再能被访问
func deletePageHTMLVersion(ctx context.Context, version *model.PageHTMLVersion) {
	if provider, ok := storage.GetStorageProvider(version.ProviderID); ok {
		paths := make([]string, 0, len(version.Files))
		for _, f := range version.Files {
			paths = append(paths, pageHTMLStoragePath(version.PageID, version.Key, f.Path))
		}
		deleteStoredFiles(ctx, provider, paths)
	} else {
		logrus.Warnf("storage provider %d of html version %d not found, files are left in storage", version.ProviderID, version.ID)
	}
	if err := repo.PageHTML.DeleteByID(version.ID); err != nil {
		logrus.Warnf("delete html version %d failed: %v", version.ID, err)
	}
}

func deleteStoredFiles(ctx context.Context, provider storageprovider.StorageProvider, paths []string) {
	for _, p := range paths {
		if err := provider.Delete(ctx, p); err != nil {
			logrus.Debugf("delete html file %s failed: %v", p, err)
		}
	}
}

// saveBundleFile 写入一个文件；读取包内数据失败（zip 损坏、大小与声明不符）视为上传内容有误，其余为存储错误
func saveBundleFile(ctx context.Context, provider storageprovider.StorageProvider, storagePath string, f bundleFile) *errs.ServiceError {
	rc, err := f.open()
	if err != nil {
		return errs.New(http.StatusBadRequest, "page_html_invalid_zip", &PageHTMLBundleError{Code: "page_html_invalid_zip", Path: f.Path})
	}
	defer rc.Close()
	reader := &readErrRecorder{r: rc}
	if err := provider.Save(ctx, storagePath, reader); err != nil {
		if reader.err != nil {
			return errs.New(http.StatusBadRequest, "page_html_invalid_zip", &PageHTMLBundleError{Code: "page_html_invalid_zip", Path: f.Path})
		}
		logrus.Errorf("save html file %s failed: %v", storagePath, err)
		return errs.New(http.StatusInternalServerError, "failed_to_save_file", err)
	}
	return nil
}

// readErrRecorder 记录读取过程中的错误，用于区分是上传内容损坏还是存储写入失败
type readErrRecorder struct {
	r   io.Reader
	err error
}

func (r *readErrRecorder) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	if err != nil && err != io.EOF {
		r.err = err
	}
	return n, err
}

func bundleHasFile(files []bundleFile, filePath string) bool {
	for _, f := range files {
		if f.Path == filePath {
			return true
		}
	}
	return false
}

func isPageHTMLKey(key string) bool {
	if len(key) != pageHTMLKeyLength {
		return false
	}
	for _, r := range key {
		if !strings.ContainsRune(pageHTMLKeyCharset, r) {
			return false
		}
	}
	return true
}

func pageHTMLStoragePath(pageID uint, key, filePath string) string {
	return path.Join(pageHTMLStorageDir, strconv.FormatUint(uint64(pageID), 10), key, filePath)
}

// pageHTMLEntryURL 入口文件的访问地址：配置了独立源时为该源下的绝对地址，否则为站内相对路径（经前端转发到后端）
func pageHTMLEntryURL(version *model.PageHTMLVersion) string {
	segments := strings.Split(version.Entry, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	return fmt.Sprintf("%s%s%s/%d/%s/%s", PageHTMLOrigin(), constant.ApiPrefix, constant.PageHTMLUriPrefix,
		version.PageID, version.Key, strings.Join(segments, "/"))
}

func toPageHTMLVersionDto(version *model.PageHTMLVersion, active bool) *dto.PageHTMLVersionDto {
	files := make([]dto.PageHTMLFileDto, 0, len(version.Files))
	for _, f := range version.Files {
		files = append(files, dto.PageHTMLFileDto{Path: f.Path, Size: f.Size, MimeType: PageHTMLContentType(f.Path)})
	}
	return &dto.PageHTMLVersionDto{
		ID:              version.ID,
		Version:         version.Version,
		Entry:           version.Entry,
		SourceName:      version.SourceName,
		TotalSize:       version.TotalSize,
		Files:           files,
		URL:             pageHTMLEntryURL(version),
		Active:          active,
		AllowSameOrigin: PageHTMLOrigin() != "",
		CreatedAt:       version.CreatedAt,
	}
}
