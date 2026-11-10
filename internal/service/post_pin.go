package service

import (
	"context"
	"errors"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"gorm.io/gorm"
)

// 文章置顶：只在首页的默认列表生效（见 dto.ListPostReq.HomeListing），最多 MaxPinnedPosts 篇，后置顶的在前；
// 可以设到期时间，到期后查询时自动视为未置顶。只有管理员可以置顶或取消

// MaxPinnedPosts 首页最多同时置顶的文章数（前端 web/src/models/post.ts 的 PINNED_POSTS_LIMIT 与此一致）
const MaxPinnedPosts = 3

const postPinLockTTL = 10 * time.Second

// ListPinnedPosts 首页的置顶文章（只含公开文章，不看当前用户是谁），后置顶的在前
func (p *PostService) ListPinnedPosts(ctx context.Context) ([]*dto.PostDto, *errs.ServiceError) {
	return guestCached(ctx, "pinned", func() ([]*dto.PostDto, *errs.ServiceError) { return p.listPinnedPosts() })
}

func (p *PostService) listPinnedPosts() ([]*dto.PostDto, *errs.ServiceError) {
	posts, err := repo.Post.ListPinnedPosts(false, time.Now(), MaxPinnedPosts)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	dtos := make([]*dto.PostDto, 0, len(posts))
	for _, post := range posts {
		dtos = append(dtos, post.ToDtoWithShortContent(200))
	}
	return dtos, nil
}

// ListPinnedPostsAdmin 后台查看全部置顶文章（含私密文章），仅管理员可用
func (p *PostService) ListPinnedPostsAdmin(ctx context.Context) ([]*dto.PostDto, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	posts, err := repo.Post.ListPinnedPosts(true, time.Now(), MaxPinnedPosts)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	dtos := make([]*dto.PostDto, 0, len(posts))
	for _, post := range posts {
		dtos = append(dtos, post.ToDtoWithShortContent(200))
	}
	return dtos, nil
}

// SetPostPin 置顶到首页或取消置顶，仅管理员可用。已置顶的文章再次置顶时只修改到期时间，不改变先后顺序；
// 首页已有 MaxPinnedPosts 篇时拒绝，需要先取消一篇。多副本时用共享锁串行，避免同时置顶超出上限
func (p *PostService) SetPostPin(ctx context.Context, req *dto.SetPostPinReq) (*dto.PostDto, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	now := time.Now()
	if req.Pinned && req.PinnedUntil != nil && !req.PinnedUntil.After(now) {
		return nil, errs.NewBadRequest("pinned_until_in_past").WithField("pinned_until", req.PinnedUntil)
	}
	release, err := sharedstate.Lock(ctx, "post_pin", postPinLockTTL)
	if err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("post")
	}
	defer release()

	post, err := repo.Post.GetPostByID(req.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("post")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
	}
	var pinnedAt, pinnedUntil *time.Time
	if req.Pinned {
		count, err := repo.Post.CountPinnedPosts(now, post.ID)
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
		}
		if count >= MaxPinnedPosts {
			return nil, errs.NewConflict("pinned_posts_limit")
		}
		pinnedAt, pinnedUntil = &now, req.PinnedUntil
		if post.IsPinned(now) {
			pinnedAt = post.PinnedAt
		}
	}
	if err := repo.Post.SetPostPin(post.ID, pinnedAt, pinnedUntil); err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("post")
	}
	post.PinnedAt, post.PinnedUntil = pinnedAt, pinnedUntil
	return post.ToDtoWithShortContent(200), nil
}
