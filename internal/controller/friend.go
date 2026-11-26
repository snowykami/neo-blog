package v1

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
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
	c.Header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
}

func (f *FriendController) OptionsPublic(ctx context.Context, c *app.RequestContext) {
	setPublicFriendCORSHeaders(c)
	c.Status(http.StatusNoContent)
}

func (f *FriendController) ListPublic(ctx context.Context, c *app.RequestContext) {
	setPublicFriendCORSHeaders(c)
	groupSlug := c.Query("group")
	sortMode := c.Query("sort")
	resp, svcerr := f.service.ListPublicFriends(ctx, groupSlug, sortMode)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

// ifNoneMatchHits 兼容前置压缩层（Next.js / Nginx / CDN）自动附加 W/ 弱校验前缀及多值列表的 ETag 匹配
func ifNoneMatchHits(headerVal, etag string) bool {
	if headerVal == "" || etag == "" {
		return false
	}
	cleanTarget := strings.TrimPrefix(strings.TrimSpace(etag), "W/")
	for _, rawPart := range strings.Split(headerVal, ",") {
		part := strings.TrimSpace(rawPart)
		if part == "*" {
			return true
		}
		if strings.TrimPrefix(part, "W/") == cleanTarget {
			return true
		}
	}
	return false
}

func (f *FriendController) GetAvatar(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	hash := c.Param("hash")
	res, svcerr := f.service.GetFriendAvatarThumbnail(ctx, id, hash)
	if svcerr != nil {
		// 鉴权拦截或记录不存在统一禁公共缓存，防止前置 CDN 对未审核/私密分组友链造成负缓存投毒
		c.Header("Cache-Control", "private, no-store")
		c.Header("Vary", "Authorization, Cookie")
		resps.Error(c, svcerr)
		return
	}
	if res.IsPublicCache || res.ViaAPIToken {
		setPublicFriendCORSHeaders(c)
	}
	if !res.IsPublicCache {
		c.Header("Vary", "Authorization, Cookie")
	}
	if res.Unavailable {
		if res.IsPublicCache {
			c.Header("Cache-Control", "public, max-age=120")
		} else {
			c.Header("Cache-Control", "private, no-store")
		}
		resps.Error(c, errs.NewNotFound("friend_avatar_unavailable"))
		return
	}

	if res.RedirectURL != "" {
		if res.IsPublicCache {
			c.Header("Cache-Control", "public, max-age=300")
		} else {
			c.Header("Cache-Control", "no-store")
		}
		c.Redirect(http.StatusFound, []byte(res.RedirectURL))
		return
	}

	if res.IsPublicCache {
		c.Header("Cache-Control", "public, max-age=86400")
	} else {
		c.Header("Cache-Control", "private, max-age=3600")
	}
	c.Header("ETag", res.ETag)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "inline; filename=\"avatar\"")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")

	if ifNoneMatchHits(string(c.GetHeader("If-None-Match")), res.ETag) {
		c.SetStatusCode(http.StatusNotModified)
		return
	}
	c.Header("Content-Length", strconv.Itoa(len(res.Data)))
	if string(c.Method()) == http.MethodHead {
		c.Header("Content-Type", res.ContentType)
		c.Status(http.StatusOK)
		return
	}
	c.Data(http.StatusOK, res.ContentType, res.Data)
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

func (f *FriendController) AdminGetSortOverview(ctx context.Context, c *app.RequestContext) {
	resp, svcerr := f.service.AdminGetSortOverview(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminUpdateSortMode(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminUpdateFriendSortModeReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	mode, svcerr := f.service.AdminUpdateSortMode(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, map[string]any{"sort_mode": mode})
}

func (f *FriendController) AdminGetSettings(ctx context.Context, c *app.RequestContext) {
	resp, svcerr := f.service.AdminGetSettings(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminUpdateSettings(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminUpdateFriendSettingsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := f.service.AdminUpdateSettings(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (f *FriendController) AdminReorderLinks(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminReorderFriendLinksReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := f.service.AdminReorderLinks(ctx, req); svcerr != nil {
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
