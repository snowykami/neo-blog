package ctxutils

import "context"

const agentRunKey = "agent_run"

// AgentRunInfo 本次请求所属的 AI 用户运行：由租约令牌鉴权后挂载
type AgentRunInfo struct {
	RunID   uint
	AgentID uint
	UserID  uint
	DryRun  bool
}

// WithAgentRun 租约令牌鉴权通过后挂载运行信息
func WithAgentRun(ctx context.Context, info *AgentRunInfo) context.Context {
	return context.WithValue(ctx, agentRunKey, info)
}

// GetAgentRun 当前请求是否由 AI 用户的租约令牌发起
func GetAgentRun(ctx context.Context) (*AgentRunInfo, bool) {
	info, ok := ctx.Value(agentRunKey).(*AgentRunInfo)
	return info, ok && info != nil
}
