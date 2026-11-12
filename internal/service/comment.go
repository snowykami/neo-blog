package service

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

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

// 评论限流：同一用户 10 分钟内最多发这么多条。防的是拿评论当通知通道刷别人（提及会推站内通知）
const (
	commentRateLimit  = 20
	commentRateWindow = 10 * time.Minute
)

func (cs *CommentService) CreateComment(ctx context.Context, req *dto.CreateCommentReq) (uint, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}
	if !utils.AllowRequest("comment:"+strconv.FormatUint(uint64(currentUser.ID), 10), commentRateLimit, commentRateWindow) {
		return 0, errs.NewTooManyRequests("too_many_requests")
	}

	target, svcerr := cs.getTarget(req.TargetID, req.TargetType)
	if svcerr != nil {
		return 0, svcerr
	}
	if !target.canAccess(ctx) {
		return 0, errs.NewNotFound("operation_target_not_found").WithResource("comment")
	}
	// 被评论内容的作者，用于记录互动：回复时为被回复评论的作者，否则为文章/页面作者
	ownerID := target.ownerID
	var parent *model.Comment
	// 只能回复自己看得到的评论，防止通过回复加入私密评论树
	if req.ReplyID != 0 {
		var err error
		parent, err = repo.Comment.GetComment(req.ReplyID)
		if err != nil {
			return 0, errs.NewNotFound("operation_target_not_found").WithResource("comment")
		}
		visible, svcerr := cs.canViewComment(ctx, parent, target)
		if svcerr != nil {
			return 0, svcerr
		}
		if !visible {
			return 0, errs.NewNotFound("operation_target_not_found").WithResource("comment")
		}
		ownerID = parent.UserID
	}

	// 内容校验：去首尾空白，字符数不超过后台配置的上限（默认 500）；有附件时可以只发附件
	content := strings.TrimSpace(req.Content)
	if len([]rune(content)) > tools.GetCommentMaxLength() {
		return 0, errs.NewBadRequest("content_too_long")
	}
	attachmentIDs, svcerr := resolveCommentAttachments(ctx, req.AttachmentIDs, nil)
	if svcerr != nil {
		return 0, svcerr
	}
	mentionUserIDs, svcerr := resolveCommentMentions(req.MentionUserIDs, currentUser.ID, content)
	if svcerr != nil {
		return 0, svcerr
	}
	if content == "" && len(attachmentIDs) == 0 {
		return 0, errs.NewBadRequest("content_cannot_be_empty")
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
		AttachmentIDs:  attachmentIDs,
		MentionUserIDs: mentionUserIDs,
		ReplyID:        req.ReplyID,
		TargetID:       req.TargetID,
		TargetType:     req.TargetType,
		UserID:         currentUser.ID,
		IsPrivate:      req.IsPrivate,
		RemoteAddr:     req.RemoteAddr,
		UserAgent:      req.UserAgent,
		ShowClientInfo: req.ShowClientInfo,
	}
	// 评论与互动通知写在同一个事务里：评论成功就必须留下通知，崩溃也不会只留下其中一半（5.2 方案 A）
	var commentID uint
	var notifiedUsers []uint
	err := repo.GetDB().Transaction(func(tx *gorm.DB) error {
		var createErr error
		commentID, createErr = repo.Comment.CreateComment(comment, tools.GetMaximumReplyDepth(), tx)
		if createErr != nil {
			return createErr
		}
		// 通知是附属品，写失败不能让评论失败（5.3）
		users, emitErr := emitCommentNotifications(ctx, tx, currentUser, comment, parent, target)
		if emitErr != nil {
			logrus.Errorf("emit comment notifications: %v", emitErr)
		}
		notifiedUsers = users
		return nil
	})

	if err != nil {
		// 回复深度超限、目标不一致等校验错误原样返回
		var svcErr *errs.ServiceError
		if errors.As(err, &svcErr) {
			return 0, svcErr
		}
		logrus.Errorf("CreateComment: CreateComment error: %s", err.Error())
		return 0, errs.Internal("failed_to_create_target", err).WithResource("comment")
	}

	// 事务提交后再唤醒收件人的实时连接
	for _, userID := range notifiedUsers {
		NotificationHub.Notify(userID)
	}
	// 评论记入访客记录时间线：回复记在被回复的评论上，否则记在文章/页面上
	if req.ReplyID != 0 {
		NewVisitService().RecordInteraction(currentUser.ID, ownerID, constant.VisitActionComment, constant.TargetTypeComment, req.ReplyID, commentID)
	} else {
		NewVisitService().RecordInteraction(currentUser.ID, ownerID, constant.VisitActionComment, req.TargetType, req.TargetID, commentID)
	}
	// 回复了 AI 用户的评论、或评论里 @ 了 AI 用户时，由调度器决定该 AI 是否回应（异步，不影响本次请求）
	if req.ReplyID != 0 || len(comment.MentionUserIDs) > 0 {
		NotifyCommentCreated(commentID)
	}
	return commentID, nil
}

func (cs *CommentService) UpdateComment(ctx context.Context, req *dto.UpdateCommentReq) *errs.ServiceError {
	comment, err := repo.Comment.GetComment(req.ID)
	if err != nil {
		return errs.NewNotFound("operation_target_not_found").WithResource("comment")
	}

	// 仅管理员或评论主人可以修改评论
	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, comment.UserID)) {
		return errs.NewForbidden("forbidden")
	}
	// 编辑前的可见性与提及列表：编辑后据此收回 / 补发通知
	wasPrivate := comment.IsPrivate
	previousMentions := slices.Clone([]uint(comment.MentionUserIDs))

	// 内容校验：去首尾空白，字符数不超过后台配置的上限（默认 500）；有附件时可以只保留附件
	content := strings.TrimSpace(req.Content)
	if len([]rune(content)) > tools.GetCommentMaxLength() {
		return errs.NewBadRequest("content_too_long")
	}
	// 不传附件时保持原样（兼容不带附件字段的旧客户端）
	if req.AttachmentIDs != nil {
		attachmentIDs, svcerr := resolveCommentAttachments(ctx, *req.AttachmentIDs, comment.AttachmentIDs)
		if svcerr != nil {
			return svcerr
		}
		comment.AttachmentIDs = attachmentIDs
	}
	// 不传提及列表时保持原样（兼容不带该字段的旧客户端）
	if req.MentionUserIDs != nil {
		mentionUserIDs, svcerr := resolveCommentMentions(*req.MentionUserIDs, comment.UserID, content)
		if svcerr != nil {
			return svcerr
		}
		comment.MentionUserIDs = mentionUserIDs
	}
	if content == "" && len(comment.AttachmentIDs) == 0 {
		return errs.NewBadRequest("content_cannot_be_empty")
	}

	// 内容变化后原先识别的语言不再可信，下次翻译时重新识别
	if comment.Content != content {
		comment.Language = ""
	}
	comment.Content = content
	comment.IsPrivate = req.IsPrivate
	comment.ShowClientInfo = req.ShowClientInfo
	err = repo.Comment.UpdateComment(comment)
	if err != nil {
		logrus.Errorf("UpdateComment error: %s", err.Error())
		return errs.Internal("failed_to_update_target", err).WithResource("comment")
	}
	// 改为私密后收回无权查看者的通知、新加的 @ 补发提及通知，再唤醒相关收件人的实时连接
	notifyNotificationUsers(syncCommentNotificationsAfterEdit(ctx, comment, wasPrivate, previousMentions))
	// 新加了 @ 或改为公开时，由调度器决定被 @ 的 AI 用户是否回应（异步，不影响本次请求）
	if !comment.IsPrivate && (wasPrivate || hasNewMention(comment.MentionUserIDs, previousMentions)) {
		NotifyCommentEdited(comment.ID)
	}
	return nil
}

// hasNewMention 编辑后的提及列表里是否有编辑前没有的用户
func hasNewMention(mentions, previous []uint) bool {
	for _, id := range mentions {
		if !slices.Contains(previous, id) {
			return true
		}
	}
	return false
}

func (cs *CommentService) DeleteComment(ctx context.Context, commentID uint) *errs.ServiceError {
	_, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.NewUnauthorized("login_required")
	}
	if commentID == 0 {
		return errs.NewBadRequest("operation_target_not_found").WithResource("comment")
	}

	comment, err := repo.Comment.GetComment(commentID)
	if err != nil {
		return errs.NewNotFound("operation_target_not_found").WithResource("comment")
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

	notified, err := repo.Comment.DeleteComment(commentID)
	if err != nil {
		logrus.Errorf("DeleteComment error: %s", err.Error())
		return errs.Internal("failed_to_delete_target", err).WithResource("comment")
	}
	notifyNotificationUsers(notified)
	return nil
}

func (cs *CommentService) GetComment(ctx context.Context, commentID uint) (*dto.CommentDto, *errs.ServiceError) {
	comment, svcerr := cs.loadVisibleComment(ctx, commentID)
	if svcerr != nil {
		return nil, svcerr
	}
	currentUserID := uint(0)
	if currentUser, ok := ctxutils.GetCurrentUser(ctx); ok {
		currentUserID = currentUser.ID
	}
	commentDtos := cs.toGetCommentDtos([]model.Comment{*comment}, currentUserID, false)
	return &commentDtos[0], nil
}

// loadVisibleComment 读取当前用户看得到的评论：所属文章 / 页面可访问，私密评论还需对当前用户可见
func (cs *CommentService) loadVisibleComment(ctx context.Context, commentID uint) (*model.Comment, *errs.ServiceError) {
	comment, err := repo.Comment.GetComment(commentID)
	if err != nil {
		return nil, errs.NewNotFound("operation_target_not_found").WithResource("comment")
	}
	target, svcerr := cs.getTarget(comment.TargetID, comment.TargetType)
	if svcerr != nil {
		return nil, svcerr
	}
	if !target.canAccess(ctx) {
		return nil, errs.NewNotFound("operation_target_not_found").WithResource("comment")
	}
	// 私密评论可见性：管理员、目标作者、评论作者以及参与过该评论树的用户可见
	visible, svcerr := cs.canViewComment(ctx, comment, target)
	if svcerr != nil {
		return nil, svcerr
	}
	if !visible {
		return nil, errs.NewForbidden("permission_denied")
	}
	return comment, nil
}

// threadUsersLimit 主评论折叠时展示的回复者头像数
const threadUsersLimit = 3

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
		return nil, errs.NewNotFound("operation_target_not_found").WithResource("comment")
	}
	viewAll := target.canViewAllComments(ctx)
	// 按线程获取时不限层级
	depth := req.Depth
	if req.RootID > 0 {
		depth = nil
	}
	comments, err := repo.Comment.ListComments(currentUserID, req.TargetID, req.CommentID, req.RootID, req.TargetType, viewAll, req.Page, req.Size, req.OrderBy, req.Desc, depth)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("comment")
	}
	commentDtos := cs.toGetCommentDtos(comments, currentUserID, false)
	// 主评论列表附带回复线程的摘要（可见回复数与最早回复的几位用户），前端折叠时展示
	if req.RootID == 0 && req.CommentID == 0 && depth != nil && *depth == 0 && len(commentDtos) > 0 {
		rootIDs := make([]uint, len(commentDtos))
		for i, commentDto := range commentDtos {
			rootIDs[i] = commentDto.ID
		}
		counts, repliers, err := repo.Comment.ThreadSummaries(rootIDs, currentUserID, viewAll, threadUsersLimit)
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("comment")
		}
		for i := range commentDtos {
			commentDtos[i].ThreadCount = uint64(counts[commentDtos[i].ID])
			// 公开接口：参与回复的用户只给公开信息（不含邮箱）
			commentDtos[i].ThreadUsers = model.ToPublicUserDtos(repliers[commentDtos[i].ID])
		}
	}
	return commentDtos, nil
}

func (cs *CommentService) ListCommentsAdmin(ctx context.Context, pagination *dto.PaginationParams, query string) ([]dto.UserCommentDto, int64, *errs.ServiceError) {
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	comments, total, err := repo.Comment.ListCommentsAdmin(pagination.Page, pagination.Size, pagination.OrderBy, pagination.Desc, strings.TrimSpace(query))
	if err != nil {
		logrus.Errorf("ListCommentsAdmin: ListCommentsAdmin error: %s", err.Error())
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("comment")
	}
	// 后台评论管理只对管理员开放（路由中间件），设备与归属地照常返回
	commentDtos := cs.toGetCommentDtos(comments, currentUserID, true)

	// 附带所属文章 / 页面的标题，后台直接显示标题并链接（私密目标链接到后台预览）
	idsByType := map[string][]uint{}
	for _, comment := range comments {
		idsByType[comment.TargetType] = append(idsByType[comment.TargetType], comment.TargetID)
	}
	infos := map[string]map[uint]repo.TargetInfo{}
	for targetType, ids := range idsByType {
		if infos[targetType], err = repo.Visit.GetTargetInfos(targetType, ids); err != nil {
			logrus.Errorf("ListCommentsAdmin: GetTargetInfos error: %s", err.Error())
			return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("comment")
		}
	}
	result := make([]dto.UserCommentDto, 0, len(commentDtos))
	for _, commentDto := range commentDtos {
		item := dto.UserCommentDto{CommentDto: commentDto, Target: dto.CommentTargetDto{ID: commentDto.TargetID, Type: commentDto.TargetType}}
		// 目标已被删除时只有类型与 id，标题为空
		if info, ok := infos[commentDto.TargetType][commentDto.TargetID]; ok {
			item.Target.Title, item.Target.Slug, item.Target.IsPrivate = info.Title, info.Slug, info.IsPrivate
		}
		result = append(result, item)
	}
	return result, total, nil
}

// ListUserComments 用户主页的评论列表：管理员可见全部，本人可见自己的私密评论，其他人只能看到公开目标下的公开评论
func (cs *CommentService) ListUserComments(ctx context.Context, req *dto.ListUserCommentsReq) ([]dto.UserCommentDto, int64, *errs.ServiceError) {
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	comments, total, err := repo.Comment.ListCommentsByUser(req.UserID, ctxutils.IsAdmin(ctx), ctxutils.IsOwnerOfTarget(ctx, req.UserID),
		req.Page, req.Size, req.OrderBy, req.Desc)
	if err != nil {
		logrus.Errorf("ListUserComments: ListCommentsByUser error: %s", err.Error())
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("comment")
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
			return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("comment")
		}
		briefsByType[targetType] = briefs
	}

	commentDtos := cs.toGetCommentDtos(comments, currentUserID, false)
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

// toGetCommentDtos 批量转换评论，点赞状态与附件各一次查询完成，避免逐条查询
// revealClient 为 true 时无论评论者是否公开都返回设备与归属地，只用于管理员后台
func (cs *CommentService) toGetCommentDtos(comments []model.Comment, currentUserID uint, revealClient bool) []dto.CommentDto {
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
	files := commentAttachmentFiles(comments)
	mentions := commentMentionUsers(comments)
	commentDtos := make([]dto.CommentDto, 0, len(comments))
	for i := range comments {
		commentDto := cs.toGetCommentDto(&comments[i], likedIDs[comments[i].ID], revealClient)
		commentDto.Attachments = toCommentAttachmentDtos(comments[i].AttachmentIDs, files)
		// 被 @ 的人按 id 取当前用户名：正文里是评论当时的写法，渲染以这份为准
		for _, id := range comments[i].MentionUserIDs {
			if user, ok := mentions[id]; ok {
				commentDto.Mentions = append(commentDto.Mentions, dto.CommentMentionDto{
					ID: user.ID, Username: user.Username, Nickname: user.Nickname,
				})
			}
		}
		commentDtos = append(commentDtos, commentDto)
	}
	return commentDtos
}

// commentMentionUsers 一次查询这批评论里被 @ 的用户，按 id 索引
func commentMentionUsers(comments []model.Comment) map[uint]model.User {
	var ids []uint
	for i := range comments {
		for _, id := range comments[i].MentionUserIDs {
			if !slices.Contains(ids, id) {
				ids = append(ids, id)
			}
		}
	}
	result := make(map[uint]model.User, len(ids))
	if len(ids) == 0 {
		return result
	}
	users, err := repo.User.GetUsersByIDs(ids)
	if err != nil {
		logrus.Errorf("commentMentionUsers: GetUsersByIDs error: %s", err.Error())
		return result
	}
	for _, user := range users {
		result[user.ID] = user
	}
	return result
}

// toGetCommentDto 转换单条评论。设备与归属地只在评论者选择公开（ShowClientInfo）或 revealClient（管理员后台）时返回；
// 系统版本被 UA 固定（如 macOS 10.15.7、Windows NT 10.0）时只给系统名
func (cs *CommentService) toGetCommentDto(comment *model.Comment, isLiked, revealClient bool) dto.CommentDto {
	ua := utils.ParseUA(comment.UserAgent)
	osName, browser := ua.PublicOS(), ua.PublicBrowser()
	if !(comment.ShowClientInfo || revealClient) {
		comment.CommentLocation = model.CommentLocation{}
		osName, browser = "", ""
	}

	return dto.CommentDto{
		ID:             comment.ID,
		Content:        comment.Content,
		MentionUserIDs: comment.MentionUserIDs,
		Language:       comment.Language,
		TargetID:       comment.TargetID,
		TargetType:     comment.TargetType,
		RootID:         comment.RootID,
		ReplyID:        comment.ReplyID,
		CreatedAt:      comment.CreatedAt,
		UpdatedAt:      comment.UpdatedAt,
		Depth:          comment.Depth,
		User:           comment.User.ToDto(),
		ReplyCount:     comment.CommentCount,
		LikeCount:      comment.LikeCount,
		IsLiked:        isLiked,
		IsPrivate:      comment.IsPrivate,
		OS:             osName,
		Browser:        browser,
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
			return nil, errs.NewNotFound("operation_target_not_found").WithResource("page")
		}
		logrus.Errorf("getTarget error: %s", err.Error())
		return nil, errs.Internal("failed_to_get_target", err).WithResource("comment")
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
		return false, errs.Internal("failed_to_get_target", err).WithResource("comment")
	}
	return participated, nil
}
