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

func (cc *AdminController) ListComments(ctx context.Context, c *app.RequestContext) {
	paginationParams := &dto.PaginationParams{}
	if err := c.BindAndValidate(paginationParams); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if !slices.Contains(constant.OrderByEnumComment, paginationParams.OrderBy) {
		resps.BadRequest(c, "无效的排序字段")
		return
	}
	commentService := service.NewCommentService()
	comments, total, svcerr := commentService.ListCommentsAdmin(ctx, paginationParams, c.Query("query"))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"comments": comments, "total": total})
}
