package repo

import "github.com/snowykami/neo-blog/internal/model"

type CommentRepo struct {
}

var Comment = &CommentRepo{}

func (cr *CommentRepo) CreateComment(comment *model.Comment) error {
	// Implementation for creating a comment
	return nil
}

func (cr *CommentRepo) UpdateComment(comment *model.Comment) error {
	// Implementation for updating a comment
	return nil
}

func (cr *CommentRepo) DeleteComment(commentID string) error {
	// Implementation for deleting a comment
	return nil
}

func (cr *CommentRepo) GetComment(commentID string) (*model.Comment, error) {
	// Implementation for getting a comment by ID
	return nil, nil
}

func (cr *CommentRepo) ListComments(currentUserID uint, page, size uint, orderBy string, desc bool) ([]model.Comment, error) {
	// Implementation for listing comments for a post
	return nil, nil
}
