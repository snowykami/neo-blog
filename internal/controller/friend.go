package v1

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type FriendController struct {
	service *service.FriendService
}

func NewFriendController() *FriendController {
	return &FriendController{
		service: service.NewFriendService(),
	}
}

func setPublicFriendCORSHeaders(c *app.RequestContext) {
	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
}

func (f *FriendController) OptionsPublic(ctx context.Context, c *app.RequestContext) {
	setPublicFriendCORSHeaders(c)
	c.Status(http.StatusNoContent)
}

func (f *FriendController) ListPublic(ctx context.Context, c *app.RequestContext) {
	setPublicFriendCORSHeaders(c)
	groupSlug := c.Query("group")
	resp, svcerr := f.service.ListPublicFriends(ctx, groupSlug)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) ListMine(ctx context.Context, c *app.RequestContext) {
	resp, svcerr := f.service.GetMyFriendLinks(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) Autofill(ctx context.Context, c *app.RequestContext) {
	req := &dto.FriendAutofillReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.AutofillFriendLink(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) CreateMine(ctx context.Context, c *app.RequestContext) {
	req := &dto.UpsertMyFriendLinkReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.CreateMyFriendLink(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) UpdateMine(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	req := &dto.UpsertMyFriendLinkReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.UpdateMyFriendLink(ctx, id, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) DeleteMine(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if svcerr := f.service.DeleteMyFriendLink(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// ============================================================================
// 管理员接口
// ============================================================================

func (f *FriendController) AdminListGroups(ctx context.Context, c *app.RequestContext) {
	groups, svcerr := f.service.AdminListGroups(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, map[string]any{"groups": groups})
}

func (f *FriendController) AdminCreateGroup(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminUpsertFriendGroupReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	grp, svcerr := f.service.AdminCreateGroup(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, grp)
}

func (f *FriendController) AdminUpdateGroup(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	req := &dto.AdminUpsertFriendGroupReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	grp, svcerr := f.service.AdminUpdateGroup(ctx, id, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, grp)
}

func (f *FriendController) AdminReorderGroups(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminReorderFriendGroupsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := f.service.AdminReorderGroups(ctx, req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (f *FriendController) AdminDeleteGroup(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if svcerr := f.service.AdminDeleteGroup(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (f *FriendController) AdminListLinks(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminListFriendLinksReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.AdminListLinks(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminCreateLink(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminUpsertFriendLinkReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.AdminCreateLink(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminUpdateLink(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	req := &dto.AdminUpsertFriendLinkReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.AdminUpdateLink(ctx, id, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminReviewLink(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	req := &dto.AdminReviewFriendLinkReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.AdminReviewLink(ctx, id, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminTransferLink(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	req := &dto.AdminTransferFriendLinkReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.AdminTransferLink(ctx, id, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminDeleteLink(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if svcerr := f.service.AdminDeleteLink(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (f *FriendController) AdminProbeLink(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	resp, svcerr := f.service.AdminProbeLink(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminProbeAll(ctx context.Context, c *app.RequestContext) {
	if svcerr := f.service.AdminTriggerProbeAll(ctx); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
