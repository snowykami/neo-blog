package service

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
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
	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Slug) == "" {
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
			Slug:         req.Slug,
			Description:  req.Description,
			Cover:        req.Cover,
			Content:      req.Content,
			DraftContent: req.DraftContent,
			Type:         pageType,
			IsPrivate:    req.IsPrivate,
			ShowInNav:    req.ShowInNav,
			NavOrder:     req.NavOrder,
		},
	}
	if err := repo.Page.CreatePage(page); err != nil {
		return 0, errs.NewInternalServer("failed_to_create_target")
	}
	return page.ID, nil
}

func (p *PageService) DeletePage(ctx context.Context, pageID uint) *errs.ServiceError {
	if pageID == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	page, err := repo.Page.GetPageBySlugOrID(strconv.FormatUint(uint64(pageID), 10))
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
	page, err := repo.Page.GetPageBySlugOrID(strconv.FormatUint(uint64(req.ID), 10))
	if err != nil {
		return 0, errs.NewNotFound("target_not_found")
	}
	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, page.UserID)) {
		return 0, errs.NewForbidden("permission_denied")
	}
	utils.UpdateNonEmpty(&page.Title, req.Title)
	utils.UpdateNonEmpty(&page.Slug, req.Slug)
	utils.UpdateNonEmpty(&page.Type, req.Type)
	utils.UpdateNonEmpty(&page.Content, req.Content)
	utils.UpdateNonEmpty(&page.Cover, req.Cover)
	utils.UpdateNonEmpty(&page.Description, req.Description)
	utils.UpdatePtrNonZero(&page.DraftContent, req.DraftContent)
	utils.UpdateBool(&page.IsPrivate, req.IsPrivate)
	utils.UpdateBool(&page.ShowInNav, req.ShowInNav)
	page.NavOrder = req.NavOrder

	if err := repo.Page.SavePage(page); err != nil {
		return 0, errs.NewInternalServer("failed_to_update_target")
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
