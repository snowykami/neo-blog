package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

const (
	editSessionTouchInterval = 30 * time.Second // 最近活跃时间的最小记录间隔
	// 编辑会话闲置超过该时长视为编辑页已关闭：编辑页每 10 秒检查或保存一次，后台标签页的定时器最慢约每分钟一次
	editSessionIdleTimeout = 3 * time.Minute
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
	return s.acquire(ctx, targetType, targetID, userAgent)
}

// AcquireForAPIToken 外部 AI 工具（个人 API Token）写入正文前获取编辑会话，返回会话ID
// - 本 Token 已持有会话时直接沿用，其他 Token 的会话直接接管
// - 编辑页的会话仍在活跃时拒绝，绝不顶掉正在编辑的人
// - 编辑页的会话已闲置（编辑页已关闭）时才接管；编辑页之后重新打开仍可随时接管回来
func (s *EditSessionService) AcquireForAPIToken(ctx context.Context, targetType string, targetID uint) (string, *errs.ServiceError) {
	token, ok := ctxutils.GetAPIToken(ctx)
	if !ok {
		return "", errs.NewForbidden("permission_denied")
	}
	if svcerr := s.checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return "", svcerr
	}
	now := time.Now()
	current, err := repo.EditSession.Get(targetType, targetID)
	switch {
	case err == nil:
		if current.APITokenID != nil && *current.APITokenID == token.ID {
			_ = repo.EditSession.TouchActive(targetType, targetID, current.SessionID, now, editSessionTouchInterval)
			return current.SessionID, nil
		}
		// 其他 Token 的写入是一次性的、没有未保存的内容，可以直接接管；只保护编辑页
		if current.APITokenID == nil && now.Sub(current.LastActiveAt()) < editSessionIdleTimeout {
			holder := current.User.Nickname
			if holder == "" {
				holder = current.User.Username
			}
			return "", errs.New(http.StatusConflict, "edit_session_in_use",
				fmt.Errorf("%s has it open in the editor, last active at %s", holder, current.LastActiveAt().Format(time.RFC3339)))
		}
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return "", errs.NewInternalServer("failed_to_get_target")
	}
	result, svcerr := s.acquire(ctx, targetType, targetID, "API Token: "+token.Name)
	if svcerr != nil {
		return "", svcerr
	}
	return result.SessionID, nil
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
	if tokenID := ctxutils.GetAPITokenID(ctx); tokenID != 0 {
		session.APITokenID = &tokenID
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
	// 记录编辑起点，“放弃本次修改”时恢复到这个版本；记在会话上，会话期间保护该版本不被删除或清理
	result.BaseRevisionID = NewRevisionService().RecordSessionStart(ctx, targetType, targetID, session.SessionID)
	if result.BaseRevisionID != 0 {
		_ = repo.EditSession.SetBaseRevision(targetType, targetID, session.SessionID, result.BaseRevisionID)
	}
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
	// 编辑页空闲时会定时检查会话，借此记录编辑页仍然打开
	if result.IsCurrent {
		_ = repo.EditSession.TouchActive(targetType, targetID, sessionID, time.Now(), editSessionTouchInterval)
	}
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
	_ = repo.EditSession.TouchActive(targetType, targetID, sessionID, time.Now(), editSessionTouchInterval)
	return nil
}
