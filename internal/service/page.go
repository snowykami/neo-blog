package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
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
			return 0, errs.NewConflict("slug_already_exists")
		}
		return 0, errs.NewInternalServer("failed_to_create_target")
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
			return errs.NewNotFound("target_not_found")
		}
		return errs.NewInternalServer("failed_to_get_target")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, page.UserID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	if err := repo.Page.DeletePage(pageID); err != nil {
		return errs.NewInternalServer("failed_to_delete_target")
	}
	if err := repo.Revision.DeleteByTarget(constant.TargetTypePage, pageID); err != nil {
		logrus.Warnf("delete revisions of page %d failed: %v", pageID, err)
	}
	if err := NewPageHTMLService().DeleteAllForPage(ctx, pageID); err != nil {
		logrus.Warnf("delete html versions of page %d failed: %v", pageID, err)
	}
	return nil
}

func (p *PageService) GetPageSlugOrID(ctx context.Context, slugOrID string) (*dto.PageDto, *errs.ServiceError) {
	if slugOrID == "" {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	page, err := repo.Page.GetPageBySlugOrID(slugOrID)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found")
	}
	if page.IsPrivate && !(ctxutils.IsOwnerOfTarget(ctx, page.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	pageDto := page.ToDto()
	pageDto.HTMLBundle = NewPageHTMLService().BundleForPage(page)
	return pageDto, nil
}

func (p *PageService) UpdatePage(ctx context.Context, req *dto.CreateOrUpdatePageReq) (uint, *errs.ServiceError) {
	page, err := repo.Page.GetPageByID(req.ID)
	if err != nil {
		return 0, errs.NewNotFound("target_not_found")
	}
	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, page.UserID)) {
		return 0, errs.NewForbidden("permission_denied")
	}
	// HTML 页面只有管理员可以修改，也只有管理员可以把页面改为 HTML 页面
	touchesHTML := model.NormalizePageKind(page.Kind) == model.PageKindHTML ||
		(req.Kind != nil && model.NormalizePageKind(*req.Kind) == model.PageKindHTML)
	if touchesHTML && !ctxutils.IsAdmin(ctx) {
		return 0, errs.NewForbidden("permission_denied")
	}
	// 保存正文时校验编辑会话，被其他编辑会话顶掉后不能再覆盖正文
	if req.Content != "" || req.DraftContent != nil {
		if svcerr := NewEditSessionService().CheckContentWrite(constant.TargetTypePage, page.ID, req.EditSessionID); svcerr != nil {
			return 0, svcerr
		}
	}
	utils.UpdateNonEmpty(&page.Title, req.Title)
	slug, svcerr := normalizeSlug(req.Slug)
	if svcerr != nil {
		return 0, svcerr
	}
	utils.UpdateNonEmpty(&page.Slug, slug)
	utils.UpdateNonEmpty(&page.Type, req.Type)
	utils.UpdateNonEmpty(&page.Content, req.Content)
	if req.Cover != nil {
		page.Cover = *req.Cover
	}
	if req.Description != nil {
		page.Description = *req.Description
	}
	utils.UpdatePtrNonZero(&page.DraftContent, req.DraftContent)
	// 未传的字段保持原值，只保存草稿时不会重置私密与导航设置
	if req.IsPrivate != nil {
		page.IsPrivate = *req.IsPrivate
	}
	if req.ShowInNav != nil {
		page.ShowInNav = *req.ShowInNav
	}
	if req.NavOrder != nil {
		page.NavOrder = *req.NavOrder
	}
	if req.Layout != nil {
		page.Layout = model.NormalizePageLayout(*req.Layout)
	}
	if req.Fullscreen != nil {
		page.Fullscreen = *req.Fullscreen
	}
	if req.Kind != nil {
		page.Kind = model.NormalizePageKind(*req.Kind)
	}
	if req.LinkURL != nil {
		page.LinkURL = *req.LinkURL
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
		return 0, svcerr
	}
	// 链接页面必须有合法的地址；正文页面不保留链接地址
	if model.NormalizePageKind(page.Kind) == model.PageKindLink {
		link, svcerr := normalizePageLink(page.LinkURL)
		if svcerr != nil {
			return 0, svcerr
		}
		page.LinkURL = link
	} else {
		page.LinkURL = ""
	}

	if err := repo.Page.SavePage(page); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return 0, errs.NewConflict("slug_already_exists")
		}
		return 0, errs.NewInternalServer("failed_to_update_target")
	}
	// 发布或保存草稿后记录版本历史
	if req.Content != "" || req.DraftContent != nil {
		NewRevisionService().RecordAfterSave(ctx, constant.TargetTypePage, page.ID, req.Content != "", req.EditSessionID)
	}
	return page.ID, nil
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

func (p *PageService) ListPages(ctx context.Context, req *dto.ListPageReq) ([]*dto.PageDto, int64, *errs.ServiceError) {
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	queryArray := make([]string, 0)
	if req.Query != "" {
		for _, q := range strings.Split(req.Query, ",") {
			queryArray = append(queryArray, strings.TrimSpace(q))
		}
	}
	pages, total, err := repo.Page.ListPages(currentUserID, req, queryArray)
	if err != nil {
		return nil, total, errs.NewInternalServer("failed_to_get_target")
	}
	pageDtos := make([]*dto.PageDto, 0, len(pages))
	for _, page := range pages {
		pageDtos = append(pageDtos, page.ToDtoWithShortContent(200))
	}
	return pageDtos, total, nil
}
