package service

import (
	"context"
	"errors"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// EditSessionService 编辑会话：同一文章/页面同时只允许最新打开编辑页的会话保存正文
// 外部 AI 工具（API Token）不使用编辑会话，可以与编辑页同时写入，由草稿版本号保证不覆盖他人的修改（见 checkContentWrite）
type EditSessionService struct{}

func NewEditSessionService() *EditSessionService {
	return &EditSessionService{}
}

// checkEditPermission 只有作者或管理员可以编辑
func (s *EditSessionService) checkEditPermission(ctx context.Context, targetType string, targetID uint) *errs.ServiceError {
	_, svcerr := s.editableTargetOwner(ctx, targetType, targetID)
	return svcerr
}

// editableTargetOwner 校验编辑权限（只有作者或管理员可以编辑）并返回作者ID
func (s *EditSessionService) editableTargetOwner(ctx context.Context, targetType string, targetID uint) (uint, *errs.ServiceError) {
	if targetID == 0 {
		return 0, errs.NewBadRequest("invalid_request_parameters")
	}
	ownerID, err := repo.EditSession.GetTargetOwnerID(targetType, targetID)
	if err != nil {
		return 0, errs.Internal("failed_to_get_target", err)
	}
	if ownerID == 0 {
		return 0, errs.NewNotFound("target_not_found")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, ownerID) || ctxutils.IsAdmin(ctx)) {
		return 0, errs.NewForbidden("permission_denied")
	}
	return ownerID, nil
}

// Acquire 开启新的编辑会话并顶掉旧会话，返回新会话ID
func (s *EditSessionService) Acquire(ctx context.Context, targetType string, targetID uint, userAgent string) (*dto.EditSessionDto, *errs.ServiceError) {
	if svcerr := s.checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return nil, svcerr
	}
	return s.acquire(ctx, targetType, targetID, userAgent)
}

// acquire 写入新的编辑会话（顶掉旧会话）并记录编辑起点，调用方负责权限检查
func (s *EditSessionService) acquire(ctx context.Context, targetType string, targetID uint, userAgent string) (*dto.EditSessionDto, *errs.ServiceError) {
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	now := time.Now()
	session := &model.EditSession{
		TargetType: targetType,
		TargetID:   targetID,
		SessionID:  utils.Strings.GenerateRandomString(32),
		UserID:     currentUserID,
		UserAgent:  userAgent,
		ActiveAt:   &now,
	}
	if err := repo.EditSession.Upsert(session); err != nil {
		return nil, errs.Internal("failed_to_create_target", err)
	}
	saved, err := repo.EditSession.Get(targetType, targetID)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	result := saved.ToDto(true)
	result.IsCurrent = true
	// 记录编辑起点，“放弃本次修改”时恢复到这个版本；记在会话上，会话期间保护该版本不被删除或清理
	result.BaseRevisionID = NewRevisionService().RecordSessionStart(ctx, targetType, targetID, session.SessionID)
	if result.BaseRevisionID != 0 {
		_ = repo.EditSession.SetBaseRevision(targetType, targetID, session.SessionID, result.BaseRevisionID)
	}
	PublishEditEvent(EditEvent{Type: EditEventSession, TargetType: targetType, TargetID: targetID})
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
		return nil, errs.Internal("failed_to_get_target", err)
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
		return errs.Internal("failed_to_get_target", err)
	}
	if session.SessionID != sessionID {
		return errs.NewConflict("edit_session_taken_over")
	}
	return nil
}

// checkContentWrite 保存正文前的校验，由 UpdatePost / UpdatePage 调用：
//   - 浏览器编辑页：校验编辑会话，同一内容同时只允许最新打开的编辑页保存（多设备时被顶掉的一方只读）
//   - 外部 AI 工具（API Token）：不受编辑会话限制，可以与编辑页同时写入
//   - 传了基线版本号时必须是当前的草稿版本，否则说明读取之后有其他写入，拒绝保存（draft_conflict），
//     由调用方取最新草稿合并后重试；保存时还会在库中原子地再比较一次，见 repo.SavePostWithDraftVersion
func checkContentWrite(ctx context.Context, targetType string, targetID uint, sessionID string, base *uint64, current uint64) *errs.ServiceError {
	if ctxutils.GetAPITokenID(ctx) == 0 {
		if svcerr := NewEditSessionService().CheckContentWrite(targetType, targetID, sessionID); svcerr != nil {
			return svcerr
		}
	}
	if base != nil && *base != current {
		return errs.NewConflict("draft_conflict")
	}
	return nil
}
