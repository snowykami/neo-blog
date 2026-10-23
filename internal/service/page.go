package service

import (
	"context"
	"errors"
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
	if strings.TrimSpace(req.Title) == "" || slug == "" {
		return 0, errs.NewBadRequest("invalid_request_parameters")
	}
	pageType := req.Type
	if pageType == "" {
		pageType = "html"
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
		},
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
	return page.ToDto(), nil
}

func (p *PageService) UpdatePage(ctx context.Context, req *dto.CreateOrUpdatePageReq) (uint, *errs.ServiceError) {
	page, err := repo.Page.GetPageByID(req.ID)
	if err != nil {
		return 0, errs.NewNotFound("target_not_found")
	}
	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, page.UserID)) {
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
