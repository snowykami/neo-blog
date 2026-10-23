package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type aiPromptType struct {
	service *service.AIPromptService
}

// AIPrompt 编辑器 AI 快捷指令
var AIPrompt = &aiPromptType{service: service.NewAIPromptService()}

// List 当前用户可用的指令（平台指令 + 个人指令），可按 mode 过滤
func (a *aiPromptType) List(ctx context.Context, c *app.RequestContext) {
	prompts, svcerr := a.service.List(ctx, c.Query("mode"))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, prompts)
}

// Create 新增指令
func (a *aiPromptType) Create(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdateAIPromptReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	prompt, svcerr := a.service.Create(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, prompt)
}

// Update 修改指令
func (a *aiPromptType) Update(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdateAIPromptReq
	if err := c.BindAndValidate(&req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	prompt, svcerr := a.service.Update(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, prompt)
}

// Delete 删除指令
func (a *aiPromptType) Delete(ctx context.Context, c *app.RequestContext) {
	if svcerr := a.service.Delete(ctx, ctxutils.GetIDParam(c).Uint); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
