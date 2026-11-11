package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// GetAIUsage 全站模型调用用量：本月按用途分组的调用次数与 token、近 30 天趋势、预算
func (cc *AdminController) GetAIUsage(ctx context.Context, c *app.RequestContext) {
	stats, svcerr := service.NewLLMUsageService().Stats(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, stats)
}
