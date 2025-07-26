package service

import (
	"context"
	"strconv"

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

func (cs *CommentService) CreateComment(ctx context.Context, req *dto.CreateCommentReq) error {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.ErrUnauthorized
	}

	comment := &model.Comment{
		Content:    req.Content,
		ReplyID:    req.ReplyID,
		TargetID:   req.TargetID,
		TargetType: req.TargetType,
		UserID:     currentUser.ID,
		IsPrivate:  req.IsPrivate,
	}
	
	err := repo.Comment.CreateComment(comment)

	if err != nil {
		return err
	}

	return nil
}

func (cs *CommentService) UpdateComment(ctx context.Context, req *dto.UpdateCommentReq) error {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.ErrUnauthorized
	}

	comment, err := repo.Comment.GetComment(strconv.Itoa(int(req.CommentID)))
	if err != nil {
		return err
	}

	if currentUser.ID != comment.UserID {
		return errs.ErrForbidden
	}

	comment.Content = req.Content

	err = repo.Comment.UpdateComment(comment)

	if err != nil {
		return err
	}
	
	return nil
}

func (cs *CommentService) DeleteComment(ctx context.Context, commentID string) error {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.ErrUnauthorized
	}
	if commentID == "" {
		return errs.ErrBadRequest
	}

	comment, err := repo.Comment.GetComment(commentID)
	if err != nil {
		return errs.New(errs.ErrNotFound.Code, "comment not found", err)
	}

	if comment.UserID != currentUser.ID {
		return errs.ErrForbidden
	}

	if err := repo.Comment.DeleteComment(commentID); err != nil {
		return err
	}

	return nil
}

func (cs *CommentService) GetComment(ctx context.Context, commentID string) (*dto.CommentDto, error) {
	comment, err := repo.Comment.GetComment(commentID)

	if err != nil {
		return nil, errs.New(errs.ErrNotFound.Code, "comment not found", err)
	}

	commentDto := dto.CommentDto{
		ID: comment.ID,
		TargetID: comment.TargetID,
		TargetType: comment.TargetType,
		Content: comment.Content,
		ReplyID: comment.ReplyID,
		Depth: comment.Depth,
		CreatedAt: comment.CreatedAt.String(),
		UpdatedAt: comment.UpdatedAt.String(),
		User: *comment.User.ToDto(),
	}

	return &commentDto, err
}

func (cs *CommentService) GetCommentList(ctx context.Context, req *dto.GetCommentListReq) ([]dto.CommentDto, error) {
	currentUser, _ := ctxutils.GetCurrentUser(ctx)

	comments, err := repo.Comment.ListComments(currentUser.ID, req.TargetID, req.TargetType, req.Page, req.Size, req.OrderBy, req.Desc)
	if err != nil {
		return nil, errs.New(errs.ErrInternalServer.Code, "failed to list comments", err)
	}

	commentDtos := make([]dto.CommentDto, 0)

	for _, comment := range comments {
		commentDto := dto.CommentDto{
			ID:         comment.ID,
			Content:    comment.Content,
			TargetID:   comment.TargetID,
			TargetType: comment.TargetType,
			CreatedAt:  comment.CreatedAt.String(),
			UpdatedAt:  comment.UpdatedAt.String(),
			Depth:       comment.Depth,
			User:       *comment.User.ToDto(),
		}
		commentDtos = append(commentDtos, commentDto)
	}
	return commentDtos, nil
}
