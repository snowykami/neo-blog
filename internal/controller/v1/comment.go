package v1

import (
	"context"
	"slices"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type CommentController struct {
	service *service.CommentService
}

func NewCommentController() *CommentController {
	return &CommentController{
		service: service.NewCommentService(),
	}
}

func (cc *CommentController) CreateComment(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateCommentReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, err.Error())
		return
	}
	req.RemoteAddr = c.ClientIP()
	commentID, err := cc.service.CreateComment(ctx, &req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": commentID})
}

func (cc *CommentController) UpdateComment(ctx context.Context, c *app.RequestContext) {
	var req dto.UpdateCommentReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	err := cc.service.UpdateComment(ctx, &req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *CommentController) DeleteComment(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	err := cc.service.DeleteComment(ctx, id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *CommentController) GetComment(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	resp, err := cc.service.GetComment(ctx, id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (cc *CommentController) GetCommentList(ctx context.Context, c *app.RequestContext) {
	req := &dto.GetCommentListReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 校验排序字段
	if !slices.Contains(constant.OrderByEnumComment, req.OrderBy) {
		resps.BadRequest(c, "无效的排序字段")
		return
	}
	commentDtos, err := cc.service.GetCommentList(ctx, req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"comments": commentDtos})
}

func (cc *CommentController) ReactComment(ctx context.Context, c *app.RequestContext) {

}
