package middleware

import (
	"context"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func bearerToken(c *app.RequestContext) string {
	return strings.TrimSpace(strings.TrimPrefix(string(c.GetHeader("Authorization")), "Bearer "))
}

// UseAgentRunner Runner 接口：只接受 AGENT_RUNNER_TOKEN 共享密钥，未配置时接口整体关闭
func UseAgentRunner() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		if svcerr := service.CheckRunnerToken(bearerToken(c)); svcerr != nil {
			resps.Error(c, svcerr)
			c.Abort()
			return
		}
		c.Next(ctx)
	}
}

// UseAgentLease AI 用户的 MCP 接口：只接受租约令牌（nba_），以该 AI 用户的身份执行，权限范围与普通用户一致
func UseAgentLease() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		raw := bearerToken(c)
		if !strings.HasPrefix(raw, constant.AgentLeaseTokenPrefix) {
			c.Header("WWW-Authenticate", `Bearer realm="neo-blog-agent", error="invalid_token"`)
			resps.Error(c, errs.NewUnauthorized("invalid_lease_token"))
			c.Abort()
			return
		}
		leaseCtx, svcerr := service.NewAIAgentService().AuthenticateAgentLease(ctx, raw)
		if svcerr != nil {
			resps.Error(c, svcerr)
			c.Abort()
			return
		}
		c.Next(leaseCtx)
	}
}
