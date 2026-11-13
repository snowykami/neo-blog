package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// linkPageSlugPrefix 链接页面自动生成的 slug 前缀
const linkPageSlugPrefix = "link-"

type PageService struct{}

func NewPageService() *PageService {
	return &PageService{}
}

func (p *PageService) CreatePage(ctx context.Context, req *dto.CreateOrUpdatePageReq) (uint, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}
	slug, svcerr := normalizeSlug(req.Slug)
	if svcerr != nil {
		return 0, svcerr
	}
	kind := model.NormalizePageKind(utils.Deref(req.Kind))
	// HTML 页面可运行任意脚本，只有管理员可以创建
	if kind == model.PageKindHTML && !ctxutils.IsAdmin(ctx) {
		return 0, errs.NewForbidden("permission_denied")
	}
	// 链接页面通过导航跳转到它的地址，不需要自己的访问路径：未填写时生成内部 slug，只用于满足唯一约束
	if kind == model.PageKindLink && slug == "" {
		slug = linkPageSlugPrefix + strings.ToLower(utils.Strings.GenerateRandomString(10))
	}
	if strings.TrimSpace(req.Title) == "" || slug == "" {
		return 0, errs.NewBadRequest("invalid_request_parameters")
	}
	pageType := req.Type
	if pageType == "" {
		pageType = "html"
	}
	linkURL := ""
	if kind == model.PageKindLink {
		if linkURL, svcerr = normalizePageLink(utils.Deref(req.LinkURL)); svcerr != nil {
			return 0, svcerr
		}
	}
	page := &model.Page{
		UserID: currentUser.ID,
		PageBase: model.PageBase{
			Title:        req.Title,
			Slug:         slug,
			Description:  utils.Deref(req.Description),
			Cover:        utils.Deref(req.Cover),
			Content:      req.Content,
			DraftContent: req.DraftContent,
			Type:         pageType,
			IsPrivate:    utils.Deref(req.IsPrivate),
			ShowInNav:    utils.Deref(req.ShowInNav),
			NavOrder:     utils.Deref(req.NavOrder),
			Layout:       model.NormalizePageLayout(utils.Deref(req.Layout)),
			Kind:         kind,
			LinkURL:      linkURL,
			Fullscreen:   utils.Deref(req.Fullscreen),
			// HTML 页面的显示尺寸
			HTMLSizeMode:    utils.Deref(req.HTMLSizeMode),
			HTMLAspectRatio: utils.Deref(req.HTMLAspectRatio),
			HTMLHeight:      utils.Deref(req.HTMLHeight),
		},
	}
	if svcerr := normalizePageHTMLSize(page); svcerr != nil {
		return 0, svcerr
	}
	if err := repo.Page.CreatePage(page); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return 0, errs.AlreadyExists("page", "slug", slug)
		}
		return 0, errs.Internal("failed_to_create_target", err).WithResource("page")
	}
	if !page.IsPrivate {
		SyncSearchPage(page.ID, false)
	}
	return page.ID, nil
}

func (p *PageService) DeletePage(ctx context.Context, pageID uint) *errs.ServiceError {
	if pageID == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	page, err := repo.Page.GetPageByID(pageID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errs.NewNotFound("target_not_found").WithResource("page")
		}
		return errs.Internal("failed_to_get_target", err).WithResource("page")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, page.UserID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	notified, err := repo.Page.DeletePage(pageID)
	if err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("page")
	}
	notifyNotificationUsers(notified)
	if err := repo.Revision.DeleteByTarget(constant.TargetTypePage, pageID); err != nil {
		logrus.Warnf("delete revisions of page %d failed: %v", pageID, err)
	}
	if err := NewPageHTMLService().DeleteAllForPage(ctx, pageID); err != nil {
		logrus.Warnf("delete html versions of page %d failed: %v", pageID, err)
	}
	SyncSearchPage(pageID, true)
	return nil
}

// GetPageSlugOrID 前台读取页面：不看当前用户是谁，私密页面对所有人（含作者与管理员）都当作不存在（404），不返回草稿；
// 作者在后台预览里看（见 GetPageForEdit）
func (p *PageService) GetPageSlugOrID(ctx context.Context, slugOrID string) (*dto.PageDto, *errs.ServiceError) {
	if slugOrID == "" {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	return pageCached("detail:"+slugOrID, func() (*dto.PageDto, *errs.ServiceError) {
		page, err := repo.Page.GetPageBySlugOrID(slugOrID)
		if err != nil || page.IsPrivate {
			return nil, errs.NewNotFound("target_not_found").WithResource("page")
		}
		pageDto := page.ToDto()
		pageDto.DraftContent = nil
		pageDto.DraftVersion = 0
		pageDto.HasDraft = false
		pageDto.HTMLBundle = NewPageHTMLService().BundleForPage(page)
		return pageDto, nil
	})
}

// GetPageForEdit 后台编辑器与预览读取页面：含私密页面与草稿（没有草稿时取已发布的正文），
// 要求当前角色为编辑及以上（与路由一致），且为作者本人或管理员
func (p *PageService) GetPageForEdit(ctx context.Context, slugOrID string) (*dto.PageDto, *errs.ServiceError) {
	if slugOrID == "" {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	if !currentUser.GreaterThanEditor() {
		return nil, errs.NewForbidden("permission_denied")
	}
	page, err := repo.Page.GetPageBySlugOrID(slugOrID)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("page")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, page.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	pageDto := page.ToDto()
	if pageDto.DraftContent == nil {
		pageDto.DraftContent = &pageDto.Content
	}
	pageDto.HTMLBundle = NewPageHTMLService().BundleForPage(page)
	return pageDto, nil
}

func (p *PageService) UpdatePage(ctx context.Context, req *dto.CreateOrUpdatePageReq) (*dto.ContentSaveResult, *errs.ServiceError) {
	page, err := repo.Page.GetPageByID(req.ID)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("page")
	}
	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, page.UserID)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	// HTML 页面只有管理员可以修改，也只有管理员可以把页面改为 HTML 页面
	touchesHTML := model.NormalizePageKind(page.Kind) == model.PageKindHTML ||
		(req.Kind != nil && model.NormalizePageKind(*req.Kind) == model.PageKindHTML)
	if touchesHTML && !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	// 保存正文时校验编辑会话与草稿版本号，见 checkContentWrite
	contentWrite := req.Content != "" || req.DraftContent != nil
	baseVersion := page.DraftVersion
	if contentWrite {
		if svcerr := checkContentWrite(ctx, constant.TargetTypePage, page.ID, req.EditSessionID, req.BaseDraftVersion, baseVersion); svcerr != nil {
			return nil, svcerr
		}
	}
	// 只写入本次请求改动的列：page 是请求开始时读到的快照，整行写回会覆盖期间他人写入的正文、草稿与 HTML 版本
	var columns []string
	if req.Title != "" {
		page.Title = req.Title
		columns = append(columns, "title")
	}
	slug, svcerr := normalizeSlug(req.Slug)
	if svcerr != nil {
		return nil, svcerr
	}
	if slug != "" {
		page.Slug = slug
		columns = append(columns, "slug")
	}
	if req.Type != "" {
		page.Type = req.Type
		columns = append(columns, "type")
	}
	if req.Content != "" {
		page.Content = req.Content
		columns = append(columns, "content")
	}
	if req.Cover != nil {
		page.Cover = *req.Cover
		columns = append(columns, "cover")
	}
	if req.Description != nil {
		page.Description = *req.Description
		columns = append(columns, "description")
	}
	if req.DraftContent != nil && *req.DraftContent != "" {
		page.DraftContent = req.DraftContent
		columns = append(columns, "draft_content")
	}
	// 未传的字段保持原值，只保存草稿时不会重置私密与导航设置
	wasPrivate := page.IsPrivate
	if req.IsPrivate != nil {
		page.IsPrivate = *req.IsPrivate
		columns = append(columns, "is_private")
	}
	if req.ShowInNav != nil {
		page.ShowInNav = *req.ShowInNav
		columns = append(columns, "show_in_nav")
	}
	if req.NavOrder != nil {
		page.NavOrder = *req.NavOrder
		columns = append(columns, "nav_order")
	}
	if req.Layout != nil {
		page.Layout = model.NormalizePageLayout(*req.Layout)
		columns = append(columns, "layout")
	}
	if req.Fullscreen != nil {
		page.Fullscreen = *req.Fullscreen
		columns = append(columns, "fullscreen")
	}
	if req.Kind != nil {
		page.Kind = model.NormalizePageKind(*req.Kind)
		columns = append(columns, "kind")
	}
	if req.LinkURL != nil {
		page.LinkURL = *req.LinkURL
	}
	// 尺寸字段一起校验与写入：改了其中任一项，规范化后的三项都要落库
	if req.HTMLSizeMode != nil || req.HTMLAspectRatio != nil || req.HTMLHeight != nil {
		columns = append(columns, "html_size_mode", "html_aspect_ratio", "html_height")
	}
	if req.HTMLSizeMode != nil {
		page.HTMLSizeMode = *req.HTMLSizeMode
	}
	if req.HTMLAspectRatio != nil {
		page.HTMLAspectRatio = *req.HTMLAspectRatio
	}
	if req.HTMLHeight != nil {
		page.HTMLHeight = *req.HTMLHeight
	}
	if svcerr := normalizePageHTMLSize(page); svcerr != nil {
		return nil, svcerr
	}
	// 链接页面必须有合法的地址；正文页面不保留链接地址
	if model.NormalizePageKind(page.Kind) == model.PageKindLink {
		link, svcerr := normalizePageLink(page.LinkURL)
		if svcerr != nil {
			return nil, svcerr
		}
		page.LinkURL = link
	} else {
		page.LinkURL = ""
	}
	// 改了类型或链接地址时写入规范化后的链接地址（改为正文页面时清空）
	if req.Kind != nil || req.LinkURL != nil {
		columns = append(columns, "link_url")
	}

	// 写入正文时草稿版本号加一；读取之后有其他写入则拒绝，不覆盖对方的修改
	if contentWrite {
		err = repo.Page.SavePageWithDraftVersion(page, baseVersion, columns)
	} else {
		err = repo.Page.SavePage(page, columns)
	}
	if err != nil {
		if errors.Is(err, repo.ErrDraftVersionConflict) {
			return nil, errs.NewConflict("draft_conflict")
		}
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, errs.AlreadyExists("page", "slug", slug)
		}
		return nil, errs.Internal("failed_to_update_target", err).WithResource("page")
	}
	// 发布或保存草稿后记录版本历史
	if req.Content != "" || req.DraftContent != nil {
		NewRevisionService().RecordAfterSave(ctx, constant.TargetTypePage, page.ID, req.Content != "", req.EditSessionID)
	}
	// 通知打开了编辑页的客户端：编辑页据此合并他人（外部 AI 工具）的修改
	publishSavedEvent(ctx, constant.TargetTypePage, page.ID, page.DraftVersion)
	if slices.ContainsFunc(columns, func(col string) bool { return col != "draft_content" && col != "has_draft" }) {
		SyncSearchPage(page.ID, wasPrivate != page.IsPrivate || slices.Contains(columns, "title"))
	}
	return &dto.ContentSaveResult{ID: page.ID, DraftVersion: page.DraftVersion}, nil
}

// normalizePageLink 链接页面的地址：站内路径（以单个 / 开头）或 http(s) 绝对地址；
// 协议相对地址（//host）、javascript: 等其他协议与含空白的地址一律拒绝
func normalizePageLink(raw string) (string, *errs.ServiceError) {
	link := strings.TrimSpace(raw)
	if link == "" || len(link) > 2000 || strings.ContainsAny(link, " \t\r\n\\") {
		return "", errs.NewBadRequest("invalid_page_link")
	}
	if strings.HasPrefix(link, "/") && !strings.HasPrefix(link, "//") {
		return link, nil
	}
	if u, err := url.Parse(link); err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
		return link, nil
	}
	return "", errs.NewBadRequest("invalid_page_link")
}

// normalizePageHTMLSize 校验 HTML 页面的显示尺寸：只校验当前尺寸模式用到的字段，
// 固定宽高比为「宽:高」（1~1000 的整数），固定高度为 100~10000px
func normalizePageHTMLSize(page *model.Page) *errs.ServiceError {
	page.HTMLSizeMode = model.NormalizePageHTMLSizeMode(page.HTMLSizeMode)
	switch page.HTMLSizeMode {
	case model.PageHTMLSizeRatio:
		ratio, ok := normalizeAspectRatio(page.HTMLAspectRatio)
		if !ok {
			return errs.NewBadRequest("invalid_page_html_size")
		}
		page.HTMLAspectRatio = ratio
	case model.PageHTMLSizeHeight:
		if page.HTMLHeight < 100 || page.HTMLHeight > 10000 {
			return errs.NewBadRequest("invalid_page_html_size")
		}
	}
	return nil
}

// normalizeAspectRatio 接受 16:9、16/9 等写法，统一为 16:9
func normalizeAspectRatio(raw string) (string, bool) {
	sep := ":"
	if !strings.Contains(raw, sep) {
		sep = "/"
	}
	w, h, found := strings.Cut(raw, sep)
	if !found {
		return "", false
	}
	width, errW := strconv.Atoi(strings.TrimSpace(w))
	height, errH := strconv.Atoi(strings.TrimSpace(h))
	if errW != nil || errH != nil || width < 1 || height < 1 || width > 1000 || height > 1000 {
		return "", false
	}
	return fmt.Sprintf("%d:%d", width, height), true
}

// ListPages 前台页面列表（导航等）：不看当前用户是谁，只返回公开页面
func (p *PageService) ListPages(ctx context.Context, req *dto.ListPageReq) ([]*dto.PageDto, int64, *errs.ServiceError) {
	res, svcerr := pageCached(pageListCacheKey(req), func() (guestPageList, *errs.ServiceError) {
		pages, total, svcerr := p.listPages(req, false)
		return guestPageList{Pages: pages, Total: total}, svcerr
	})
	return res.Pages, res.Total, svcerr
}

// ListMyPages 后台「我的页面」：当前用户自己的全部页面（含私密页面），要求编辑及以上角色（与路由一致）
func (p *PageService) ListMyPages(ctx context.Context, req *dto.ListPageReq) ([]*dto.PageDto, int64, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, 0, errs.NewUnauthorized("login_required")
	}
	if !currentUser.GreaterThanEditor() {
		return nil, 0, errs.NewForbidden("permission_denied")
	}
	req.UserID = currentUser.ID
	return p.listPages(req, true)
}

// ListPagesAdmin 后台页面管理列出所有人的页面（含私密页面），仅管理员；传 user_id 时只看该用户的页面
func (p *PageService) ListPagesAdmin(ctx context.Context, req *dto.ListPageReq) ([]*dto.PageDto, int64, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, 0, errs.NewForbidden("permission_denied")
	}
	return p.listPages(req, true)
}

// listPages includePrivate 为 true 时是后台管理视图（含私密页面）
func (p *PageService) listPages(req *dto.ListPageReq, includePrivate bool) ([]*dto.PageDto, int64, *errs.ServiceError) {
	if !includePrivate && strings.TrimSpace(req.Query) != "" {
		if dtos, total, ok := searchPublicPagesMeili(req); ok {
			return dtos, total, nil
		}
	}
	queryArray := make([]string, 0)
	if req.Query != "" {
		for _, q := range strings.Split(req.Query, ",") {
			queryArray = append(queryArray, strings.TrimSpace(q))
		}
	}
	pages, total, err := repo.Page.ListPages(includePrivate, req, queryArray)
	if err != nil {
		return nil, total, errs.Internal("failed_to_get_target", err).WithResource("page")
	}
	pageDtos := make([]*dto.PageDto, 0, len(pages))
	for _, page := range pages {
		dtoPage := page.ToDtoWithShortContent(200)
		if includePrivate {
			dtoPage.HasDraft = page.HasDraft
		}
		pageDtos = append(pageDtos, dtoPage)
	}
	return pageDtos, total, nil
}
