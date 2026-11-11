package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// AIAgentController AI 用户的管理接口（管理员）
type AIAgentController struct {
	service *service.AIAgentService
}

func NewAIAgentController() *AIAgentController {
	return &AIAgentController{service: service.NewAIAgentService()}
}

func idParam(c *app.RequestContext) (uint, bool) {
	id := ctxutils.GetIDParam(c).Uint
	if id == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return 0, false
	}
	return id, true
}

// ---------- 管理接口 ----------

func (cc *AIAgentController) List(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminListAIAgentsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	agents, total, svcerr := cc.service.List(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"agents": agents, "total": total})
}

func (cc *AIAgentController) Stats(ctx context.Context, c *app.RequestContext) {
	stats, svcerr := cc.service.Stats(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, stats)
}

func (cc *AIAgentController) Create(ctx context.Context, c *app.RequestContext) {
	req := &dto.CreateAIAgentReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	agent, svcerr := cc.service.Create(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, agent)
}

// Export 导出 AI 用户文件（账号资料与性格档案）
func (cc *AIAgentController) Export(ctx context.Context, c *app.RequestContext) {
	req := &dto.ExportAIAgentsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	agents, svcerr := cc.service.Export(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"agents": agents})
}

// Import 按导入文件创建 AI 用户，返回每一项的结果
func (cc *AIAgentController) Import(ctx context.Context, c *app.RequestContext) {
	req := &dto.ImportAIAgentsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	results, svcerr := cc.service.Import(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"results": results})
}

func (cc *AIAgentController) ConvertUser(ctx context.Context, c *app.RequestContext) {
	req := &dto.ConvertUserToAIReq{}
	if err := c.BindAndValidate(req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	agent, svcerr := cc.service.ConvertUser(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, agent)
}

func (cc *AIAgentController) Get(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	agent, svcerr := cc.service.Get(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, agent)
}

func (cc *AIAgentController) Update(ctx context.Context, c *app.RequestContext) {
	req := &dto.UpdateAIAgentReq{}
	if err := c.BindAndValidate(req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	agent, svcerr := cc.service.Update(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, agent)
}

func (cc *AIAgentController) setStatus(status string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		id, ok := idParam(c)
		if !ok {
			return
		}
		if svcerr := cc.service.SetStatus(ctx, id, status); svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, nil)
	}
}

func (cc *AIAgentController) Pause() app.HandlerFunc {
	return cc.setStatus(constant.AIAgentStatusPaused)
}
func (cc *AIAgentController) Resume() app.HandlerFunc {
	return cc.setStatus(constant.AIAgentStatusActive)
}

func (cc *AIAgentController) Delete(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if svcerr := cc.service.Delete(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// Batch 批量暂停、恢复或取消 AI 身份
func (cc *AIAgentController) Batch(ctx context.Context, c *app.RequestContext) {
	req := &dto.BatchAIAgentsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	result, svcerr := cc.service.Batch(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

func (cc *AIAgentController) DryRun(ctx context.Context, c *app.RequestContext) {
	req := &dto.AIAgentDryRunReq{}
	if err := c.BindAndValidate(req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	run, svcerr := cc.service.DryRun(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, run)
}

func (cc *AIAgentController) ListMemories(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListAgentMemoriesReq{}
	if err := c.BindAndValidate(req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	memories, total, svcerr := cc.service.ListMemories(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"memories": memories, "total": total})
}

func (cc *AIAgentController) UpdateMemory(ctx context.Context, c *app.RequestContext) {
	req := &dto.UpdateAgentMemoryReq{}
	if err := c.BindAndValidate(req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := cc.service.UpdateMemory(ctx, req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AIAgentController) DeleteMemory(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if svcerr := cc.service.DeleteMemory(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AIAgentController) ListRelations(ctx context.Context, c *app.RequestContext) {
	req := &struct {
		dto.PaginationParams
		ID uint `path:"id"`
	}{}
	if err := c.BindAndValidate(req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	relations, total, svcerr := cc.service.ListRelations(ctx, req.ID, int(req.Page), int(req.Size))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"relations": relations, "total": total})
}

func (cc *AIAgentController) DeleteRelation(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if svcerr := cc.service.DeleteRelation(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AIAgentController) ListRuns(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListAgentRunsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	runs, total, svcerr := cc.service.ListRuns(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"runs": runs, "total": total})
}

func (cc *AIAgentController) GetRun(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	run, svcerr := cc.service.GetRun(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, run)
}

func (cc *AIAgentController) RevertRun(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	run, svcerr := cc.service.RevertRun(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, run)
}

func (cc *AIAgentController) ListGroups(ctx context.Context, c *app.RequestContext) {
	groups, svcerr := cc.service.ListGroups(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"groups": groups})
}

func (cc *AIAgentController) GetGroup(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	group, svcerr := cc.service.GetGroup(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, group)
}

func (cc *AIAgentController) GenerateGroup(ctx context.Context, c *app.RequestContext) {
	req := &dto.GenerateAIAgentGroupReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := cc.service.GenerateGroup(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

// ResumeGroup 生成失败的群体从已创建的数量继续生成
func (cc *AIAgentController) ResumeGroup(ctx context.Context, c *app.RequestContext) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	group, svcerr := cc.service.ResumeGroup(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, group)
}

func (cc *AIAgentController) SetGroupStatus(ctx context.Context, c *app.RequestContext) {
	req := &dto.UpdateAIAgentGroupStatusReq{}
	if err := c.BindAndValidate(req); err != nil || req.ID == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := cc.service.SetGroupStatus(ctx, req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
