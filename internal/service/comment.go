package service

import (
	"context"
	"github.com/snowykami/neo-blog/internal/dto"
)

type CommentService struct{}

func NewCommentService() *CommentService {
	return &CommentService{}
}

func (cs *CommentService) CreateComment(ctx context.Context, req *dto.CreateCommentReq) error {
	return nil
}

func (cs *CommentService) UpdateComment(ctx context.Context, req *dto.UpdateCommentReq) error {
	// Implementation for updating a comment
	return nil
}

func (cs *CommentService) DeleteComment(ctx context.Context, commentID string) error {
	// Implementation for deleting a comment
	return nil
}

func (cs *CommentService) GetComment(ctx context.Context, commentID string) (*dto.CommentDto, error) {
	// Implementation for getting a single comment
	return nil, nil
}

//func (cs *CommentService) GetCommentList(ctx context.Context, req *dto.GetCommentListReq) ([]dto.CommentDto, error) {
//	// Implementation for getting a list of comments
//	return nil, nil
//}
