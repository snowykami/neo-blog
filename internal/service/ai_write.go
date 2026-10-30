package service

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
)

const (
	aiWriteTimeout            = 3 * time.Minute
	aiWriteHeartbeat          = 10 * time.Second // 排队、思考期间定期写出心跳，及时发现客户端断开
	aiWriteMaxDocumentBytes   = 2 << 20          // 提交的正文 HTML 上限
	aiWriteMaxInstructionRune = 1000             // 用户要求的长度上限
	aiWriteMaxSelectionRune   = 8000             // 润色选区的长度上限（需完整改写，超出直接拒绝）
	aiWriteMaxMarkupRune      = 24000            // 润色选区格式化表示的长度上限（含格式标签，约为纯文本的数倍）
	aiWriteMaxComponentsRune  = 8000             // 可用组件说明的长度上限
	aiWriteMaxContextRune     = 12000            // 插入点前后正文的总长上限，超出部分从远端截断
	aiWriteLocalContextRune   = 800              // 不附带全文时，帮写保留插入点附近的正文长度
)

// SSE 事件
const (
	AIWriteEventQueued   = "queued"   // 等待并发名额
	AIWriteEventThinking = "thinking" // 模型思考中（推理内容不转发）
	AIWriteEventDelta    = "delta"    // 生成的内容片段 {"text": "..."}
	AIWriteEventDone     = "done"     // 正常结束
	AIWriteEventError    = "error"    // 出错 {"message": "..."}
	AIWriteEventPing     = "ping"     // 心跳
)

// AIWriteJob 校验通过的生成任务
type AIWriteJob struct {
	userID uint
	cfg    tools.AIConfig
	system string
	user   string
}

// aiStreamFunc 流式调用模型，content 为正文片段，reasoning 为思考过程片段
type aiStreamFunc func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content, reasoning string) error) error

// AIWriteService 编辑器 AI 写作：流式生成，结果由前端写入编辑器，不落库
// 与 AI 摘要共用模型调用的并发限制，并优先获取名额；同一用户同时只保留最新的一次生成
type AIWriteService struct {
	mu      sync.Mutex
	running map[uint]*aiWriteRun
	limiter *aiLimiter
	// stream 流式调用模型，测试时可替换
	stream aiStreamFunc
	// concurrency 读取并发上限，测试时可替换
	concurrency func() int
	heartbeat   time.Duration
}

type aiWriteRun struct {
	cancel context.CancelFunc
}

var aiWriteService = &AIWriteService{
	running:     make(map[uint]*aiWriteRun),
	limiter:     aiCallLimiter,
	stream:      chatCompletionStream,
	concurrency: tools.GetAISummaryConcurrency,
	heartbeat:   aiWriteHeartbeat,
}

func NewAIWriteService() *AIWriteService {
	return aiWriteService
}

// Prepare 校验权限与输入并构建提示词；出错时返回 ServiceError，由控制器按普通 JSON 响应返回
func (s *AIWriteService) Prepare(ctx context.Context, targetType string, targetID uint, req *dto.AIWriteReq) (*AIWriteJob, *errs.ServiceError) {
	// 与编辑会话相同：只有作者或管理员可以编辑该文章 / 页面
	if svcerr := NewEditSessionService().checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return nil, svcerr
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewBadRequest("ai_not_configured")
	}
	if !(req.Mode == aiWriteModeWrite || req.Mode == aiWriteModeRewrite) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	// 快捷指令：平台指令或自己的个人指令，且与写作模式一致
	presetInstruction := ""
	if req.PromptID != 0 {
		prompt, svcerr := NewAIPromptService().resolve(ctx, req.PromptID, req.Mode)
		if svcerr != nil {
			return nil, svcerr
		}
		presetInstruction = prompt.Instruction
	}
	scope := req.Scope
	if scope != aiWriteScopeInline && scope != aiWriteScopeCode {
		scope = aiWriteScopeBlock
	}
	if utf8.RuneCountInString(req.Instruction) > aiWriteMaxInstructionRune || len(req.Document) > aiWriteMaxDocumentBytes {
		return nil, errs.NewBadRequest("ai_input_too_long")
	}
	before, selection, after, ok := splitAIWriteDocument(htmlToPlainText(req.Document), req.Mode)
	if !ok {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	structured := false
	if req.Mode == aiWriteModeRewrite {
		selection = strings.TrimSpace(selection)
		if selection == "" {
			return nil, errs.NewBadRequest("ai_write_empty_selection")
		}
		if utf8.RuneCountInString(selection) > aiWriteMaxSelectionRune {
			return nil, errs.NewBadRequest("ai_input_too_long")
		}
		// 前端提供了带格式的选区时原样使用，模型才能看到并保留粗体、链接、颜色等格式；代码块内仍用纯文本
		if markup := strings.TrimSpace(req.Selection); markup != "" && scope != aiWriteScopeCode {
			if utf8.RuneCountInString(markup) > aiWriteMaxMarkupRune {
				return nil, errs.NewBadRequest("ai_input_too_long")
			}
			selection = markup
			structured = true
		}
	}
	// 可用组件说明只用于独立成块的帮写：润色保持原有结构，段落中间与代码块内无法放置组件
	components := ""
	if req.Mode == aiWriteModeWrite && scope == aiWriteScopeBlock {
		components = strings.TrimSpace(req.Components)
		if utf8.RuneCountInString(components) > aiWriteMaxComponentsRune {
			return nil, errs.NewBadRequest("ai_input_too_long")
		}
	}
	switch {
	case req.IncludeContext:
		before, after = truncateAIWriteContext(before, after, aiWriteMaxContextRune)
	case req.Mode == aiWriteModeRewrite:
		// 不附带全文：润色只看选中内容
		before, after = "", ""
	default:
		// 不附带全文：帮写仍需知道插入点位置，只保留附近的片段
		before, after = truncateAIWriteContext(before, after, aiWriteLocalContextRune)
	}
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	prompt := &aiWritePrompt{
		targetType:  targetType,
		mode:        req.Mode,
		scope:       scope,
		preset:      presetInstruction,
		instruction: req.Instruction,
		title:       req.Title,
		description: req.Description,
		category:    req.Category,
		labels:      req.Labels,
		before:      before,
		after:       after,
		selection:   selection,
		structured:  structured,
		noContext:   !req.IncludeContext,
		components:  components,
	}
	return &AIWriteJob{userID: userID, cfg: cfg, system: aiWriteSystemPromptWithStyle(tools.GetAIWritingStyle()), user: prompt.build()}, nil
}

// register 登记当前用户的生成并取消其上一次未结束的生成；返回的函数用于结束时注销
func (s *AIWriteService) register(userID uint, cancel context.CancelFunc) func() {
	run := &aiWriteRun{cancel: cancel}
	s.mu.Lock()
	if prev, ok := s.running[userID]; ok {
		prev.cancel()
	}
	s.running[userID] = run
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		if s.running[userID] == run {
			delete(s.running, userID)
		}
		s.mu.Unlock()
	}
}

// Stream 执行生成并通过 emit 逐个推送事件；emit 返回错误（客户端断开）时取消生成
func (s *AIWriteService) Stream(ctx context.Context, job *AIWriteJob, emit func(event string, data any) error) {
	ctx, cancel := context.WithTimeout(ctx, aiWriteTimeout)
	defer cancel()
	defer s.register(job.userID, cancel)()

	var mu sync.Mutex
	send := func(event string, data any) error {
		mu.Lock()
		defer mu.Unlock()
		if err := emit(event, data); err != nil {
			cancel()
			return err
		}
		return nil
	}
	// 心跳协程在返回前退出，避免请求结束后仍写响应
	stop, stopped := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(s.heartbeat)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = send(AIWriteEventPing, nil)
			}
		}
	}()
	defer func() {
		close(stop)
		<-stopped
	}()

	if err := s.limiter.acquire(ctx, s.concurrency, true, func() { _ = send(AIWriteEventQueued, nil) }); err != nil {
		s.fail(ctx, send, err)
		return
	}
	defer s.limiter.release()

	filter := &thinkTagFilter{}
	thinking := false
	produced := false
	forward := func(text string) error {
		if text == "" {
			return nil
		}
		produced = true
		return send(AIWriteEventDelta, map[string]string{"text": text})
	}
	err := s.stream(ctx, job.cfg, job.system, job.user, func(content, reasoning string) error {
		text, inThink := filter.push(content)
		if (reasoning != "" || inThink) && !thinking && !produced {
			thinking = true
			if err := send(AIWriteEventThinking, nil); err != nil {
				return err
			}
		}
		return forward(text)
	})
	if err == nil {
		err = forward(filter.flush())
	}
	if err != nil {
		s.fail(ctx, send, err)
		return
	}
	if !produced {
		_ = send(AIWriteEventError, map[string]string{"message": "ai_empty_response"})
		return
	}
	_ = send(AIWriteEventDone, nil)
}

// fail 推送错误事件；客户端断开或被新的生成取代时不再推送
func (s *AIWriteService) fail(ctx context.Context, send func(string, any) error, err error) {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		_ = send(AIWriteEventError, map[string]string{"message": "ai_timeout"})
		return
	}
	if ctx.Err() != nil {
		return
	}
	logrus.Warnf("ai write failed: %v", err)
	_ = send(AIWriteEventError, map[string]string{"message": err.Error()})
}

// chatCompletionStream 以 stream: true 调用 OpenAI 兼容接口
// 不发送 temperature 等采样参数，使用模型默认值，兼容不接受自定义采样参数的模型
func chatCompletionStream(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content, reasoning string) error) error {
	resp, err := postChatCompletions(ctx, cfg, map[string]any{
		"model":    cfg.Model,
		"messages": chatMessages(system, user),
		"stream":   true,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// 少数兼容接口忽略 stream 参数直接返回完整 JSON，按非流式结果处理
	if strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return err
		}
		content, err := parseChatCompletion(data)
		if err != nil {
			return err
		}
		return onChunk(content, "")
	}
	return parseChatStream(resp.Body, onChunk)
}

// parseChatStream 解析 SSE 流：逐行读取 data 行，遇到 [DONE] 或流结束时返回
// reasoning_content（DeepSeek 等）/ reasoning（部分兼容实现）只作为思考信号，不并入正文
func parseChatStream(r io.Reader, onChunk func(content, reasoning string) error) error {
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

const (
	thinkOpenTag  = "<think>"
	thinkCloseTag = "</think>"
)

// thinkTagFilter 去掉部分推理模型放在正文开头的 <think>…</think> 思考过程，并去掉正文开头的空白
type thinkTagFilter struct {
	state int // 0 未确定 / 1 思考中 / 2 正文
	buf   string
}

// push 输入一个片段，返回可以输出的正文以及当前是否处于思考过程中
func (f *thinkTagFilter) push(s string) (string, bool) {
	switch f.state {
	case 0:
		f.buf += s
		trimmed := strings.TrimLeft(f.buf, " \t\r\n")
		switch {
		case trimmed == "":
			return "", false
		case strings.HasPrefix(trimmed, thinkOpenTag):
			f.state, f.buf = 1, ""
			return f.push(trimmed[len(thinkOpenTag):])
		case strings.HasPrefix(thinkOpenTag, trimmed):
			// 可能是被拆开的 <think> 标签，继续等待
			return "", false
		default:
			f.state, f.buf = 2, ""
			return trimmed, false
		}
	case 1:
		f.buf += s
		if _, rest, found := strings.Cut(f.buf, thinkCloseTag); found {
			f.state, f.buf = 0, ""
			text, _ := f.push(rest)
			return text, false
		}
		// 只保留可能是被拆开的结束标签的尾部
		if keep := len(thinkCloseTag) - 1; len(f.buf) > keep {
			f.buf = f.buf[len(f.buf)-keep:]
		}
		return "", true
	default:
		return s, false
	}
}

// flush 流结束时输出仍在缓冲中的正文（未闭合的思考过程丢弃）
func (f *thinkTagFilter) flush() string {
	if f.state == 0 {
		text := strings.TrimLeft(f.buf, " \t\r\n")
		f.buf = ""
		return text
	}
	return ""
}
