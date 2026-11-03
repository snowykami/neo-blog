package service

import (
	"context"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type LikeService struct{}

func NewLikeService() *LikeService {
	return &LikeService{}
}

func (ls *LikeService) ToggleLike(ctx context.Context, targetID uint, targetType string) (bool, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return false, errs.NewUnauthorized("login_required")
	}
	// 只能给存在且自己看得到的目标点赞，避免产生孤儿点赞
	var ownerID uint // 被点赞内容的作者，用于记录互动
	switch targetType {
	case constant.TargetTypePost:
		post, err := repo.Post.GetPostMeta(targetID)
		if err != nil || (post.IsPrivate && !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx))) {
			return false, errs.NewNotFound("operation_target_not_found")
		}
		ownerID = post.UserID
	case constant.TargetTypeComment:
		comment, svcerr := NewCommentService().GetComment(ctx, targetID)
		if svcerr != nil {
			return false, svcerr
		}
		ownerID = comment.User.ID
	default:
		return false, errs.NewBadRequest("invalid_target_type")
	}
	state, err := repo.Like.ToggleLike(currentUser.ID, targetID, targetType)
	if err != nil {
		return state, errs.Internal("failed_to_toggle_like", err)
	}
	// 点赞记入访客记录时间线，取消点赞时一并撤销
	if state {
		NewVisitService().RecordInteraction(currentUser.ID, ownerID, constant.VisitActionLike, targetType, targetID, 0)
	} else {
		NewVisitService().RemoveInteraction(currentUser.ID, constant.VisitActionLike, targetType, targetID)
	}
	return state, nil
}

func (ls *LikeService) GetLikedUsers(ctx context.Context, targetID uint, targetType string, limit int) ([]dto.UserDto, *errs.ServiceError) {
	users, err := repo.Like.GetLikedUsers(targetID, targetType, limit)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	var userDtos []dto.UserDto
	for _, user := range users {
		userDtos = append(userDtos, user.ToDto())
	}
	return userDtos, nil
}

// ListUserLikes 用户主页的点赞列表：点赞记录涉及个人偏好，默认仅本人与管理员可见；
// 用户开启「公开我的喜欢」后，其他人可以看到公开内容上的点赞
func (ls *LikeService) ListUserLikes(ctx context.Context, req *dto.ListUserLikesReq) ([]dto.UserLikeDto, int64, *errs.ServiceError) {
	isAdmin, isSelf := ctxutils.IsAdmin(ctx), ctxutils.IsOwnerOfTarget(ctx, req.UserID)
	if !(isAdmin || isSelf) {
		user, err := repo.User.GetUserByID(req.UserID)
		if err != nil {
			return nil, 0, errs.FromDB(err, "user", "failed_to_get_target")
		}
		if !(user.ShowLikes != nil && *user.ShowLikes) {
			return nil, 0, errs.NewForbidden("permission_denied")
		}
	}
	likes, total, err := repo.Like.ListLikesByUser(req.UserID, isAdmin, isSelf, req.Page, req.Size)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("like")
	}

	// 按目标类型分组，批量读取文章、评论及评论所在的文章/页面
	var postIDs, commentIDs []uint
	for _, like := range likes {
		switch like.TargetType {
		case constant.TargetTypePost:
			postIDs = append(postIDs, like.TargetID)
		case constant.TargetTypeComment:
			commentIDs = append(commentIDs, like.TargetID)
		}
	}
	posts, err := repo.Like.ListLikedPosts(postIDs)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("like")
	}
	comments, err := repo.Like.ListLikedComments(commentIDs)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("like")
	}
	idsByType := map[string][]uint{}
	for _, comment := range comments {
		idsByType[comment.TargetType] = append(idsByType[comment.TargetType], comment.TargetID)
	}
	briefsByType := map[string]map[uint]repo.CommentTargetBrief{}
	for targetType, ids := range idsByType {
		briefs, err := repo.Comment.ListTargetBriefs(targetType, ids)
		if err != nil {
			return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("like")
		}
		briefsByType[targetType] = briefs
	}

	result := make([]dto.UserLikeDto, 0, len(likes))
	for _, like := range likes {
		item := dto.UserLikeDto{
			ID:         like.ID,
			TargetType: like.TargetType,
			TargetID:   like.TargetID,
			CreatedAt:  like.CreatedAt,
		}
		// 查询期间目标被删除时跳过该条，避免返回残缺数据
		switch like.TargetType {
		case constant.TargetTypePost:
			post, ok := posts[like.TargetID]
			if !ok {
				continue
			}
			item.Author = post.User.ToDto()
			item.Target = dto.CommentTargetDto{ID: post.ID, Type: constant.TargetTypePost, Title: post.Title, Slug: post.Slug}
		case constant.TargetTypeComment:
			comment, ok := comments[like.TargetID]
			if !ok {
				continue
			}
			brief, ok := briefsByType[comment.TargetType][comment.TargetID]
			if !ok {
				continue
			}
			item.Author = comment.User.ToDto()
			item.Content = comment.Content
			item.Target = dto.CommentTargetDto{ID: brief.ID, Type: comment.TargetType, Title: brief.Title, Slug: brief.Slug}
		default:
			continue
		}
		result = append(result, item)
	}
	return result, total, nil
}
