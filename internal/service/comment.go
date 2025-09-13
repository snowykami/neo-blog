package service

import (
  "context"
  "strconv"

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

func (cs *CommentService) CreateComment(ctx context.Context, req *dto.CreateCommentReq) (uint, error) {
  currentUser, ok := ctxutils.GetCurrentUser(ctx)
  if !ok {
    return 0, errs.ErrUnauthorized
  }

  if ok, err := cs.checkTargetExists(req.TargetID, req.TargetType); !ok {
    if err != nil {
      return 0, errs.New(errs.ErrBadRequest.Code, "target not found", err)
    }
    return 0, errs.ErrBadRequest
  }

  comment := &model.Comment{
    Content:        req.Content,
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
    return 0, err
  }

  return commentID, nil
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
  comment.IsPrivate = req.IsPrivate

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

  currentUserID := uint(0)
  if currentUser, ok := ctxutils.GetCurrentUser(ctx); ok {
    currentUserID = currentUser.ID
  }
  if comment.IsPrivate && currentUserID != comment.UserID {
    return nil, errs.ErrForbidden
  }
  isLiked := false
  if currentUserID != 0 {
    isLiked, _ = repo.Like.IsLiked(currentUserID, comment.ID, constant.TargetTypeComment)
  }
  ua := utils.ParseUA(comment.UserAgent)
  if !comment.ShowClientInfo {
    comment.Location = ""
    ua.OS = ""
    ua.OSVersion = ""
    ua.Browser = ""
    ua.BrowserVer = ""
  }

  commentDto := dto.CommentDto{
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
    Location:   comment.Location,
  }

  return &commentDto, err
}

func (cs *CommentService) GetCommentList(ctx context.Context, req *dto.GetCommentListReq) ([]dto.CommentDto, error) {
  currentUserID := uint(0)
  if currentUser, ok := ctxutils.GetCurrentUser(ctx); ok {
    currentUserID = currentUser.ID
  }
  comments, err := repo.Comment.ListComments(currentUserID, req.TargetID, req.CommentID, req.TargetType, req.Page, req.Size, req.OrderBy, req.Desc, req.Depth)
  if err != nil {
    return nil, errs.New(errs.ErrInternalServer.Code, "failed to list comments", err)
  }
  commentDtos := make([]dto.CommentDto, 0)
  for _, comment := range comments {
    //replyCount, _ := repo.Comment.CountReplyComments(currentUserID, comment.ID)
    isLiked := false
    if currentUserID != 0 {
      isLiked, _ = repo.Like.IsLiked(currentUserID, comment.ID, constant.TargetTypeComment)
    }
    ua := utils.ParseUA(comment.UserAgent)
    commentDto := dto.CommentDto{
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
      Location:   comment.Location,
    }
    if !comment.ShowClientInfo {
      commentDto.Location = ""
      commentDto.OS = ""
      commentDto.Browser = ""
    }
    commentDtos = append(commentDtos, commentDto)
  }
  return commentDtos, nil
}

func (cs *CommentService) checkTargetExists(targetID uint, targetType string) (bool, error) {
  switch targetType {
  case constant.TargetTypePost:
    if _, err := repo.Post.GetPostByID(strconv.Itoa(int(targetID))); err != nil {
      return false, errs.New(errs.ErrNotFound.Code, "post not found", err)
    }
  default:
    return false, errs.New(errs.ErrBadRequest.Code, "invalid target type", nil)
  }
  return true, nil
}
