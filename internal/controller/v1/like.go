package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type LikeController struct {
	service *service.LikeService
}

func NewLikeController() *LikeController {
	return &LikeController{
		service: service.NewLikeService(),
	}
}

func (lc *LikeController) ToggleLike(ctx context.Context, c *app.RequestContext) {
	var toggleLikeReq dto.ToggleLikeOrIsLikedOrLikedUsersReq
	if err := c.BindAndValidate(&toggleLikeReq); err != nil {
		logrus.Error(err)
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	liked, err := lc.service.ToggleLike(ctx, toggleLikeReq.TargetID, toggleLikeReq.TargetType)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		logrus.Error(serviceErr.Error())
		resps.Custom(c, serviceErr.Code, serviceErr.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"status": liked})
}

func (lc *LikeController) GetLikedUsers(ctx context.Context, c *app.RequestContext) {
	var req dto.ToggleLikeOrIsLikedOrLikedUsersReq
	if err := c.BindAndValidate(&req); err != nil {
		logrus.Error(err)
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// Set default and maximum limits
	if req.Number <= 0 {
		req.Number = 20
	}
	if req.Number > 100 {
		req.Number = 100
	}
	users, err := lc.service.GetLikedUsers(ctx, req.TargetID, req.TargetType, req.Number)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		logrus.Error(serviceErr.Error())
		resps.Custom(c, serviceErr.Code, serviceErr.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"users": users})
}
