package llmclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/tools"
)

const visionUnsupportedTTL = 6 * time.Hour // 模型拒收图片后多久内不再发送（之后再试一次，换了模型或接口立即生效）

var (
	// reasoningEffortUnsupported 不支持 reasoning_effort 参数（带上时返回 400）的接口与模型，之后不再携带
	reasoningEffortUnsupported sync.Map
	// streamUsageUnsupported 不接受 stream_options（带上时返回 400）的接口与模型，之后不再携带
	streamUsageUnsupported sync.Map
	// visionUnsupported 拒收过图片的接口与模型 → 拒收时间
	visionUnsupported sync.Map

	// defaultHTTPClient 复用的无固定总超时客户端（每次调用由上游通过 ctx 控制超时）
	defaultHTTPClient = &http.Client{}
)

// StatusError 接口返回非 200：状态码与少量响应内容
type StatusError struct {
	Code    int
	Message string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("status %d: %s", e.Code, e.Message)
}

// Usage 一次调用的 token 用量（取自上游响应的 usage）
type Usage struct {
	Prompt     int // 输入（含命中缓存的部分）
	Cached     int // 输入中命中缓存的
	CacheWrite int // 写入缓存的
	Completion int // 输出
}

// OpenAIUsage OpenAI 兼容响应（含流式的最后一块）中的 usage
type OpenAIUsage struct {
	PromptTokens        int `json:"prompt_tokens"`
	CompletionTokens    int `json:"completion_tokens"`
	PromptTokensDetails struct {
		CachedTokens     int `json:"cached_tokens"`
		CacheWriteTokens int `json:"cache_write_tokens"` // OpenRouter 等的写法
	} `json:"prompt_tokens_details"`
	PromptCacheHitTokens     int `json:"prompt_cache_hit_tokens"`     // DeepSeek 等的写法
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`     // Anthropic 兼容接口的写法
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"` // Anthropic 兼容接口的写法
}

func (u OpenAIUsage) Detail() Usage {
	return Usage{
		Prompt:     u.PromptTokens,
		Cached:     max(u.PromptTokensDetails.CachedTokens, u.PromptCacheHitTokens, u.CacheReadInputTokens),
		CacheWrite: max(u.PromptTokensDetails.CacheWriteTokens, u.CacheCreationInputTokens),
		Completion: u.CompletionTokens,
	}
}

// ParseUsageDetail 从非流式响应中读取用量（含缓存读写，接口返回时才有）
func ParseUsageDetail(data []byte) Usage {
	var resp struct {
		Usage OpenAIUsage `json:"usage"`
	}
	_ = json.Unmarshal(data, &resp)
	return resp.Usage.Detail()
}

// ParseUsage 从 OpenAI 兼容响应中读取用量：输入、其中命中缓存的、输出 token
func ParseUsage(data []byte) (prompt, cached, completion int) {
	u := ParseUsageDetail(data)
	return u.Prompt, u.Cached, u.Completion
}

// VisionImage 已读取、可以发给模型的图片
type VisionImage struct {
	Index   int    // 对应正文中第几张图（从 1 开始）
	Alt     string // 替代文本
	DataURL string // data:<mime>;base64,...
	Size    int    // 原始字节数
}

// VisionContentParts 用户消息的内容块：正文文本在前，每张图片前加一个 [图N] 标签。
// 没有图片时直接返回文本（content 保持字符串，与不识图时的请求完全一致）
func VisionContentParts(text string, images []VisionImage) any {
	if len(images) == 0 {
		return text
	}
	parts := make([]map[string]any, 0, 1+2*len(images))
	parts = append(parts, map[string]any{"type": "text", "text": text})
	for _, img := range images {
		parts = append(parts,
			map[string]any{"type": "text", "text": fmt.Sprintf("[图%d]", img.Index)},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": img.DataURL}},
		)
	}
	return parts
}

func modelEndpointKey(baseURL, model string) string {
	return baseURL + "\x00" + model
}

// VisionUsable 该接口与模型最近没有拒收过图片
func VisionUsable(baseURL, model string) bool {
	key := modelEndpointKey(baseURL, model)
	v, ok := visionUnsupported.Load(key)
	if !ok {
		return true
	}
	if at, _ := v.(time.Time); time.Since(at) < visionUnsupportedTTL {
		return false
	}
	visionUnsupported.Delete(key)
	return true
}

// MarkVisionUnsupported 记住该接口与模型暂不支持图片
func MarkVisionUnsupported(baseURL, model string) {
	visionUnsupported.Store(modelEndpointKey(baseURL, model), time.Now())
}

// ResetVisionUnsupported 清除该接口与模型的拒收图片记录（测试辅助）
func ResetVisionUnsupported(baseURL, model string) {
	visionUnsupported.Delete(modelEndpointKey(baseURL, model))
}

// VisionAvailable 已开启识图，且该模型最近没有拒收过图片
func VisionAvailable(baseURL, model string) bool {
	return tools.GetAIVisionEnabled() && VisionUsable(baseURL, model)
}

type visionFallbackKey struct{}

// WithVisionFallbackNotice 在 ctx 上挂一个回调：本该附带的图片没有发出（模型拒收后按纯文本重试、或已知模型不支持）时调用
func WithVisionFallbackNotice(ctx context.Context, fn func(reason string)) context.Context {
	return context.WithValue(ctx, visionFallbackKey{}, fn)
}

// NotifyVisionFallback 触发挂在 ctx 上的识图降级回调
func NotifyVisionFallback(ctx context.Context, reason string) {
	if fn, ok := ctx.Value(visionFallbackKey{}).(func(string)); ok && fn != nil {
		fn(reason)
	}
}

func imageRejectedStatus(code int) bool {
	return code == http.StatusBadRequest || code == http.StatusRequestEntityTooLarge ||
		code == http.StatusUnsupportedMediaType || code == http.StatusUnprocessableEntity
}

func payloadHasImages(payload map[string]any) bool {
	data, err := json.Marshal(payload["messages"])
	return err == nil && strings.Contains(string(data), `"type":"image_url"`)
}

func payloadWithoutImages(payload map[string]any) map[string]any {
	out := maps.Clone(payload)
	data, err := json.Marshal(payload["messages"])
	if err != nil {
		return out
	}
	var messages []map[string]any
	if json.Unmarshal(data, &messages) != nil {
		return out
	}
	for _, msg := range messages {
		parts, ok := msg["content"].([]any)
		if !ok {
			continue
		}
		var texts []string
		for i, p := range parts {
			part, _ := p.(map[string]any)
			if part["type"] != "text" {
				continue
			}
			// 紧挨着图片前面的文字块是该图片的标签
			if i+1 < len(parts) {
				if next, _ := parts[i+1].(map[string]any); next["type"] == "image_url" {
					continue
				}
			}
			if text, ok := part["text"].(string); ok {
				texts = append(texts, text)
			}
		}
		msg["content"] = strings.Join(texts, "\n\n")
	}
	out["messages"] = messages
	return out
}

// ChatMessages 构建基础 system + user 消息对
func ChatMessages(system, user string) []map[string]string {
	return []map[string]string{
		{"role": "system", "content": system},
		{"role": "user", "content": user},
	}
}

// ChatMessagesWithImages 构建带可选图片内容块的 system + user 消息对
func ChatMessagesWithImages(system, user string, images []VisionImage) []map[string]any {
	return []map[string]any{
		{"role": "system", "content": system},
		{"role": "user", "content": VisionContentParts(user, images)},
	}
}

// PostChatCompletions 发送请求到 OpenAI 兼容的 /chat/completions 接口，非 200 时返回 *StatusError；成功时由调用方关闭响应体
func PostChatCompletions(ctx context.Context, cfg tools.AIConfig, payload map[string]any) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	endpoint := cfg.BaseURL
	if !strings.HasSuffix(endpoint, "/chat/completions") {
		endpoint += "/chat/completions"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	resp, err := defaultHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		msg := strings.TrimSpace(string(data))
		if r := []rune(msg); len(r) > 200 {
			msg = string(r[:200])
		}
		return nil, &StatusError{Code: resp.StatusCode, Message: msg}
	}
	return resp, nil
}

// PostChatCompletionsVision 同 PostChatCompletions，请求带图片时处理识图降级：
// 未开启识图或该模型最近拒收过图片时直接去掉图片；接口以 400 等拒收时去掉图片按纯文本重试一次并记住该模型不支持
func PostChatCompletionsVision(ctx context.Context, cfg tools.AIConfig, payload map[string]any) (*http.Response, error) {
	if !payloadHasImages(payload) {
		return PostChatCompletions(ctx, cfg, payload)
	}
	if !VisionAvailable(cfg.BaseURL, cfg.Model) {
		NotifyVisionFallback(ctx, "vision is disabled or the model recently rejected images")
		return PostChatCompletions(ctx, cfg, payloadWithoutImages(payload))
	}
	resp, err := PostChatCompletions(ctx, cfg, payload)
	var statusErr *StatusError
	if !(errors.As(err, &statusErr) && imageRejectedStatus(statusErr.Code)) {
		return resp, err
	}
	logrus.Warnf("chat completion (model %s) rejected images, retrying as plain text: %v", cfg.Model, err)
	NotifyVisionFallback(ctx, "the model rejected images: "+err.Error())
	resp, err = PostChatCompletions(ctx, cfg, payloadWithoutImages(payload))
	if err == nil {
		MarkVisionUnsupported(cfg.BaseURL, cfg.Model)
	}
	return resp, err
}

// ChatCompletionRawCall 发送非流式请求并返回响应字节；不支持 reasoning_effort 时自动回退重试一次，拒收图片时自动退回纯文本重试一次
func ChatCompletionRawCall(ctx context.Context, cfg tools.AIConfig, system, user string, images []VisionImage, temperature float64, effort string) ([]byte, error) {
	payload := map[string]any{
		"model":       cfg.Model,
		"messages":    ChatMessagesWithImages(system, user, images),
		"temperature": temperature,
		"stream":      false,
	}
	key := modelEndpointKey(cfg.BaseURL, cfg.Model)
	if _, unsupported := reasoningEffortUnsupported.Load(key); effort != "" && !unsupported {
		payload["reasoning_effort"] = effort
	}
	resp, err := PostChatCompletionsVision(ctx, cfg, payload)
	var statusErr *StatusError
	if _, sent := payload["reasoning_effort"]; sent && errors.As(err, &statusErr) && statusErr.Code == http.StatusBadRequest {
		logrus.Warnf("chat completion rejected reasoning_effort, retrying without it: %v", err)
		reasoningEffortUnsupported.Store(key, true)
		delete(payload, "reasoning_effort")
		resp, err = PostChatCompletionsVision(ctx, cfg, payload)
	}
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

// ParseChatCompletion 解析非流式响应，取第一个候选的内容
func ParseChatCompletion(data []byte) (string, error) {
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", fmt.Errorf("invalid response: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", errors.New("empty choices")
	}
	return result.Choices[0].Message.Content, nil
}

// ChatCompletionStreamCall 以 stream: true 调用 OpenAI 兼容接口（含 stream_options 400 自动降级与非流式 JSON 兼容）
func ChatCompletionStreamCall(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content, reasoning string) error) (Usage, error) {
	payload := map[string]any{
		"model":    cfg.Model,
		"messages": ChatMessages(system, user),
		"stream":   true,
	}
	key := modelEndpointKey(cfg.BaseURL, cfg.Model)
	if _, unsupported := streamUsageUnsupported.Load(key); !unsupported {
		payload["stream_options"] = map[string]any{"include_usage": true}
	}
	resp, err := PostChatCompletions(ctx, cfg, payload)
	var statusErr *StatusError
	if _, sent := payload["stream_options"]; sent && errors.As(err, &statusErr) && statusErr.Code == http.StatusBadRequest {
		logrus.Warnf("chat completion stream rejected stream_options, retrying without it: %v", err)
		streamUsageUnsupported.Store(key, true)
		delete(payload, "stream_options")
		resp, err = PostChatCompletions(ctx, cfg, payload)
	}
	if err != nil {
		return Usage{}, err
	}
	defer resp.Body.Close()
	// 少数兼容接口忽略 stream 参数直接返回完整 JSON，按非流式结果处理
	if strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return Usage{}, err
		}
		usage := ParseUsageDetail(data)
		content, err := ParseChatCompletion(data)
		if err != nil {
			return usage, err
		}
		return usage, onChunk(content, "")
	}
	var usage Usage
	err = ParseChatStreamUsage(resp.Body, onChunk, func(u Usage) { usage = u })
	return usage, err
}

// ParseChatStream 解析 SSE 流：逐行读取 data 行，遇到 [DONE] 或流结束时返回
func ParseChatStream(r io.Reader, onChunk func(content, reasoning string) error) error {
	return ParseChatStreamUsage(r, onChunk, nil)
}

// ParseChatStreamUsage 同 ParseChatStream，带 usage 的块（通常是最后一块，choices 为空）交给 onUsage
func ParseChatStreamUsage(r io.Reader, onChunk func(content, reasoning string) error, onUsage func(Usage)) error {
	reader := bufio.NewReader(r)
	for {
		line, readErr := reader.ReadString('\n')
		line = strings.TrimSpace(line)
		if data, ok := strings.CutPrefix(line, "data:"); ok {
			data = strings.TrimSpace(data)
			if data == "[DONE]" {
				return nil
			}
			var chunk struct {
				Choices []struct {
					Delta struct {
						Content          string `json:"content"`
						ReasoningContent string `json:"reasoning_content"`
						Reasoning        string `json:"reasoning"`
					} `json:"delta"`
				} `json:"choices"`
				Usage *OpenAIUsage `json:"usage"`
				Error *struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				return fmt.Errorf("invalid stream chunk: %w", err)
			}
			if chunk.Error != nil {
				return fmt.Errorf("upstream error: %s", chunk.Error.Message)
			}
			if chunk.Usage != nil && onUsage != nil {
				onUsage(chunk.Usage.Detail())
			}
			if len(chunk.Choices) > 0 {
				delta := chunk.Choices[0].Delta
				reasoning := delta.ReasoningContent + delta.Reasoning
				if delta.Content != "" || reasoning != "" {
					if err := onChunk(delta.Content, reasoning); err != nil {
						return err
					}
				}
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return readErr
		}
	}
}
