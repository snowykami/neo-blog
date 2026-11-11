package service

import (
	"context"
	"net/http"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

type LikeService struct{}

func NewLikeService() *LikeService {
	return &LikeService{}
}

// ToggleLike 切换点赞状态；desired 不为空时设置为该状态，已是该状态则不做改动
func (ls *LikeService) ToggleLike(ctx context.Context, targetID uint, targetType string, desired *bool) (bool, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return false, errs.NewUnauthorized("login_required")
	}
	// 只能给存在且自己看得到的目标点赞，避免产生孤儿点赞；顺带取出通知要用的快照
	var ownerID uint // 被点赞内容的作者
	var subjectType string
	var subjectID uint
	var subjectTitle, subjectSlug, quotedExcerpt string
	switch targetType {
	case constant.TargetTypePost:
		post, err := repo.Post.GetPostMeta(targetID)
		if err != nil || (post.IsPrivate && !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx))) {
			return false, errs.NewNotFound("operation_target_not_found")
		}
		full, err := repo.Post.GetPostByID(targetID)
		if err != nil {
			return false, errs.NewNotFound("operation_target_not_found")
		}
		ownerID = post.UserID
		subjectType, subjectID = constant.TargetTypePost, full.ID
		subjectTitle, subjectSlug = full.Title, derefString(full.Slug)
	case constant.TargetTypeComment:
		comment, svcerr := NewCommentService().GetComment(ctx, targetID)
		if svcerr != nil {
			return false, svcerr
		}
		ownerID = comment.User.ID
		// 被点赞的评论可能只是正文为空、只带附件的评论
		quotedExcerpt = comment.Content
		subjectType, subjectID = comment.TargetType, comment.TargetID
		if briefs, err := repo.Comment.ListTargetBriefs(comment.TargetType, []uint{comment.TargetID}); err == nil {
			if brief, ok := briefs[comment.TargetID]; ok {
				subjectTitle, subjectSlug = brief.Title, derefString(brief.Slug)
			}
		}
	default:
		return false, errs.NewBadRequest("invalid_target_type")
	}
	if desired != nil {
		current, err := repo.Like.IsLiked(currentUser.ID, targetID, targetType)
		if err != nil {
			return false, errs.Internal("failed_to_toggle_like", err)
		}
		if current == *desired {
			return current, nil
		}
	}
	owner, err := repo.User.GetUserByID(ownerID)
	if err != nil {
		return false, errs.FromDB(err, "user", "failed_to_get_target")
	}
	// 点赞与互动通知写在同一个事务里：点赞成功就必须有通知，取消点赞必须撤掉通知
	var state bool
	var notified uint // 事务提交后需要推送的收件人：点赞时是新通知的收件人，取消点赞时是被撤掉通知的收件人
	err = repo.GetDB().Transaction(func(tx *gorm.DB) error {
		var toggleErr error
		state, toggleErr = repo.Like.ToggleLike(currentUser.ID, targetID, targetType, tx)
		if toggleErr != nil {
			return toggleErr
		}
		notifications := NewNotificationService()
		if !state {
			if revokeErr := notifications.RevokeLike(ctx, tx, currentUser, owner, targetType, targetID); revokeErr != nil {
				logrus.Errorf("revoke like notification: %v", revokeErr)
			} else if owner.ID != currentUser.ID {
				// 撤掉的通知可能还未读：推送一次，作者的徽标与列表随之更新
				notified = owner.ID
			}
			return nil
		}
		// 通知是附属品，写失败不能让点赞失败（见 5.3）
		notifiedUserID, emitErr := notifications.Emit(ctx, tx, &NotificationEvent{
			Type:          likeNotificationType(targetType),
			Actor:         currentUser,
			Owner:         owner,
			TargetType:    targetType,
			TargetID:      targetID,
			SubjectType:   subjectType,
			SubjectID:     subjectID,
			SubjectTitle:  subjectTitle,
			SubjectSlug:   subjectSlug,
			QuotedExcerpt: quotedExcerpt,
			DedupeKey:     likeDedupeKey(targetType, targetID, currentUser.ID),
		})
		if emitErr != nil {
			logrus.Errorf("emit like notification: %v", emitErr)
		}
		notified = notifiedUserID
		return nil
	})
	if err != nil {
		return state, errs.Internal("failed_to_toggle_like", err)
	}
	// 事务提交后再唤醒前端的实时连接，回滚时不会亮起未读（也不会提前熄灭）
	if notified != 0 {
		NotificationHub.Notify(notified)
	}
	// 点赞记入访客记录时间线，取消点赞时一并撤销
	if state {
		NewVisitService().RecordInteraction(currentUser.ID, ownerID, constant.VisitActionLike, targetType, targetID, 0)
	} else {
		NewVisitService().RemoveInteraction(currentUser.ID, constant.VisitActionLike, targetType, targetID)
	}
	return state, nil
}

// IsLiked 当前用户是否点赞了目标；只回答自己的点赞状态，不涉及目标内容
func (ls *LikeService) IsLiked(ctx context.Context, targetID uint, targetType string) (bool, *errs.ServiceError) {
	currentUserID, ok := ctxutils.GetCurrentUserID(ctx)
	if !ok {
		return false, errs.NewUnauthorized("login_required")
	}
	if !(targetType == constant.TargetTypePost || targetType == constant.TargetTypeComment) {
		return false, errs.NewBadRequest("invalid_target_type")
	}
	liked, err := repo.Like.IsLiked(currentUserID, targetID, targetType)
	if err != nil {
		return false, errs.Internal("failed_to_get_target", err)
	}
	return liked, nil
}

// GetLikedUsers 最近点赞的用户（点赞头像墙）：可见性与 ToggleLike 一致，目标不可见（私密文章 / 私密评论 / 不存在）一律 404，
// 不区分「不存在」与「无权查看」；只返回头像墙需要的最小字段
func (ls *LikeService) GetLikedUsers(ctx context.Context, targetID uint, targetType string, limit int) ([]dto.UserAvatarDto, *errs.ServiceError) {
	if svcerr := checkLikeTargetVisible(ctx, targetID, targetType); svcerr != nil {
		return nil, svcerr
	}
	users, err := repo.Like.GetLikedUsers(targetID, targetType, limit)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	userDtos := make([]dto.UserAvatarDto, 0, len(users))
	for _, user := range users {
		userDtos = append(userDtos, user.ToAvatarDto())
	}
	return userDtos, nil
}

// checkLikeTargetVisible 点赞目标对当前用户是否可见：私密文章仅作者本人与管理员；
// 评论要求所在文章 / 页面可访问、私密评论对当前用户可见（见 CommentService.loadVisibleComment）。不可见时统一 404
func checkLikeTargetVisible(ctx context.Context, targetID uint, targetType string) *errs.ServiceError {
	switch targetType {
	case constant.TargetTypePost:
		post, err := repo.Post.GetPostMeta(targetID)
		if err != nil || (post.IsPrivate && !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx))) {
			return errs.NewNotFound("operation_target_not_found")
		}
	case constant.TargetTypeComment:
		if _, svcerr := NewCommentService().loadVisibleComment(ctx, targetID); svcerr != nil {
			if svcerr.Code == http.StatusForbidden || svcerr.Code == http.StatusNotFound {
				return errs.NewNotFound("operation_target_not_found")
			}
			return svcerr
		}
	default:
		return errs.NewBadRequest("invalid_target_type")
	}
	return nil
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

// likeNotificationType 点赞事件类型：文章点赞与评论点赞
func likeNotificationType(targetType string) string {
	if targetType == constant.TargetTypeComment {
		return constant.NotificationTypeCommentLiked
	}
	return constant.NotificationTypePostLiked
}

// likeDedupeKey 点赞事件的去重键
func likeDedupeKey(targetType string, targetID, actorID uint) string {
	if targetType == constant.TargetTypeComment {
		return dedupeKeyCommentLiked(targetID, actorID)
	}
	return dedupeKeyPostLiked(targetID, actorID)
}

// derefString 取可空字符串的值，nil 时为空串
func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
