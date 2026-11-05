package v1

import (
	"context"
	"slices"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func (cc *AdminController) ListPosts(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListPostReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if !slices.Contains(constant.OrderByEnumPost, req.OrderBy) {
		resps.BadRequest(c, "invalid_order_by")
		return
	}
	postService := service.NewPostService()
	posts, total, svcerr := postService.ListPostsAdmin(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"posts": posts, "total": total})
}

// ListPinnedPosts 首页上的全部置顶文章（含私密文章），供后台管理
func (cc *AdminController) ListPinnedPosts(ctx context.Context, c *app.RequestContext) {
	posts, svcerr := service.NewPostService().ListPinnedPostsAdmin(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"posts": posts, "limit": service.MaxPinnedPosts})
}

// SetPostPin 置顶到首页或取消置顶
func (cc *AdminController) SetPostPin(ctx context.Context, c *app.RequestContext) {
	req := &dto.SetPostPinReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	post, svcerr := service.NewPostService().SetPostPin(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, post)
}
