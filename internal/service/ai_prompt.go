package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

const (
	aiPromptMaxLabelRune       = 30
	aiPromptMaxInstructionRune = 1000
)

// AIPromptService 编辑器 AI 快捷指令：平台指令由管理员维护，编辑者可维护自己的个人指令
type AIPromptService struct{}

func NewAIPromptService() *AIPromptService {
	return &AIPromptService{}
}

// canManage 管理员可管理全部指令；其他人只能管理自己的个人指令
func (s *AIPromptService) canManage(ctx context.Context, prompt *model.AIPrompt) bool {
	return ctxutils.IsAdmin(ctx) || (prompt.Scope == model.AIPromptScopeUser && ctxutils.IsOwnerOfTarget(ctx, prompt.UserID))
}

// canUse 平台指令所有编辑者可用，个人指令仅创建者（与管理员）可用
func (s *AIPromptService) canUse(ctx context.Context, prompt *model.AIPrompt) bool {
	return prompt.Scope == model.AIPromptScopePlatform || ctxutils.IsOwnerOfTarget(ctx, prompt.UserID) || ctxutils.IsAdmin(ctx)
}

// List 当前用户可用的指令（平台指令 + 自己的个人指令），mode 为空时返回全部
func (s *AIPromptService) List(ctx context.Context, mode string) ([]*dto.AIPromptDto, *errs.ServiceError) {
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	prompts, err := repo.AIPrompt.ListVisible(userID)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := make([]*dto.AIPromptDto, 0, len(prompts))
	for i := range prompts {
		if mode != "" && prompts[i].Mode != mode {
			continue
		}
		result = append(result, prompts[i].ToDto(s.canManage(ctx, &prompts[i])))
	}
	return result, nil
}

// normalize 校验并整理名称、指令与模式
func (s *AIPromptService) normalize(req *dto.CreateOrUpdateAIPromptReq) *errs.ServiceError {
	req.Label = strings.TrimSpace(req.Label)
	req.Instruction = strings.TrimSpace(req.Instruction)
	if !(req.Mode == aiWriteModeWrite || req.Mode == aiWriteModeRewrite) {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	if req.Label == "" || req.Instruction == "" {
		return errs.NewBadRequest("missing_request_parameters")
	}
	if utf8.RuneCountInString(req.Label) > aiPromptMaxLabelRune || utf8.RuneCountInString(req.Instruction) > aiPromptMaxInstructionRune {
		return errs.NewBadRequest("ai_input_too_long")
	}
	return nil
}

// Create 新增指令：平台指令仅管理员可新增，默认为个人指令
func (s *AIPromptService) Create(ctx context.Context, req *dto.CreateOrUpdateAIPromptReq) (*dto.AIPromptDto, *errs.ServiceError) {
	if req.Scope == "" {
		req.Scope = model.AIPromptScopeUser
	}
	if !(req.Scope == model.AIPromptScopeUser || req.Scope == model.AIPromptScopePlatform) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if req.Scope == model.AIPromptScopePlatform && !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	if svcerr := s.normalize(req); svcerr != nil {
		return nil, svcerr
	}
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	prompt := &model.AIPrompt{Scope: req.Scope, UserID: userID, Mode: req.Mode, Label: req.Label, Instruction: req.Instruction}
	if err := repo.AIPrompt.Create(prompt); err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	return prompt.ToDto(true), nil
}

func (s *AIPromptService) loadManageable(ctx context.Context, id uint) (*model.AIPrompt, *errs.ServiceError) {
	prompt, err := repo.AIPrompt.Get(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if !s.canManage(ctx, prompt) {
		return nil, errs.NewForbidden("permission_denied")
	}
	return prompt, nil
}

// Update 修改名称、模式与指令内容（范围不可修改）
func (s *AIPromptService) Update(ctx context.Context, req *dto.CreateOrUpdateAIPromptReq) (*dto.AIPromptDto, *errs.ServiceError) {
	prompt, svcerr := s.loadManageable(ctx, req.ID)
	if svcerr != nil {
		return nil, svcerr
	}
	if svcerr := s.normalize(req); svcerr != nil {
		return nil, svcerr
	}
	prompt.Mode, prompt.Label, prompt.Instruction = req.Mode, req.Label, req.Instruction
	if err := repo.AIPrompt.Save(prompt); err != nil {
		return nil, errs.NewInternalServer("failed_to_update_target")
	}
	return prompt.ToDto(true), nil
}

// Delete 删除指令
func (s *AIPromptService) Delete(ctx context.Context, id uint) *errs.ServiceError {
	if _, svcerr := s.loadManageable(ctx, id); svcerr != nil {
		return svcerr
	}
	if err := repo.AIPrompt.Delete(id); err != nil {
		return errs.NewInternalServer("failed_to_delete_target")
	}
	return nil
}

// resolve AI 写作时取出指令：需对当前用户可用且与写作模式一致
func (s *AIPromptService) resolve(ctx context.Context, id uint, mode string) (*model.AIPrompt, *errs.ServiceError) {
	prompt, err := repo.AIPrompt.Get(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if !s.canUse(ctx, prompt) {
		return nil, errs.NewForbidden("permission_denied")
	}
	if prompt.Mode != mode {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	return prompt, nil
}
