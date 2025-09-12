package v1

import (
	"context"
	"slices"
	"strconv"

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
	req.UserAgent = string(c.UserAgent())
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
	id := c.Param("id")
	idInt, err := strconv.Atoi(id)
	if err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	req.CommentID = uint(idInt)

	err = cc.service.UpdateComment(ctx, &req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *CommentController) DeleteComment(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	err := cc.service.DeleteComment(ctx, id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *CommentController) GetComment(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	if id == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, err := cc.service.GetComment(ctx, id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (cc *CommentController) GetCommentList(ctx context.Context, c *app.RequestContext) {
	depth := c.Query("depth")
	depthInt, err := strconv.Atoi(depth)
	if err != nil || depthInt < 0 {
		depthInt = 1
	}
	pagination := ctxutils.GetPaginationParams(c)
	if pagination.OrderBy == "" {
		pagination.OrderBy = constant.OrderByUpdatedAt
	}
	if pagination.OrderBy != "" && !slices.Contains(constant.OrderByEnumComment, pagination.OrderBy) {
		resps.BadRequest(c, "无效的排序字段")
		return
	}
	targetID, err := strconv.Atoi(c.Query("target_id"))
	if err != nil {
		resps.BadRequest(c, "无效的 target_id")
		return
	}
	commentIDStr := c.Query("comment_id")
	var commentID uint
	if commentIDStr != "" {
		commentIDInt, err := strconv.Atoi(commentIDStr)
		if err != nil {
			resps.BadRequest(c, "无效的 comment_id")
			return
		}
		commentID = uint(commentIDInt)
	}
	req := dto.GetCommentListReq{
		Desc:       pagination.Desc,
		OrderBy:    pagination.OrderBy,
		Page:       pagination.Page,
		Size:       pagination.Size,
		Depth:      depthInt,
		TargetID:   uint(targetID),
		TargetType: c.Query("target_type"),
		CommentID:  commentID,
	}
	commentDtos, err := cc.service.GetCommentList(ctx, &req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"comments": commentDtos})
}

func (cc *CommentController) ReactComment(ctx context.Context, c *app.RequestContext) {

}
