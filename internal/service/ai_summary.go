package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

const (
	aiSummaryStatusIdle      = "idle"
	aiSummaryStatusQueued    = "queued" // 等待并发名额
	aiSummaryStatusRunning   = "running"
	aiSummaryStatusSucceeded = "succeeded"
	aiSummaryStatusFailed    = "failed"

	aiSummaryTimeout            = 2 * time.Minute
	aiSummaryMaxInputRunes      = 12000 // 送给模型的正文上限，超出部分保留开头与结尾
	aiSummaryMaxOutputRune      = 320   // 中文摘要最长字数（提示词要求 140～220 字），超出视为模型未遵守约束并截断
	aiSummaryMaxOutputRuneLatin = 1000  // 英文摘要最长字符数（提示词要求 80～130 词）
)

// aiSummaryJob 单篇文章的生成任务状态（进程内）
type aiSummaryJob struct {
	status string
	err    string
}

// active 排队或生成中
func (j *aiSummaryJob) active() bool {
	return j.status == aiSummaryStatusQueued || j.status == aiSummaryStatusRunning
}

// aiLimiter 限制同时调用模型的请求数（AI 摘要与 AI 写作共用），上限每次获取时读取，修改配置后立即生效
// 交互式的 AI 写作以优先级获取名额：有优先请求在等待时，后台摘要任务让出空闲名额，避免写作排在整批摘要之后
type aiLimiter struct {
	mu              sync.Mutex
	running         int
	priorityWaiting int           // 正在等待的优先请求数
	wake            chan struct{} // 有名额释放时关闭，唤醒所有等待者重新竞争
}

// aiCallLimiter 全局共用的模型调用限制器
var aiCallLimiter = &aiLimiter{}

// acquire 获取名额；首次需要等待时调用 onWait（可为 nil），ctx 取消时放弃等待并返回错误
func (l *aiLimiter) acquire(ctx context.Context, limit func() int, priority bool, onWait func()) error {
	waiting := false
	for {
		l.mu.Lock()
		if l.running < limit() && (priority || l.priorityWaiting == 0) {
			l.running++
			if waiting && priority {
				l.priorityWaiting--
				l.broadcastLocked()
			}
			l.mu.Unlock()
			return nil
		}
		if !waiting {
			waiting = true
			if priority {
				l.priorityWaiting++
			}
			if onWait != nil {
				onWait()
			}
		}
		if l.wake == nil {
			l.wake = make(chan struct{})
		}
		wake := l.wake
		l.mu.Unlock()
		select {
		case <-wake:
		case <-ctx.Done():
			if priority {
				l.mu.Lock()
				l.priorityWaiting--
				l.broadcastLocked()
				l.mu.Unlock()
			}
			return ctx.Err()
		}
	}
}

func (l *aiLimiter) release() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.running--
	l.broadcastLocked()
}

// broadcastLocked 唤醒所有等待者，调用方需持有锁
func (l *aiLimiter) broadcastLocked() {
	if l.wake != nil {
		close(l.wake)
		l.wake = nil
	}
}

// AISummaryService 文章 AI 摘要：后台任务生成，同一文章同时只允许一个任务，全局按配置限制并发
type AISummaryService struct {
	mu      sync.Mutex
	jobs    map[uint]*aiSummaryJob
	limiter *aiLimiter
	// complete 调用大模型，测试时可替换
	complete func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	// concurrency 读取并发上限，测试时可替换
	concurrency func() int
}

var aiSummaryService = &AISummaryService{
	jobs:        make(map[uint]*aiSummaryJob),
	limiter:     aiCallLimiter,
	complete:    chatCompletion,
	concurrency: tools.GetAISummaryConcurrency,
}

func NewAISummaryService() *AISummaryService {
	return aiSummaryService
}

// checkPostEditable 只有文章作者或管理员可以生成摘要
func (s *AISummaryService) loadEditablePost(ctx context.Context, postID uint) (*model.Post, *errs.ServiceError) {
	post, err := repo.Post.GetPostByID(postID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	return post, nil
}

// Status 查询生成状态
func (s *AISummaryService) Status(ctx context.Context, postID uint) (*dto.AISummaryStatusDto, *errs.ServiceError) {
	// 先取任务状态再读文章：任务在两次读取之间完成时，读到的文章已是最新摘要，不会出现「已完成但摘要为空」
	status, errMsg := s.jobStatus(postID)
	post, svcerr := s.loadEditablePost(ctx, postID)
	if svcerr != nil {
		return nil, svcerr
	}
	return &dto.AISummaryStatusDto{
		Status:      status,
		Error:       errMsg,
		Description: post.Description,
		Stale:       post.AISummaryStale(),
		GeneratedAt: post.AISummaryAt,
		Configured:  tools.GetAIConfig().Configured(),
	}, nil
}

func (s *AISummaryService) jobStatus(postID uint) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if job, ok := s.jobs[postID]; ok {
		return job.status, job.err
	}
	return aiSummaryStatusIdle, ""
}

// FillListStatus 为列表中的文章补充正在进行或失败的任务状态
func (s *AISummaryService) FillListStatus(posts []*dto.PostDto) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, post := range posts {
		if job, ok := s.jobs[post.ID]; ok && (job.active() || job.status == aiSummaryStatusFailed) {
			post.AISummaryStatus = job.status
			post.AISummaryError = job.err
		}
	}
}

// Trigger 创建生成任务，后台执行；同一文章已有任务在进行时拒绝
func (s *AISummaryService) Trigger(ctx context.Context, postID uint) *errs.ServiceError {
	post, svcerr := s.loadEditablePost(ctx, postID)
	if svcerr != nil {
		return svcerr
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return errs.NewBadRequest("ai_not_configured")
	}
	if strings.TrimSpace(htmlToPlainText(post.Content)) == "" {
		return errs.NewBadRequest("ai_summary_empty_content")
	}

	if !s.enqueue(post, cfg) {
		return errs.NewConflict("ai_summary_running")
	}
	return nil
}

// TriggerAll 为全站文章创建摘要任务（仅管理员）：跳过正文为空、已在进行、摘要已是最新的文章，
// 默认也跳过手动填写的描述，避免覆盖作者自己写的内容
func (s *AISummaryService) TriggerAll(ctx context.Context, overwriteManual bool) (*dto.BatchAISummaryResultDto, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewBadRequest("ai_not_configured")
	}
	posts, err := repo.Post.ListPostsForAISummary()
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := &dto.BatchAISummaryResultDto{}
	for i := range posts {
		post := &posts[i]
		switch {
		case strings.TrimSpace(htmlToPlainText(post.Content)) == "":
			result.SkippedEmpty++
		case post.AISummary != "" && post.AISummarySourceHash == model.HashContent(post.Content):
			result.SkippedUpToDate++
		case !overwriteManual && post.Description != "" && post.Description != post.AISummary:
			result.SkippedManual++
		case !s.enqueue(post, cfg):
			result.SkippedRunning++
		default:
			result.Queued++
		}
	}
	return result, nil
}

// enqueue 登记任务并在后台执行；该文章已有任务在排队或生成中时返回 false
func (s *AISummaryService) enqueue(post *model.Post, cfg tools.AIConfig) bool {
	s.mu.Lock()
	if job, ok := s.jobs[post.ID]; ok && job.active() {
		s.mu.Unlock()
		return false
	}
	s.jobs[post.ID] = &aiSummaryJob{status: aiSummaryStatusQueued}
	s.mu.Unlock()

	// 以触发时的正文为准，生成期间正文再被修改会在完成后显示为「需要重新生成」
	go s.run(post.ID, cfg, post.Title, post.Content, model.HashContent(post.Content))
	return true
}

func (s *AISummaryService) finish(postID uint, status, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[postID] = &aiSummaryJob{status: status, err: errMsg}
}

func (s *AISummaryService) run(postID uint, cfg tools.AIConfig, title, content, sourceHash string) {
	// 排队等待并发名额，拿到后才开始计算超时
	_ = s.limiter.acquire(context.Background(), s.concurrency, false, nil)
	defer s.limiter.release()
	s.finish(postID, aiSummaryStatusRunning, "")

	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("ai summary panic for post %d: %v", postID, r)
			s.finish(postID, aiSummaryStatusFailed, "internal_error")
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), aiSummaryTimeout)
	defer cancel()

	// 少数模型偶尔返回空内容（或只有思考过程），空结果时重试一次
	var summary string
	for attempt := 0; attempt < 2 && summary == ""; attempt++ {
		raw, err := s.complete(ctx, cfg, aiSummarySystemPrompt, buildAISummaryUserPrompt(title, content))
		if err != nil {
			logrus.Warnf("ai summary failed for post %d: %v", postID, err)
			s.finish(postID, aiSummaryStatusFailed, err.Error())
			return
		}
		summary = normalizeAISummary(raw)
	}
	if summary == "" {
		s.finish(postID, aiSummaryStatusFailed, "empty_response")
		return
	}
	now := time.Now()
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", postID).UpdateColumns(map[string]any{
		"description":            summary,
		"ai_summary":             summary,
		"ai_summary_source_hash": sourceHash,
		"ai_summary_at":          now,
	}).Error; err != nil {
		logrus.Errorf("save ai summary failed for post %d: %v", postID, err)
		s.finish(postID, aiSummaryStatusFailed, "failed_to_update_target")
		return
	}
	s.finish(postID, aiSummaryStatusSucceeded, "")
}

// buildAISummaryUserPrompt 用户消息：标题 + 转成纯文本（保留标题层级与代码块标记）的正文
func buildAISummaryUserPrompt(title, content string) string {
	text := htmlToPlainText(content)
	runes := []rune(text)
	if len(runes) > aiSummaryMaxInputRunes {
		head := aiSummaryMaxInputRunes * 3 / 4
		tail := aiSummaryMaxInputRunes - head
		text = string(runes[:head]) + "\n\n……（中间部分省略）……\n\n" + string(runes[len(runes)-tail:])
	}
	return fmt.Sprintf("文章标题：%s\n\n文章正文：\n%s", title, text)
}

var (
	reHeading    = regexp.MustCompile(`(?is)<h([1-6])[^>]*>(.*?)</h[1-6]>`)
	rePre        = regexp.MustCompile(`(?is)<pre[^>]*>(.*?)</pre>`)
	reBlockBreak = regexp.MustCompile(`(?i)<(br|/p|/li|/blockquote|/h[1-6]|/figcaption|/tr)[^>]*>`)
	reTableCell  = regexp.MustCompile(`(?i)</t[dh]>`)
	reListItem   = regexp.MustCompile(`(?i)<li[^>]*>`)
	reTag        = regexp.MustCompile(`(?s)<[^>]+>`)
	reBlankLines = regexp.MustCompile(`\n{3,}`)
)

// htmlToPlainText 把正文 HTML 转为便于模型理解的纯文本
func htmlToPlainText(content string) string {
	text := reHeading.ReplaceAllStringFunc(content, func(m string) string {
		sub := reHeading.FindStringSubmatch(m)
		level := int(sub[1][0] - '0')
		return "\n" + strings.Repeat("#", level) + " " + reTag.ReplaceAllString(sub[2], "") + "\n"
	})
	text = rePre.ReplaceAllStringFunc(text, func(m string) string {
		return "\n```\n" + reTag.ReplaceAllString(rePre.FindStringSubmatch(m)[1], "") + "\n```\n"
	})
	text = reTableCell.ReplaceAllString(text, " | ")
	text = reBlockBreak.ReplaceAllString(text, "\n")
	text = reListItem.ReplaceAllString(text, "- ")
	text = reTag.ReplaceAllString(text, "")
	text = html.UnescapeString(text)
	return strings.TrimSpace(reBlankLines.ReplaceAllString(text, "\n\n"))
}

var (
	reHeadingLine   = regexp.MustCompile(`(?m)^\s{0,3}#{1,6}\s+.*$`)
	reSummaryPrefix = regexp.MustCompile(`^(摘要|简介|总结|Summary)\s*[:：]\s*`)
	reListMarker    = regexp.MustCompile(`(?m)^\s*([-*+]|\d+\.)\s+`)
	reMarkdownLink  = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
)

// normalizeAISummary 清理模型输出：去掉包裹的引号、思考标签、标题与列表标记，合并为单段并限制长度
func normalizeAISummary(raw string) string {
	text := strings.TrimSpace(raw)
	// 部分推理模型会把思考过程放在 <think> 标签里
	if i := strings.LastIndex(text, "</think>"); i >= 0 {
		text = strings.TrimSpace(text[i+len("</think>"):])
	}
	text = strings.TrimPrefix(text, "```markdown")
	text = strings.Trim(text, "`")
	// 摘要应为单段文字，模型多输出的标题行（如「## 摘要」）整行去掉
	text = reHeadingLine.ReplaceAllString(text, "")
	text = reListMarker.ReplaceAllString(text, "")
	text = reMarkdownLink.ReplaceAllString(text, "$1")
	text = strings.Join(strings.Fields(strings.ReplaceAll(text, "\n", " ")), " ")
	text = strings.Trim(text, "\"'“”‘’「」 ")
	text = reSummaryPrefix.ReplaceAllString(text, "")
	return truncateSummary(text)
}

// truncateSummary 超出上限时在上限内最后一个句末标点处截断，避免半句话；英文按字符数放宽上限
func truncateSummary(text string) string {
	limit := aiSummaryMaxOutputRune
	if isMostlyLatin(text) {
		limit = aiSummaryMaxOutputRuneLatin
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	cut := string(runes[:limit])
	if i := strings.LastIndexAny(cut, "。！？!?."); i > len(cut)/2 {
		_, size := utf8.DecodeRuneInString(cut[i:])
		return cut[:i+size]
	}
	return cut + "…"
}

// isMostlyLatin 以拉丁字母为主的文本（英文摘要）
func isMostlyLatin(text string) bool {
	latin, total := 0, 0
	for _, r := range text {
		if unicode.IsLetter(r) {
			total++
			if r < unicode.MaxLatin1 {
				latin++
			}
		}
	}
	return total > 0 && latin*2 > total
}

// chatCompletion 调用 OpenAI 兼容的 /chat/completions 接口（温度 0.3，偏稳定）
func chatCompletion(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
	return chatCompletionWithTemperature(ctx, cfg, system, user, 0.3)
}

// chatCompletionWithTemperature 同 chatCompletion，可指定温度（越高越有创意、越不稳定）
func chatCompletionWithTemperature(ctx context.Context, cfg tools.AIConfig, system, user string, temperature float64) (string, error) {
	resp, err := postChatCompletions(ctx, cfg, map[string]any{
		"model":       cfg.Model,
		"messages":    chatMessages(system, user),
		"temperature": temperature,
		"stream":      false,
	})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	return parseChatCompletion(data)
}

func chatMessages(system, user string) []map[string]string {
	return []map[string]string{
		{"role": "system", "content": system},
		{"role": "user", "content": user},
	}
}

// postChatCompletions 发送请求，非 200 时读取少量响应内容作为错误返回；成功时由调用方关闭响应体
func postChatCompletions(ctx context.Context, cfg tools.AIConfig, payload map[string]any) (*http.Response, error) {
	body, _ := json.Marshal(payload)
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
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		// 只截取少量响应内容，避免把整段错误页写进状态
		msg := strings.TrimSpace(string(data))
		if r := []rune(msg); len(r) > 200 {
			msg = string(r[:200])
		}
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, msg)
	}
	return resp, nil
}

// parseChatCompletion 解析非流式响应，取第一个候选的内容
func parseChatCompletion(data []byte) (string, error) {
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
