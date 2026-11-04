// Package agentrunner AI 用户的 worker：随后端启动，领取到点的任务，以 AI 用户的身份阅读（只读工具）、
// 让模型给出期望操作列表，再由执行器逐条执行。模型拿不到写工具，也接触不到数据库与密钥：
// 读写都经过 service 层的工具（与普通用户相同的权限判断与 AgentGuard），模型经 service.AgentChat 调用
package agentrunner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type toolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type chatMessage struct {
	Role       string     `json:"role"`
	Content    *string    `json:"content"`
	ToolCalls  []toolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

func textMessage(role, content string) chatMessage {
	return chatMessage{Role: role, Content: &content}
}

type toolDef struct {
	Type     string `json:"type"`
	Function struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Parameters  any    `json:"parameters"`
	} `json:"function"`
}

type chatResult struct {
	Content   string
	ToolCalls []toolCall
}

// retryable 网络错误、上游 429 与 5xx 可以重试；全站额度用完、运行已失去租约、AI 未配置等不重试
func retryable(err error) bool {
	var statusErr *service.AgentLLMStatusError
	if errors.As(err, &statusErr) {
		return statusErr.Status == http.StatusTooManyRequests || statusErr.Status >= 500
	}
	var svcerr *errs.ServiceError
	return !errors.Is(err, service.ErrAgentLLMBudget) && !errors.As(err, &svcerr)
}

// chat 调用模型（OpenAI 兼容），失败时最多重试两次
func (e *execution) chat(ctx context.Context, messages []chatMessage, tools []toolDef) (*chatResult, error) {
	payload := map[string]any{"messages": messages, "temperature": 0.8}
	if len(tools) > 0 {
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt*attempt) * 3 * time.Second):
			}
		}
		body, err := service.NewAIAgentService().AgentChat(ctx, e.run.RunID, payload)
		if err != nil {
			if !retryable(err) {
				return nil, err
			}
			lastErr = err
			continue
		}
		var parsed struct {
			Choices []struct {
				Message struct {
					Content   string     `json:"content"`
					ToolCalls []toolCall `json:"tool_calls"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil || len(parsed.Choices) == 0 {
			lastErr = fmt.Errorf("invalid llm response: %s", clip(string(body), 200))
			continue
		}
		msg := parsed.Choices[0].Message
		return &chatResult{Content: msg.Content, ToolCalls: msg.ToolCalls}, nil
	}
	return nil, lastErr
}

func clip(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}
