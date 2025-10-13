package service

import (
	"context"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type CommentService struct{}

func NewCommentService() *CommentService {
	return &CommentService{}
}

func (cs *CommentService) CreateComment(ctx context.Context, req *dto.CreateCommentReq) (uint, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}

	if ok, err := cs.checkTargetExists(req.TargetID, req.TargetType); !ok {
		if err != nil {
			logrus.Errorf("CreateComment: checkTargetExists error: %s", err.Error())
			return 0, err
		}
		return 0, errs.NewNotFound("operation_target_not_found")
	}

	// 内容校验：去首尾空白，非空且字符数不超过 200
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return 0, errs.NewBadRequest("content_cannot_be_empty")
	}
	if len([]rune(content)) > 200 {
		return 0, errs.NewBadRequest("content_too_long")
	}

	comment := &model.Comment{
		Content:        content,
		ReplyID:        req.ReplyID,
		TargetID:       req.TargetID,
		TargetType:     req.TargetType,
		UserID:         currentUser.ID,
		IsPrivate:      req.IsPrivate,
		RemoteAddr:     req.RemoteAddr,
		UserAgent:      req.UserAgent,
		ShowClientInfo: req.ShowClientInfo,
	}
	commentID, err := repo.Comment.CreateComment(comment)

	if err != nil {
		logrus.Errorf("CreateComment: CreateComment error: %s", err.Error())
		return 0, errs.NewInternalServer("failed_to_create_target")
	}

	return commentID, nil
}

func (cs *CommentService) UpdateComment(ctx context.Context, req *dto.UpdateCommentReq) *errs.ServiceError {
	comment, err := repo.Comment.GetComment(req.ID)
	if err != nil {
		return errs.NewNotFound("operation_target_not_found")
	}

	// 仅管理员或评论主人可以修改评论
	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, comment.UserID)) {
		return errs.NewForbidden("forbidden")
	}

	// 内容校验：去首尾空白，非空且字符数不超过 200
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return errs.NewBadRequest("content_cannot_be_empty")
	}
	if len([]rune(content)) > 200 {
		return errs.NewBadRequest("content_too_long")
	}

	comment.Content = content
	comment.IsPrivate = req.IsPrivate
	comment.ShowClientInfo = req.ShowClientInfo
	err = repo.Comment.UpdateComment(comment)
	if err != nil {
		logrus.Errorf("UpdateComment error: %s", err.Error())
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

func (cs *CommentService) DeleteComment(ctx context.Context, commentID uint) *errs.ServiceError {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.NewUnauthorized("login_required")
	}
	if commentID == 0 {
		return errs.NewBadRequest("operation_target_not_found")
	}

	comment, err := repo.Comment.GetComment(commentID)
	if err != nil {
		return errs.NewNotFound("operation_target_not_found")
	}

	var targetOwnerId uint
	if comment.TargetType == constant.TargetTypePost {
		post, err := repo.Post.GetPostBySlugOrID(strconv.Itoa(int(comment.TargetID)))
		if err == nil && post.UserID == currentUser.ID {
			targetOwnerId = post.UserID
		}
	}

	// 仅管理员，目标对象主人，评论主人可以删评
	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, targetOwnerId) || ctxutils.IsOwnerOfTarget(ctx, comment.UserID)) {
		return errs.NewForbidden("permission_denied")
	}

	if err := repo.Comment.DeleteComment(commentID); err != nil {
		logrus.Errorf("DeleteComment error: %s", err.Error())
		return errs.NewInternalServer("failed_to_delete_target")
	}
	return nil
}

func (cs *CommentService) GetComment(ctx context.Context, commentID uint) (*dto.CommentDto, *errs.ServiceError) {
	comment, err := repo.Comment.GetComment(commentID)
	if err != nil {
		return nil, errs.NewNotFound("operation_target_not_found")
	}
	currentUserID := uint(0)
	if currentUser, ok := ctxutils.GetCurrentUser(ctx); ok {
		currentUserID = currentUser.ID
	}
	// 私密评论可见性：评论作者、文章作者（若目标为文章）、管理员可见
	if comment.IsPrivate {
		if ctxutils.IsAdmin(ctx) {
			// 管理员可见
		} else if currentUserID == comment.UserID {
			// 评论作者可见
		} else if comment.TargetType == constant.TargetTypePost {
			post, err := repo.Post.GetPostBySlugOrID(strconv.Itoa(int(comment.TargetID)))
			if err != nil {
				logrus.Errorf("GetComment: GetPostBySlugOrID error: %s", err.Error())
				return nil, errs.NewInternalServer("failed_to_get_target")
			}
			if post.UserID != currentUserID {
				return nil, errs.NewForbidden("permission_denied")
			}
		} else {
			return nil, errs.NewForbidden("permission_denied")
		}
	}
	commentDto := cs.toGetCommentDto(comment, currentUserID)
	return &commentDto, nil
}

func (cs *CommentService) GetCommentList(ctx context.Context, req *dto.GetCommentListReq) ([]dto.CommentDto, *errs.ServiceError) {
	currentUserID := uint(0)
	if currentUser, ok := ctxutils.GetCurrentUser(ctx); ok {
		currentUserID = currentUser.ID
	}
	comments, err := repo.Comment.ListComments(currentUserID, req.TargetID, req.CommentID, req.TargetType, req.Page, req.Size, req.OrderBy, req.Desc, req.Depth)
	if err != nil {
		logrus.Errorf("GetCommentList: ListComments error: %s", err.Error())
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	commentDtos := make([]dto.CommentDto, 0)
	for _, comment := range comments {
		commentDto := cs.toGetCommentDto(&comment, currentUserID)
		commentDtos = append(commentDtos, commentDto)
	}
	return commentDtos, nil
}

func (cs *CommentService) toGetCommentDto(comment *model.Comment, currentUserID uint) dto.CommentDto {
	isLiked := false
	if currentUserID != 0 {
		isLiked, _ = repo.Like.IsLiked(currentUserID, comment.ID, constant.TargetTypeComment)
	}
	ua := utils.ParseUA(comment.UserAgent)
	if !comment.ShowClientInfo {
		comment.CommentLocation = model.CommentLocation{}
		ua.OS = ""
		ua.OSVersion = ""
		ua.Browser = ""
		ua.BrowserVer = ""
	}

	return dto.CommentDto{
		ID:         comment.ID,
		Content:    comment.Content,
		TargetID:   comment.TargetID,
		TargetType: comment.TargetType,
		ReplyID:    comment.ReplyID,
		CreatedAt:  comment.CreatedAt.String(),
		UpdatedAt:  comment.UpdatedAt.String(),
		Depth:      comment.Depth,
		User:       comment.User.ToDto(),
		ReplyCount: comment.CommentCount,
		LikeCount:  comment.LikeCount,
		IsLiked:    isLiked,
		IsPrivate:  comment.IsPrivate,
		OS:         ua.OS + " " + ua.OSVersion,
		Browser:    ua.Browser + " " + ua.BrowserVer,
		Location: dto.CommentLocationDto{
			Country:   comment.Country,
			Province:  comment.Province,
			City:      comment.City,
			Districts: comment.Districts,
			ISP:       comment.ISP,
			IDC:       comment.IDC,
		},
		ShowClientInfo: comment.ShowClientInfo,
	}
}
func (cs *CommentService) checkTargetExists(targetID uint, targetType string) (bool, *errs.ServiceError) {
	switch targetType {
	case constant.TargetTypePost:
		if _, err := repo.Post.GetPostBySlugOrID(strconv.Itoa(int(targetID))); err != nil {
			return false, errs.NewNotFound("operation_target_not_found")
		}
	default:
		return false, errs.NewBadRequest("invalid_target_type")
	}
	return true, nil
}
