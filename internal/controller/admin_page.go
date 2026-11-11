package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// ListPages 后台页面管理：所有人的页面（含私密页面），传 user_id 时只看该用户的
func (cc *AdminController) ListPages(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListPageReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	pages, total, svcerr := service.NewPageService().ListPagesAdmin(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"pages": pages, "total": total})
}
