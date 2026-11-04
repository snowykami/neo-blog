// Package agentrunner AI 用户的 Runner：从后端领取任务，以 AI 用户的身份阅读（只读工具）、让模型给出期望操作列表，再由执行器逐条执行。
// Runner 不连数据库、不连 Redis、拿不到模型 Key：任务与回报走 Runner 接口，模型走后端的 LLM 网关，读写走 AI 用户专用的 MCP（租约令牌）
package agentrunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// Config Runner 配置，全部来自环境变量
type Config struct {
	BackendURL  string        // 后端地址，如 http://backend:8888（直连后端，不经过前端）
	RunnerToken string        // 与后端相同的 AGENT_RUNNER_TOKEN
	Concurrency int           // 同时执行的任务数
	LeaseWait   time.Duration // 长轮询等待时间
}

// LoadConfig 读取环境变量
func LoadConfig() Config {
	backend := utils.Env.Get("AGENT_BACKEND_URL", utils.Env.Get("BACKEND_URL", "http://127.0.0.1:8888"))
	return Config{
		BackendURL:  strings.TrimRight(backend, "/"),
		RunnerToken: utils.Env.Get("AGENT_RUNNER_TOKEN"),
		Concurrency: max(1, utils.Env.GetAsInt("AGENT_CONCURRENCY", 2)),
		LeaseWait:   time.Duration(max(1, min(30, utils.Env.GetAsInt("AGENT_LEASE_WAIT_SECONDS", 25)))) * time.Second,
	}
}

// backend Runner 接口客户端
type backend struct {
	cfg  Config
	http *http.Client
}

func newBackend(cfg Config) *backend {
	return &backend{cfg: cfg, http: &http.Client{Timeout: 4 * time.Minute}}
}

// apiError 后端返回的错误
type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return fmt.Sprintf("backend %d: %s", e.Status, e.Message) }

// call 调用 Runner 接口，解开统一响应结构中的 data
func (b *backend) call(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, b.cfg.BackendURL+"/api/v1/agent-runner"+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+b.cfg.RunnerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return err
	}
	var envelope struct {
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(data, &envelope)
	if resp.StatusCode != http.StatusOK {
		return &apiError{Status: resp.StatusCode, Message: envelope.Message}
	}
	if out != nil && len(envelope.Data) > 0 {
		return json.Unmarshal(envelope.Data, out)
	}
	return nil
}

func (b *backend) lease(ctx context.Context, maxRuns int) (*dto.AgentLeaseResp, error) {
	out := &dto.AgentLeaseResp{}
	err := b.call(ctx, http.MethodPost, "/lease", dto.AgentLeaseReq{Max: maxRuns, WaitSeconds: int(b.cfg.LeaseWait / time.Second)}, out)
	return out, err
}

func (b *backend) heartbeat(ctx context.Context, runID uint) error {
	return b.call(ctx, http.MethodPost, fmt.Sprintf("/runs/%d/heartbeat", runID), struct{}{}, nil)
}

func (b *backend) complete(ctx context.Context, req *dto.AgentCompleteReq) error {
	return b.call(ctx, http.MethodPost, fmt.Sprintf("/runs/%d/complete", req.ID), req, nil)
}

// ---------- LLM（经后端网关，OpenAI 兼容） ----------

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

// errBudget 后端返回额度不足，不再重试
var errBudget = errors.New("llm budget or rate limit reached")

// chat 调用后端 LLM 网关
func (b *backend) chat(ctx context.Context, runID uint, messages []chatMessage, tools []toolDef) (*chatResult, error) {
	payload := map[string]any{"messages": messages, "temperature": 0.8}
	if len(tools) > 0 {
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
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
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.cfg.BackendURL+"/api/v1/agent-runner/llm/chat/completions", bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+b.cfg.RunnerToken)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Agent-Run-ID", fmt.Sprint(runID))
		resp, err := b.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			var envelope struct {
				Message string `json:"message"`
			}
			_ = json.Unmarshal(body, &envelope)
			if strings.HasPrefix(envelope.Message, "agent_") {
				return nil, fmt.Errorf("%w: %s", errBudget, envelope.Message)
			}
			lastErr = fmt.Errorf("llm status 429")
			continue
		}
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("llm status %d: %s", resp.StatusCode, clip(string(body), 200))
			continue
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("llm status %d: %s", resp.StatusCode, clip(string(body), 300))
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
