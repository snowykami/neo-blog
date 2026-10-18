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
		resps.BadRequest(c, "无效的排序字段")
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
