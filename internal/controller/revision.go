package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type revisionType struct {
	service *service.RevisionService
}

// Revision 文章 / 页面版本历史，targetType 由路由决定（post / page）
var Revision = &revisionType{service: service.NewRevisionService()}

func bindRevisionReq(c *app.RequestContext) (*dto.RevisionTargetReq, bool) {
	var req dto.RevisionTargetReq
	if err := c.BindAndValidate(&req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return nil, false
	}
	return &req, true
}

// List 版本列表
func (r *revisionType) List(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		req, ok := bindRevisionReq(c)
		if !ok {
			return
		}
		result, svcerr := r.service.List(ctx, targetType, req.ID, req.PaginationParams)
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, result)
	}
}

// Get 版本详情
func (r *revisionType) Get(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		req, ok := bindRevisionReq(c)
		if !ok {
			return
		}
		result, svcerr := r.service.Get(ctx, targetType, req.ID, req.RevisionID)
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, result)
	}
}

// Restore 恢复为指定版本（写入草稿与元信息，不直接发布）
func (r *revisionType) Restore(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		req, ok := bindRevisionReq(c)
		if !ok {
			return
		}
		if svcerr := r.service.Restore(ctx, targetType, req.ID, req.RevisionID, req.EditSessionID); svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, nil)
	}
}

// DiscardDraft 放弃未发布的修改
func (r *revisionType) DiscardDraft(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		req, ok := bindRevisionReq(c)
		if !ok {
			return
		}
		if svcerr := r.service.DiscardDraft(ctx, targetType, req.ID, req.EditSessionID); svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, nil)
	}
}

// Delete 删除单个版本
func (r *revisionType) Delete(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		req, ok := bindRevisionReq(c)
		if !ok {
			return
		}
		if svcerr := r.service.Delete(ctx, targetType, req.ID, req.RevisionID, req.EditSessionID); svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, nil)
	}
}

// BatchDelete 批量删除版本
func (r *revisionType) BatchDelete(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		var req dto.BatchDeleteRevisionReq
		if err := c.BindAndValidate(&req); err != nil || req.ID == 0 {
			resps.BadRequest(c, resps.ErrParamInvalid)
			return
		}
		result, svcerr := r.service.BatchDelete(ctx, targetType, req.ID, req.RevisionIDs, req.EditSessionID)
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, result)
	}
}
