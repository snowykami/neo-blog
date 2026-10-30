package v1

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	pkgutils "github.com/snowykami/neo-blog/pkg/utils"
)

// pageHTMLSandbox 上传的 HTML 一律在 CSP 沙箱中运行。不带 allow-same-origin 时文档为不透明源：
// 即使在新标签页直接打开，也读不到站点的 Cookie / localStorage，也无法携带凭据调用站点接口
const pageHTMLSandbox = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals"

type pageHTMLType struct {
	service *service.PageHTMLService
}

var PageHTML = &pageHTMLType{service: service.NewPageHTMLService()}

// Upload 上传单个 .html 文件或 .zip 包，创建新版本并立即生效
func (p *pageHTMLType) Upload(ctx context.Context, c *app.RequestContext) {
	var req dto.UploadPageHTMLReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 请求体为流式读取，解析表单前先按 Content-Length 拒绝超限上传（预留表单字段的开销）
	maxSize := pkgutils.Env.GetAsInt(constant.EnvKeyPageHTMLMaxTotalSize, constant.DefaultPageHTMLMaxTotalSize)
	if c.Request.Header.ContentLength() > maxSize+1<<20 {
		resps.Error(c, errs.New(413, "file_too_large", nil))
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	src, err := file.Open()
	if err != nil {
		resps.BadRequest(c, "failed_to_read_file")
		return
	}
	defer src.Close()
	version, svcerr := p.service.Upload(ctx, &service.PageHTMLUploadInput{
		PageID:   req.PageID,
		FileName: file.Filename,
		Size:     file.Size,
		Src:      src,
		Entry:    req.Entry,
	})
	if svcerr != nil {
		respondPageHTMLError(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, version)
}

func (p *pageHTMLType) ListVersions(ctx context.Context, c *app.RequestContext) {
	var req dto.ListPageHTMLVersionsReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	versions, svcerr := p.service.ListVersions(ctx, req.PageID)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"versions": versions})
}

func (p *pageHTMLType) UpdateVersion(ctx context.Context, c *app.RequestContext) {
	var req dto.UpdatePageHTMLVersionReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	version, svcerr := p.service.UpdateVersion(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, version)
}

// Serve 输出 HTML 页面的静态文件：始终经后端代理（不跳转存储直链），以便统一设置沙箱等响应头
func (p *pageHTMLType) Serve(ctx context.Context, c *app.RequestContext) {
	// 错误响应同样带上沙箱响应头
	setPageHTMLHeaders(c, service.IsPageHTMLOriginRequest(string(c.Host()), string(c.GetHeader("X-Forwarded-Host"))))
	var req dto.ServePageHTMLReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.NotFound(c, "target_not_found")
		return
	}
	file, svcerr := p.service.OpenFile(ctx, req.PageID, req.Key, req.Path)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	readable := file.File
	size := readable.Size()
	// 版本内容不会变化（新上传总是新版本），可长期缓存
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Accept-Ranges", "bytes")
	c.SetContentType(file.ContentType)

	// 单段 Range 请求：音视频拖动进度
	if rangeHeader := string(c.GetHeader("Range")); rangeHeader != "" {
		start, end, ok := parseByteRange(rangeHeader, size)
		if !ok {
			readable.Close()
			c.Header("Content-Range", fmt.Sprintf("bytes */%d", size))
			c.SetStatusCode(416)
			return
		}
		if _, err := readable.Seek(start, io.SeekStart); err != nil {
			readable.Close()
			resps.Error(c, errs.NewInternalServer("failed_to_read_file"))
			return
		}
		length := end - start + 1
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		c.SetStatusCode(206)
		c.SetBodyStream(&limitedReadCloser{Reader: io.LimitReader(readable, length), Closer: readable}, int(length))
		return
	}
	// 流读取完毕后由框架关闭文件
	c.SetBodyStream(readable, int(size))
}

// setPageHTMLHeaders 沙箱与跨源响应头：
//   - CSP sandbox 不带 allow-same-origin，只有经由配置的独立无 Cookie 源访问时才放开（见 service.IsPageHTMLOriginRequest）
//   - 不透明源的文档以 CORS 模式加载模块脚本与字体，需要 Access-Control-Allow-Origin: *（不允许携带凭据）
func setPageHTMLHeaders(c *app.RequestContext, sameOrigin bool) {
	csp := pageHTMLSandbox
	if sameOrigin {
		csp += " allow-same-origin"
	}
	c.Header("Content-Security-Policy", csp)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Referrer-Policy", "no-referrer")
}

// respondPageHTMLError 文件包校验失败时在 data.path 中返回出错的文件，便于管理员定位
func respondPageHTMLError(c *app.RequestContext, svcerr *errs.ServiceError) {
	var bundleErr *service.PageHTMLBundleError
	if errors.As(svcerr.Err, &bundleErr) && bundleErr.Path != "" {
		logrus.Debugf("page html bundle rejected: %v", bundleErr)
		resps.Custom(c, svcerr.Code, svcerr.Message, utils.H{"path": bundleErr.Path})
		return
	}
	resps.Error(c, svcerr)
}
