package service

import (
	"context"
	"errors"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/ipregion"
	"github.com/snowykami/neo-blog/pkg/utils"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
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

	target, svcerr := cs.getTarget(req.TargetID, req.TargetType)
	if svcerr != nil {
		return 0, svcerr
	}
	if !target.canAccess(ctx) {
		return 0, errs.NewNotFound("operation_target_not_found")
	}
	// 被评论内容的作者，用于记录互动：回复时为被回复评论的作者，否则为文章/页面作者
	ownerID := target.ownerID
	// 只能回复自己看得到的评论，防止通过回复加入私密评论树
	if req.ReplyID != 0 {
		parent, err := repo.Comment.GetComment(req.ReplyID)
		if err != nil {
			return 0, errs.NewNotFound("operation_target_not_found")
		}
		visible, svcerr := cs.canViewComment(ctx, parent, target)
		if svcerr != nil {
			return 0, svcerr
		}
		if !visible {
			return 0, errs.NewNotFound("operation_target_not_found")
		}
		ownerID = parent.UserID
	}

	// 内容校验：去首尾空白，非空且字符数不超过 200
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return 0, errs.NewBadRequest("content_cannot_be_empty")
	}
	if len([]rune(content)) > 200 {
		return 0, errs.NewBadRequest("content_too_long")
	}

	// 评论归属地使用离线库在事务外解析，不再在写库事务里请求第三方接口
	region := ipregion.Lookup(req.RemoteAddr)
	comment := &model.Comment{
		CommentLocation: model.CommentLocation{
			Country:  region.Country,
			Province: region.Province,
			City:     region.City,
			ISP:      region.ISP,
		},
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
	commentID, err := repo.Comment.CreateComment(comment, tools.GetMaximumReplyDepth())

	if err != nil {
		// 回复深度超限、目标不一致等校验错误原样返回
		var svcErr *errs.ServiceError
		if errors.As(err, &svcErr) {
			return 0, svcErr
		}
		logrus.Errorf("CreateComment: CreateComment error: %s", err.Error())
		return 0, errs.NewInternalServer("failed_to_create_target")
	}

	// 评论记入访客记录时间线：回复记在被回复的评论上，否则记在文章/页面上
	if req.ReplyID != 0 {
		NewVisitService().RecordInteraction(currentUser.ID, ownerID, constant.VisitActionComment, constant.TargetTypeComment, req.ReplyID, commentID)
	} else {
		NewVisitService().RecordInteraction(currentUser.ID, ownerID, constant.VisitActionComment, req.TargetType, req.TargetID, commentID)
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
	_, ok := ctxutils.GetCurrentUser(ctx)
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

	// 目标已不存在时只有管理员和评论主人可以删除
	var targetOwnerID uint
	if target, svcerr := cs.getTarget(comment.TargetID, comment.TargetType); svcerr == nil {
		targetOwnerID = target.ownerID
	}

	// 仅管理员，目标对象主人，评论主人可以删评
	if !(ctxutils.IsAdmin(ctx) || (targetOwnerID != 0 && ctxutils.IsOwnerOfTarget(ctx, targetOwnerID)) || ctxutils.IsOwnerOfTarget(ctx, comment.UserID)) {
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
	target, svcerr := cs.getTarget(comment.TargetID, comment.TargetType)
	if svcerr != nil {
		return nil, svcerr
	}
	if !target.canAccess(ctx) {
		return nil, errs.NewNotFound("operation_target_not_found")
	}
	// 私密评论可见性：管理员、目标作者、评论作者以及参与过该评论树的用户可见
	visible, svcerr := cs.canViewComment(ctx, comment, target)
	if svcerr != nil {
		return nil, svcerr
	}
	if !visible {
		return nil, errs.NewForbidden("permission_denied")
	}
	commentDtos := cs.toGetCommentDtos([]model.Comment{*comment}, currentUserID)
	return &commentDtos[0], nil
}

func (cs *CommentService) GetCommentList(ctx context.Context, req *dto.GetCommentListReq) ([]dto.CommentDto, *errs.ServiceError) {
	currentUserID := uint(0)
	if currentUser, ok := ctxutils.GetCurrentUser(ctx); ok {
		currentUserID = currentUser.ID
	}
	target, svcerr := cs.getTarget(req.TargetID, req.TargetType)
	if svcerr != nil {
		return nil, svcerr
	}
	// 私密文章、页面的评论只有作者和管理员能看到
	if !target.canAccess(ctx) {
		return nil, errs.NewNotFound("operation_target_not_found")
	}
	comments, err := repo.Comment.ListComments(currentUserID, req.TargetID, req.CommentID, req.TargetType, target.canViewAllComments(ctx), req.Page, req.Size, req.OrderBy, req.Desc, req.Depth)
	if err != nil {
		logrus.Errorf("GetCommentList: ListComments error: %s", err.Error())
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	return cs.toGetCommentDtos(comments, currentUserID), nil
}

func (cs *CommentService) ListCommentsAdmin(ctx context.Context, pagination *dto.PaginationParams, query string) ([]dto.CommentDto, int64, *errs.ServiceError) {
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	comments, total, err := repo.Comment.ListCommentsAdmin(pagination.Page, pagination.Size, pagination.OrderBy, pagination.Desc, strings.TrimSpace(query))
	if err != nil {
		logrus.Errorf("ListCommentsAdmin: ListCommentsAdmin error: %s", err.Error())
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
	}
	return cs.toGetCommentDtos(comments, currentUserID), total, nil
}

// ListUserComments 用户主页的评论列表：管理员可见全部，本人可见自己的私密评论，其他人只能看到公开目标下的公开评论
func (cs *CommentService) ListUserComments(ctx context.Context, req *dto.ListUserCommentsReq) ([]dto.UserCommentDto, int64, *errs.ServiceError) {
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	comments, total, err := repo.Comment.ListCommentsByUser(req.UserID, ctxutils.IsAdmin(ctx), ctxutils.IsOwnerOfTarget(ctx, req.UserID),
		req.Page, req.Size, req.OrderBy, req.Desc)
	if err != nil {
		logrus.Errorf("ListUserComments: ListCommentsByUser error: %s", err.Error())
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
	}

	// 按目标类型分组，批量查询标题与 slug
	idsByType := map[string][]uint{}
	for _, comment := range comments {
		idsByType[comment.TargetType] = append(idsByType[comment.TargetType], comment.TargetID)
	}
	briefsByType := map[string]map[uint]repo.CommentTargetBrief{}
	for targetType, ids := range idsByType {
		briefs, err := repo.Comment.ListTargetBriefs(targetType, ids)
		if err != nil {
			logrus.Errorf("ListUserComments: ListTargetBriefs error: %s", err.Error())
			return nil, 0, errs.NewInternalServer("failed_to_get_target")
		}
		briefsByType[targetType] = briefs
	}

	commentDtos := cs.toGetCommentDtos(comments, currentUserID)
	result := make([]dto.UserCommentDto, 0, len(commentDtos))
	for _, commentDto := range commentDtos {
		brief := briefsByType[commentDto.TargetType][commentDto.TargetID]
		result = append(result, dto.UserCommentDto{
			CommentDto: commentDto,
			Target: dto.CommentTargetDto{
				ID:    commentDto.TargetID,
				Type:  commentDto.TargetType,
				Title: brief.Title,
				Slug:  brief.Slug,
			},
		})
	}
	return result, total, nil
}

// toGetCommentDtos 批量转换评论，点赞状态一次查询完成，避免逐条查询
func (cs *CommentService) toGetCommentDtos(comments []model.Comment, currentUserID uint) []dto.CommentDto {
	likedIDs := map[uint]bool{}
	if currentUserID != 0 && len(comments) > 0 {
		ids := make([]uint, len(comments))
		for i, comment := range comments {
			ids[i] = comment.ID
		}
		var err error
		if likedIDs, err = repo.Like.LikedTargetIDs(currentUserID, constant.TargetTypeComment, ids); err != nil {
			logrus.Errorf("toGetCommentDtos: LikedTargetIDs error: %s", err.Error())
		}
	}
	commentDtos := make([]dto.CommentDto, 0, len(comments))
	for i := range comments {
		commentDtos = append(commentDtos, cs.toGetCommentDto(&comments[i], likedIDs[comments[i].ID]))
	}
	return commentDtos
}

func (cs *CommentService) toGetCommentDto(comment *model.Comment, isLiked bool) dto.CommentDto {
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

// commentTarget 评论目标（文章或页面）的作者与可见性
type commentTarget struct {
	ownerID   uint
	isPrivate bool
}

// canAccess 私密目标只有作者和管理员可以查看和评论
func (t *commentTarget) canAccess(ctx context.Context) bool {
	return !t.isPrivate || t.canViewAllComments(ctx)
}

// canViewAllComments 目标作者和管理员可以看到全部私密评论
func (t *commentTarget) canViewAllComments(ctx context.Context) bool {
	return ctxutils.IsOwnerOfTarget(ctx, t.ownerID) || ctxutils.IsAdmin(ctx)
}

func (cs *CommentService) getTarget(targetID uint, targetType string) (*commentTarget, *errs.ServiceError) {
	var meta *repo.PostMeta
	var err error
	switch targetType {
	case constant.TargetTypePost:
		meta, err = repo.Post.GetPostMeta(targetID)
	case constant.TargetTypePage:
		meta, err = repo.Page.GetPageMeta(targetID)
	default:
		return nil, errs.NewBadRequest("invalid_target_type")
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("operation_target_not_found")
		}
		logrus.Errorf("getTarget error: %s", err.Error())
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	return &commentTarget{ownerID: meta.UserID, isPrivate: meta.IsPrivate}, nil
}

// canViewComment 公开评论所有人可见；私密评论对管理员、目标作者、评论作者和参与过该评论树的用户可见
func (cs *CommentService) canViewComment(ctx context.Context, comment *model.Comment, target *commentTarget) (bool, *errs.ServiceError) {
	if !comment.IsPrivate || target.canViewAllComments(ctx) || ctxutils.IsOwnerOfTarget(ctx, comment.UserID) {
		return true, nil
	}
	currentUserID, ok := ctxutils.GetCurrentUserID(ctx)
	if !ok {
		return false, nil
	}
	participated, err := repo.Comment.HasUserCommentedInTree(comment.RootID, currentUserID)
	if err != nil {
		return false, errs.NewInternalServer("failed_to_get_target")
	}
	return participated, nil
}
