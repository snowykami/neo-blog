package service

import (
	"context"
	"errors"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// EditSessionService 编辑会话：同一文章/页面同时只允许最新打开编辑页的会话保存正文
type EditSessionService struct{}

func NewEditSessionService() *EditSessionService {
	return &EditSessionService{}
}

// checkEditPermission 只有作者或管理员可以编辑
func (s *EditSessionService) checkEditPermission(ctx context.Context, targetType string, targetID uint) *errs.ServiceError {
	if targetID == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	ownerID, err := repo.EditSession.GetTargetOwnerID(targetType, targetID)
	if err != nil {
		return errs.NewInternalServer("failed_to_get_target")
	}
	if ownerID == 0 {
		return errs.NewNotFound("target_not_found")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, ownerID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	return nil
}

// Acquire 开启新的编辑会话并顶掉旧会话，返回新会话ID
func (s *EditSessionService) Acquire(ctx context.Context, targetType string, targetID uint, userAgent string) (*dto.EditSessionDto, *errs.ServiceError) {
	if svcerr := s.checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return nil, svcerr
	}
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	session := &model.EditSession{
		TargetType: targetType,
		TargetID:   targetID,
		SessionID:  utils.Strings.GenerateRandomString(32),
		UserID:     currentUserID,
		UserAgent:  userAgent,
	}
	if err := repo.EditSession.Upsert(session); err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	saved, err := repo.EditSession.Get(targetType, targetID)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := saved.ToDto(true)
	result.IsCurrent = true
	// 记录编辑起点，“放弃本次修改”时恢复到这个版本
	result.BaseRevisionID = NewRevisionService().RecordSessionStart(targetType, targetID, currentUserID, session.SessionID)
	return result, nil
}

// Current 获取当前持有编辑会话的信息（不含会话ID），没有会话时返回 nil
// sessionID 为请求方自己的会话，用于判断是否已被顶掉
func (s *EditSessionService) Current(ctx context.Context, targetType string, targetID uint, sessionID string) (*dto.EditSessionDto, *errs.ServiceError) {
	if svcerr := s.checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return nil, svcerr
	}
	session, err := repo.EditSession.Get(targetType, targetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := session.ToDto(false)
	result.IsCurrent = sessionID != "" && session.SessionID == sessionID
	return result, nil
}

// CheckContentWrite 保存正文前校验：存在编辑会话且请求携带的会话不是最新的，则拒绝保存
// 没有任何编辑会话时放行（例如尚未打开过编辑页）
func (s *EditSessionService) CheckContentWrite(targetType string, targetID uint, sessionID string) *errs.ServiceError {
	session, err := repo.EditSession.Get(targetType, targetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return errs.NewInternalServer("failed_to_get_target")
	}
	if session.SessionID != sessionID {
		return errs.NewConflict("edit_session_taken_over")
	}
	return nil
}
