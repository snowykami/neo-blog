package ctxutils

import "context"

const agentRunKey = "agent_run"

// AgentRunInfo 当前操作所属的 AI 用户运行：worker 以 AI 用户身份调用工具时挂载
type AgentRunInfo struct {
	RunID   uint
	AgentID uint
	UserID  uint
	DryRun  bool
}

// WithAgentRun 挂载运行信息
func WithAgentRun(ctx context.Context, info *AgentRunInfo) context.Context {
	return context.WithValue(ctx, agentRunKey, info)
}

// GetAgentRun 当前操作是否由 AI 用户的运行发起
func GetAgentRun(ctx context.Context) (*AgentRunInfo, bool) {
	info, ok := ctx.Value(agentRunKey).(*AgentRunInfo)
	return info, ok && info != nil
}
