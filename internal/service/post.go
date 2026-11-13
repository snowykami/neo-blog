package service

import (
	"context"
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type PostService struct{}

func NewPostService() *PostService {
	return &PostService{}
}

func (p *PostService) CreatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (uint, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}
	slug, svcerr := normalizePostSlug(req.Slug)
	if svcerr != nil {
		return 0, svcerr
	}
	labels, err := repo.Label.GetLabelsByIDs(req.LabelIds)
	if err != nil {
		return 0, errs.Internal("failed_to_get_target", err).WithResource("label")
	}
	categoryID, svcerr := normalizeCategoryID(req.CategoryID)
	if svcerr != nil {
		return 0, svcerr
	}
	background := normalizePostBackground(utils.Deref(req.Background))
	post := &model.Post{
		UserID: currentUser.ID,
		PostBase: model.PostBase{
			CategoryID:          categoryID,
			Cover:               utils.Deref(req.Cover),
			BackgroundImage:     background.Image,
			BackgroundBlur:      background.Blur,
			BackgroundOpacity:   background.Opacity,
			BackgroundVeil:      background.Veil,
			BackgroundVeilColor: background.VeilColor,
			Content:             req.Content,
			ContentTheme:        config.NormalizeContentTheme(utils.Deref(req.ContentTheme)),
			Description:         utils.Deref(req.Description),
			DraftContent:        req.DraftContent,
			IsPrivate:           utils.Deref(req.IsPrivate),
			IsDraft:             strings.TrimSpace(req.Content) == "",
			Labels:              labels,
			Slug:                slug,
			Title:               req.Title,
			Type:                req.Type,
		},
	}
	if err := repo.Post.CreatePost(post); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return 0, errs.AlreadyExists("post", "slug", slug)
		}
		return 0, errs.Internal("failed_to_create_target", err).WithResource("post")
	}
	// 直接以公开已发布状态创建时：曝光给感兴趣的 AI 用户，并写入公开搜索索引；空正文草稿待首次发布时再触发
	if post.IsPublic() {
		NotifyPostPublished(post.ID)
		SyncSearchPost(post.ID, post.UserID, false)
	}
	return post.ID, nil
}

// normalizeSlug 去除首尾空白；纯数字 slug 会与 id 访问冲突，不允许使用
func normalizeSlug(slug string) (string, *errs.ServiceError) {
	slug = strings.TrimSpace(slug)
	if slug != "" && strings.Trim(slug, "0123456789") == "" {
		return "", errs.NewBadRequest("slug_cannot_be_numeric")
	}
	return slug, nil
}

// normalizePostSlug 文章 slug 可选，空字符串存为 NULL，避免多篇无 slug 的文章触发唯一约束
// normalizePostBackground 把文章背景收敛到「前端背景层能直接吃」的范围：
// 模糊 0-40px、透明度 0-1，颜色与地址去空白，避免一条脏数据把文章糊成一片。
func normalizePostBackground(background dto.PostBackgroundDto) dto.PostBackgroundDto {
	return dto.PostBackgroundDto{
		Image:     strings.TrimSpace(background.Image),
		Blur:      math.Min(40, math.Max(0, background.Blur)),
		Opacity:   math.Min(1, math.Max(0, background.Opacity)),
		Veil:      math.Min(1, math.Max(0, background.Veil)),
		VeilColor: strings.TrimSpace(background.VeilColor),
	}
}

func normalizePostSlug(slug *string) (*string, *errs.ServiceError) {
	if slug == nil {
		return nil, nil
	}
	normalized, svcerr := normalizeSlug(*slug)
	if svcerr != nil || normalized == "" {
		return nil, svcerr
	}
	return &normalized, nil
}

// normalizeCategoryID 前端用 0 表示未分类；分类不存在时返回错误
func normalizeCategoryID(categoryID *uint) (*uint, *errs.ServiceError) {
	if categoryID == nil || *categoryID == 0 {
		return nil, nil
	}
	var count int64
	if err := repo.GetDB().Model(&model.Category{}).Where("id = ?", *categoryID).Count(&count).Error; err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	if count == 0 {
		return nil, errs.NewBadRequest("category_not_found")
	}
	return categoryID, nil
}

func (p *PostService) DeletePost(ctx context.Context, postId uint) *errs.ServiceError {
	if postId == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	post, err := repo.Post.GetPostByID(postId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errs.NewNotFound("target_not_found").WithResource("post")
		}
		return errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	notified, err := repo.Post.DeletePost(postId)
	if err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("post")
	}
	DeletePendingPostViewDelta(postId)
	// 文章上的通知随文章一起删除：唤醒这些收件人的实时连接，未读徽标随之更新
	notifyNotificationUsers(notified)
	if err := repo.Revision.DeleteByTarget(constant.TargetTypePost, postId); err != nil {
		logrus.Warnf("delete revisions of post %d failed: %v", postId, err)
	}
	SyncSearchPost(postId, post.UserID, true)
	return nil
}

// withPendingPostView 叠加尚未落库的阅读量增量；返回浅拷贝以避免并发修改缓存/singleflight 共享对象
func withPendingPostView(d *dto.PostDto) *dto.PostDto {
	if d == nil {
		return nil
	}
	delta := PendingPostViewDelta(d.ID)
	if delta == 0 {
		return d
	}
	cp := *d
	cp.ViewCount += delta
	return &cp
}

func withPendingPostViews(items []*dto.PostDto) []*dto.PostDto {
	if len(items) == 0 {
		return items
	}
	ids := make([]uint, 0, len(items))
	for _, item := range items {
		if item != nil {
			ids = append(ids, item.ID)
		}
	}
	deltas := PendingPostViewDeltas(ids)
	if len(deltas) == 0 {
		return items
	}
	out := make([]*dto.PostDto, len(items))
	for i, item := range items {
		if item == nil {
			continue
		}
		if delta := deltas[item.ID]; delta > 0 {
			cp := *item
			cp.ViewCount += delta
			out[i] = &cp
		} else {
			out[i] = item
		}
	}
	return out
}

func withPendingPostCardViews(cards []dto.PostCardDto) []dto.PostCardDto {
	if len(cards) == 0 {
		return cards
	}
	ids := make([]uint, 0, len(cards))
	for i := range cards {
		ids = append(ids, cards[i].ID)
	}
	deltas := PendingPostViewDeltas(ids)
	if len(deltas) == 0 {
		return cards
	}
	out := slices.Clone(cards)
	for i := range out {
		out[i].ViewCount += deltas[out[i].ID]
	}
	return out
}

// GetPostSlugOrId 前台读取文章：只返回公开文章的已发布内容，不带草稿。
// 私密文章只在后台可见，对所有人（含作者与管理员）都当作不存在；作者在后台预览里看（见 GetPostForEdit）
func (p *PostService) GetPostSlugOrId(ctx context.Context, slugOrId string) (*dto.PostDto, *errs.ServiceError) {
	if slugOrId == "" {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	// 先读短时缓存（缓存里不存草稿）：返回内容对所有人一致，登录用户与访客共用；返回前叠加尚未刷库的阅读量增量
	d, svcerr := publicCached("detail:"+slugOrId, func() (*dto.PostDto, *errs.ServiceError) {
		return p.getPublicPost(slugOrId)
	})
	if svcerr != nil {
		return nil, svcerr
	}
	return withPendingPostView(d), nil
}

// getPublicPost 不看当前用户是谁：is_liked 恒为 false，登录用户的点赞状态由浏览器另取（GET /like/status）
func (p *PostService) getPublicPost(slugOrId string) (*dto.PostDto, *errs.ServiceError) {
	post, err := repo.Post.GetPostBySlugOrID(slugOrId)
	if err != nil || !post.IsPublic() {
		return nil, errs.NewNotFound("target_not_found").WithResource("post")
	}
	postDto := post.ToDto()
	postDto.DraftContent = nil
	postDto.DraftVersion = 0
	postDto.HasDraft = false
	return postDto, nil
}

// GetRandomPost 随机读取一篇公开已发布文章（含作者、分类、标签、协作者完整关联，不带草稿；空库或仅私密/草稿时返回 404）
func (p *PostService) GetRandomPost(ctx context.Context) (*dto.PostDto, *errs.ServiceError) {
	post, err := repo.Post.GetRandomPublicPost()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("post")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	postDto := post.ToDto()
	postDto.DraftContent = nil
	postDto.DraftVersion = 0
	postDto.HasDraft = false
	postDto.ViewCount += PendingPostViewDelta(postDto.ID)
	return postDto, nil
}

// GetPublicPostStats 公开文章的浏览量、点赞数、评论数（不看当前用户是谁，不缓存）：
// 前台文章页按 ISR 缓存，里面的计数是生成页面时的快照，浏览器进入文章页后用它补上最新值；私密文章与不存在的文章 404
func (p *PostService) GetPublicPostStats(id uint) (*dto.PostStatsDto, *errs.ServiceError) {
	if id == 0 {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	stats, err := repo.Post.GetPublicPostStats(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("post")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	stats.ViewCount += PendingPostViewDelta(id)
	return stats, nil
}

// GetPostNeighbors 获取公开文章的上下篇与相关推荐（走 PostGuestCache 短时缓存，文章或可见性变更时自动作废）
func (p *PostService) GetPostNeighbors(id uint) (*dto.PostNeighborsResp, *errs.ServiceError) {
	if id == 0 {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	return publicCached("neighbors:"+strconv.FormatUint(uint64(id), 10), func() (*dto.PostNeighborsResp, *errs.ServiceError) {
		resp, err := repo.Post.GetPostNeighbors(id, 4)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errs.NewNotFound("target_not_found").WithResource("post")
			}
			return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
		}
		return resp, nil
	})
}

// GetPostForEdit 后台编辑器与预览读取文章：含私密文章与草稿（没有草稿时取已发布的正文），
// 要求当前角色为编辑及以上（与路由一致，MCP 等不经过路由中间件的调用方同样受限，被降级为普通用户的原作者读不到），且为作者本人或管理员
func (p *PostService) GetPostForEdit(ctx context.Context, slugOrId string) (*dto.PostDto, *errs.ServiceError) {
	if slugOrId == "" {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	if !currentUser.GreaterThanEditor() {
		return nil, errs.NewForbidden("permission_denied")
	}
	post, err := repo.Post.GetPostBySlugOrID(slugOrId)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("post")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	postDto := post.ToDto()
	if postDto.DraftContent == nil {
		postDto.DraftContent = &postDto.Content
	}
	postDto.ViewCount += PendingPostViewDelta(postDto.ID)
	return postDto, nil
}

func (p *PostService) UpdatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (*dto.ContentSaveResult, *errs.ServiceError) {
	post, err := repo.Post.GetPostByID(req.ID)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("post")
	}

	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, post.UserID)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	// 保存正文时校验编辑会话与草稿版本号，见 checkContentWrite
	contentWrite := req.Content != "" || req.DraftContent != nil
	baseVersion := post.DraftVersion
	if contentWrite {
		if svcerr := checkContentWrite(ctx, constant.TargetTypePost, post.ID, req.EditSessionID, req.BaseDraftVersion, baseVersion); svcerr != nil {
			return nil, svcerr
		}
	}
	wasPublic := post.IsPublic()
	// 只写入本次请求改动的列：post 是请求开始时读到的快照，整行写回会覆盖期间他人写入的正文、草稿与计数
	var columns []string
	if req.Title != "" {
		post.Title = req.Title
		columns = append(columns, "title")
	}
	if req.Type != "" {
		post.Type = req.Type
		columns = append(columns, "type")
	}
	if req.Content != "" {
		post.Content = req.Content
		columns = append(columns, "content")
		if post.IsDraft {
			post.IsDraft = false
			columns = append(columns, "is_draft")
		}
	}
	if req.Cover != nil {
		post.Cover = *req.Cover
		columns = append(columns, "cover")
	}
	// 背景整段覆盖：传了就按传入值重写（空对象即清空，回到全站背景）
	if req.Background != nil {
		background := normalizePostBackground(*req.Background)
		post.BackgroundImage = background.Image
		post.BackgroundBlur = background.Blur
		post.BackgroundOpacity = background.Opacity
		post.BackgroundVeil = background.Veil
		post.BackgroundVeilColor = background.VeilColor
		columns = append(columns, "background_image", "background_blur", "background_opacity", "background_veil", "background_veil_color")
	}
	if req.ContentTheme != nil {
		post.ContentTheme = config.NormalizeContentTheme(*req.ContentTheme)
		columns = append(columns, "content_theme")
	}
	if req.Description != nil {
		post.Description = *req.Description
		columns = append(columns, "description")
	}
	if req.DraftContent != nil && *req.DraftContent != "" {
		post.DraftContent = req.DraftContent
		columns = append(columns, "draft_content")
	}
	// 传了 slug 才更新，空字符串表示清除 slug
	if req.Slug != nil {
		slug, svcerr := normalizePostSlug(req.Slug)
		if svcerr != nil {
			return nil, svcerr
		}
		post.Slug = slug
		columns = append(columns, "slug")
	}
	// 传了 category_id 才更新，0 表示取消分类
	if req.CategoryID != nil {
		categoryID, svcerr := normalizeCategoryID(req.CategoryID)
		if svcerr != nil {
			return nil, svcerr
		}
		post.CategoryID = categoryID
		post.Category = nil
		columns = append(columns, "category_id")
	}
	if req.IsPrivate != nil {
		post.IsPrivate = *req.IsPrivate
		columns = append(columns, "is_private")
	}

	// 只有传了 label_ids 才更新标签（传空数组表示清空），只保存草稿时保持原标签
	replaceLabels := req.LabelIds != nil
	if replaceLabels {
		// 跳过不存在的标签
		labels, err := repo.Label.GetLabelsByIDs(req.LabelIds)
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("label")
		}
		post.Labels = labels
	}
	// 写入正文时草稿版本号加一；读取之后有其他写入则拒绝，不覆盖对方的修改
	if contentWrite {
		err = repo.Post.SavePostWithDraftVersion(post, baseVersion, columns, replaceLabels)
	} else {
		err = repo.Post.SavePost(post, columns, replaceLabels)
	}
	if err != nil {
		if errors.Is(err, repo.ErrDraftVersionConflict) {
			return nil, errs.NewConflict("draft_conflict")
		}
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, errs.AlreadyExists("post", "slug", utils.Deref(post.Slug))
		}
		return nil, errs.Internal("failed_to_update_target", err).WithResource("post")
	}
	// 发布或保存草稿后记录版本历史
	if req.Content != "" || req.DraftContent != nil {
		NewRevisionService().RecordAfterSave(ctx, constant.TargetTypePost, post.ID, req.Content != "", req.EditSessionID)
	}
	// 通知打开了编辑页的客户端：编辑页据此合并他人（外部 AI 工具）的修改
	publishSavedEvent(ctx, constant.TargetTypePost, post.ID, post.DraftVersion)
	// 未公开（草稿或私密）→ 公开已发布：首次发布时曝光给感兴趣的 AI 用户（同一篇只曝光一次，由调度器去重）
	if !wasPublic && post.IsPublic() {
		NotifyPostPublished(post.ID)
	}
	if replaceLabels || slices.ContainsFunc(columns, func(col string) bool { return col != "draft_content" && col != "has_draft" }) {
		SyncSearchPost(post.ID, post.UserID, wasPublic != post.IsPublic() || slices.Contains(columns, "title"))
	}
	return &dto.ContentSaveResult{ID: post.ID, DraftVersion: post.DraftVersion}, nil
}

// ListPosts 前台文章列表（首页、标签、分类、归档、搜索、用户主页）：只含公开文章，不看当前用户是谁
func (p *PostService) ListPosts(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, *errs.ServiceError) {
	page, svcerr := publicCached(postListCacheKey(req), func() (guestPostList, *errs.ServiceError) {
		posts, total, svcerr := p.listPosts(ctx, req, false)
		return guestPostList{Posts: posts, Total: total}, svcerr
	})
	if svcerr != nil {
		return nil, 0, svcerr
	}
	return withPendingPostViews(page.Posts), page.Total, nil
}

// ListPostsAdmin 后台管理列出所有文章（包含所有用户的私密文章），仅管理员可用
func (p *PostService) ListPostsAdmin(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, 0, errs.NewForbidden("permission_denied")
	}
	posts, total, svcerr := p.listPosts(ctx, req, true)
	if svcerr != nil {
		return nil, total, svcerr
	}
	return withPendingPostViews(posts), total, nil
}

// ListMyPosts 后台「我的文章」：当前用户自己的全部文章（含私密文章），供没有管理员权限的作者管理自己的文章；
// 要求当前角色为编辑及以上（与路由一致），被降级为普通用户后只能在前台看到自己的公开文章
func (p *PostService) ListMyPosts(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, 0, errs.NewUnauthorized("login_required")
	}
	if !currentUser.GreaterThanEditor() {
		return nil, 0, errs.NewForbidden("permission_denied")
	}
	req.UserID = currentUser.ID
	posts, total, svcerr := p.listPosts(ctx, req, true)
	if svcerr != nil {
		return nil, total, svcerr
	}
	return withPendingPostViews(posts), total, nil
}

// listPosts includePrivate 为 true 时是后台管理视图（含私密文章、带 AI 摘要任务状态）
func (p *PostService) listPosts(ctx context.Context, req *dto.ListPostReq, includePrivate bool) ([]*dto.PostDto, int64, *errs.ServiceError) {
	if !includePrivate && strings.TrimSpace(req.Query) != "" {
		if dtos, total, ok := searchPublicPostsMeili(ctx, req); ok {
			return dtos, total, nil
		}
	}
	postDtos := make([]*dto.PostDto, 0)
	queryArray := make([]string, 0)
	if req.Query != "" {
		for _, q := range strings.Split(req.Query, ",") {
			queryArray = append(queryArray, strings.TrimSpace(q))
		}
	}
	posts, total, err := repo.Post.ListPostsContext(ctx, includePrivate, queryArray, req)
	if err != nil {
		return nil, total, errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	for _, post := range posts {
		dtoPost := post.ToDtoWithShortContent(200)
		if includePrivate {
			dtoPost.HasDraft = post.HasDraft
		}
		postDtos = append(postDtos, dtoPost)
	}
	// 后台管理列表展示 AI 摘要任务的进行中 / 失败状态；前台列表对所有人一致，不带
	if includePrivate {
		NewAISummaryService().FillListStatus(postDtos)
	}
	return postDtos, total, nil
}

const maxBatchItemIDs = 100

func normalizeBatchIDs(ids []uint) ([]uint, *errs.ServiceError) {
	if len(ids) == 0 || len(ids) > maxBatchItemIDs {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	unique := make([]uint, 0, len(ids))
	seen := make(map[uint]struct{}, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, errs.NewBadRequest("invalid_request_parameters")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique, nil
}

// BatchDeletePosts 批量删除文章：先统一校验权限（任意一篇无权则整批拒绝），再逐篇执行级联清理
func (p *PostService) BatchDeletePosts(ctx context.Context, ids []uint) (int, *errs.ServiceError) {
	unique, svcerr := normalizeBatchIDs(ids)
	if svcerr != nil {
		return 0, svcerr
	}
	existing := make([]uint, 0, len(unique))
	for _, id := range unique {
		meta, err := repo.Post.GetPostMeta(id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return 0, errs.Internal("failed_to_get_target", err).WithResource("post")
		}
		if !(ctxutils.IsOwnerOfTarget(ctx, meta.UserID) || ctxutils.IsAdmin(ctx)) {
			return 0, errs.NewForbidden("permission_denied")
		}
		existing = append(existing, id)
	}
	deleted := 0
	for _, id := range existing {
		if svcerr := p.DeletePost(ctx, id); svcerr != nil {
			if svcerr.Code == 404 {
				continue
			}
			return deleted, svcerr
		}
		deleted++
	}
	return deleted, nil
}

// BatchUpdateVisibility 批量设置文章私密/公开状态：尚未首次发布的草稿即使取消私密仍保持草稿状态，不会把空文章发到前台
func (p *PostService) BatchUpdateVisibility(ctx context.Context, ids []uint, isPrivate bool) (int, *errs.ServiceError) {
	unique, svcerr := normalizeBatchIDs(ids)
	if svcerr != nil {
		return 0, svcerr
	}
	existing := make([]uint, 0, len(unique))
	for _, id := range unique {
		meta, err := repo.Post.GetPostMeta(id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return 0, errs.Internal("failed_to_get_target", err).WithResource("post")
		}
		if !(ctxutils.IsOwnerOfTarget(ctx, meta.UserID) || ctxutils.IsAdmin(ctx)) {
			return 0, errs.NewForbidden("permission_denied")
		}
		existing = append(existing, id)
	}
	updated := 0
	for _, id := range existing {
		if _, svcerr := p.UpdatePost(ctx, &dto.CreateOrUpdatePostReq{ID: id, IsPrivate: &isPrivate}); svcerr != nil {
			if svcerr.Code == 404 {
				continue
			}
			return updated, svcerr
		}
		updated++
	}
	return updated, nil
}

// MaxPostCardIDs 一次批量查询的文章引用卡片数上限：一篇正文里的引用远少于这个数，超出说明请求异常
const MaxPostCardIDs = 50

// ListPostCards 批量读取正文「文章引用」卡片的数据：去重后保持请求顺序，
// 不存在 / 已删除 / 私密的文章不出现在结果里（不看当前用户是谁），由前端显示「内容不可访问」
func (p *PostService) ListPostCards(ctx context.Context, ids []uint) ([]dto.PostCardDto, *errs.ServiceError) {
	ids = normalizePostCardIDs(ids)
	if len(ids) == 0 {
		return []dto.PostCardDto{}, nil
	}
	cards, svcerr := publicCached(postCardCacheKey(ids), func() ([]dto.PostCardDto, *errs.ServiceError) {
		posts, err := repo.Post.ListPostCardsByIDs(ids)
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
		}
		cards := make([]dto.PostCardDto, 0, len(posts))
		byID := make(map[uint]dto.PostCardDto, len(posts))
		for i := range posts {
			byID[posts[i].ID] = posts[i].ToCardDto()
		}
		// 按请求顺序返回，避免卡片顺序跟随数据库返回顺序变动
		for _, id := range ids {
			if card, ok := byID[id]; ok {
				cards = append(cards, card)
			}
		}
		return cards, nil
	})
	if svcerr != nil {
		return nil, svcerr
	}
	return withPendingPostCardViews(cards), nil
}

// normalizePostCardIDs 去掉 0 与重复的 id，最多保留 MaxPostCardIDs 个，保持原有顺序
func normalizePostCardIDs(ids []uint) []uint {
	unique := make([]uint, 0, len(ids))
	seen := make(map[uint]struct{}, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
		if len(unique) >= MaxPostCardIDs {
			break
		}
	}
	return unique
}

// ListCategories 全部文章分类
func (p *PostService) ListCategories() ([]dto.CategoryDto, *errs.ServiceError) {
	categories, err := repo.Post.ListCategories()
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("category")
	}
	result := make([]dto.CategoryDto, 0, len(categories))
	for i := range categories {
		result = append(result, *categories[i].ToDto())
	}
	return result, nil
}
