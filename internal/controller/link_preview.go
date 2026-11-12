package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type linkPreviewType struct {
	service *service.LinkPreviewService
}

// LinkPreview 正文外链与链接卡片的元信息预览
var LinkPreview = &linkPreviewType{service: service.NewLinkPreviewService()}

func (l *linkPreviewType) Get(ctx context.Context, c *app.RequestContext) {
	var req dto.LinkPreviewReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	preview, publicCacheable, svcerr := l.service.Get(ctx, &req, string(c.GetHeader("Accept-Language")))
	if svcerr != nil {
		c.Response.Header.Set("Cache-Control", "no-store")
		resps.Error(c, svcerr)
		return
	}
	if publicCacheable {
		c.Response.Header.Set("Cache-Control", "public, max-age=600")
	} else {
		c.Response.Header.Set("Cache-Control", "private, max-age=300")
	}
	resps.Ok(c, resps.Success, preview)
}
