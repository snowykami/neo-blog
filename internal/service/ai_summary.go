package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
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

// 任务状态存在共享状态中，多实例部署时在任一实例触发、在另一实例查询都能看到：
// 排队或生成中的状态由执行任务的实例定期续期，实例退出后最多 aiSummaryActiveTTL 即消失；
// 登记后到完成前任务一直留在待办中，执行的实例中途退出（如滚动更新）时，由定时任务 ResumePending 在其他实例上重新排队
const (
	aiSummaryActiveTTL        = 2 * time.Minute
	aiSummaryHeartbeat        = 30 * time.Second
	aiSummaryResultTTL        = 24 * time.Hour // 最近一次结果（成功或失败）保留时长
	aiSummaryPendingTTL       = 24 * time.Hour // 待办保留时长，超过仍未完成的不再自动恢复
	aiSummaryActiveKeyPrefix  = "ai_summary:active:"
	aiSummaryResultKeyPrefix  = "ai_summary:result:"
	aiSummaryPendingKeyPrefix = "ai_summary:pending:"
)

// aiSummaryJob 单篇文章的生成任务状态
type aiSummaryJob struct {
	Status string `json:"status"`
	Err    string `json:"err,omitempty"`
	// VisionFallback 开启了识图，但模型拒收图片（或已知不支持），本次按纯文本生成
	VisionFallback bool `json:"vision_fallback,omitempty"`
}

// active 排队或生成中
func (j aiSummaryJob) active() bool {
	return j.Status == aiSummaryStatusQueued || j.Status == aiSummaryStatusRunning
}

func aiSummaryActiveKey(postID uint) string {
	return aiSummaryActiveKeyPrefix + strconv.FormatUint(uint64(postID), 10)
}

func aiSummaryResultKey(postID uint) string {
	return aiSummaryResultKeyPrefix + strconv.FormatUint(uint64(postID), 10)
}

func aiSummaryPendingKey(postID uint) string {
	return aiSummaryPendingKeyPrefix + strconv.FormatUint(uint64(postID), 10)
}

// aiSummaryTracker 执行任务的实例用它更新状态并定期续期，结束时写入结果
type aiSummaryTracker struct {
	postID         uint
	mu             sync.Mutex
	status         string
	visionFallback bool
	done           bool
	stop           chan struct{}
}

func startAISummaryTracker(postID uint) *aiSummaryTracker {
	t := &aiSummaryTracker{postID: postID, status: aiSummaryStatusQueued, stop: make(chan struct{})}
	go t.heartbeat()
	return t
}

func (t *aiSummaryTracker) heartbeat() {
	ticker := time.NewTicker(aiSummaryHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-t.stop:
			return
		case <-ticker.C:
			t.mu.Lock()
			if !t.done {
				t.saveActiveLocked()
			}
			t.mu.Unlock()
		}
	}
}

func (t *aiSummaryTracker) saveActiveLocked() {
	if err := sharedstate.SetJSON(aiSummaryActiveKey(t.postID), aiSummaryJob{Status: t.status}, aiSummaryActiveTTL); err != nil {
		logrus.Warnf("save ai summary status for post %d: %v", t.postID, err)
	}
}

func (t *aiSummaryTracker) setRunning() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.done {
		t.status = aiSummaryStatusRunning
		t.saveActiveLocked()
	}
}

// setVisionFallback 记下本次图片没有发给模型（已退回纯文本），写进最终结果
func (t *aiSummaryTracker) setVisionFallback() {
	t.mu.Lock()
	t.visionFallback = true
	t.mu.Unlock()
}

// finish 先写结果再删除进行中的状态，查询方不会在两者之间看到「空闲」
func (t *aiSummaryTracker) finish(status, errMsg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return
	}
	t.done = true
	close(t.stop)
	if err := sharedstate.SetJSON(aiSummaryResultKey(t.postID), aiSummaryJob{Status: status, Err: errMsg, VisionFallback: t.visionFallback}, aiSummaryResultTTL); err != nil {
		logrus.Warnf("save ai summary result for post %d: %v", t.postID, err)
	}
	if err := sharedstate.Current().Delete(aiSummaryActiveKey(t.postID), aiSummaryPendingKey(t.postID)); err != nil {
		logrus.Warnf("clear ai summary status for post %d: %v", t.postID, err)
	}
}

// AISummaryService 文章 AI 摘要：后台任务生成，同一文章同时只允许一个任务（多实例间也唯一），按配置限制并发
type AISummaryService struct {
	limiter *llmclient.Limiter
	// complete 调用大模型（images 为随正文发送的图片，未开启识图时为空），测试时可替换
	complete func(ctx context.Context, cfg tools.AIConfig, system, user string, images []VisionImage) (string, error)
	// concurrency 读取并发上限，测试时可替换
	concurrency func() int
}

var aiSummaryService = &AISummaryService{
	limiter:     llmclient.DefaultLimiter,
	complete:    aiSummaryCompletion,
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
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	return post, nil
}

// Status 查询生成状态
func (s *AISummaryService) Status(ctx context.Context, postID uint) (*dto.AISummaryStatusDto, *errs.ServiceError) {
	// 先取任务状态再读文章：任务在两次读取之间完成时，读到的文章已是最新摘要，不会出现「已完成但摘要为空」
	job := s.jobStatus(postID)
	post, svcerr := s.loadEditablePost(ctx, postID)
	if svcerr != nil {
		return nil, svcerr
	}
	return &dto.AISummaryStatusDto{
		Status:         job.Status,
		Error:          job.Err,
		VisionFallback: job.VisionFallback,
		Description:    post.Description,
		Stale:          post.AISummaryStale(),
		GeneratedAt:    post.AISummaryAt,
		Configured:     tools.GetAIConfig().Configured(),
	}, nil
}

func (s *AISummaryService) jobStatus(postID uint) aiSummaryJob {
	if job, ok := s.jobStatuses([]uint{postID})[postID]; ok {
		return job
	}
	return aiSummaryJob{Status: aiSummaryStatusIdle}
}

// jobStatuses 批量读取任务状态：排队或生成中的优先；执行的实例已退出、等待其他实例接手的待办视为排队；其次是最近一次的结果。
// 没有记录的文章不在结果中
func (s *AISummaryService) jobStatuses(postIDs []uint) map[uint]aiSummaryJob {
	keys := make([]string, 0, 3*len(postIDs))
	for _, id := range postIDs {
		keys = append(keys, aiSummaryActiveKey(id), aiSummaryPendingKey(id), aiSummaryResultKey(id))
	}
	values, err := sharedstate.Current().GetMany(keys...)
	if err != nil {
		logrus.Warnf("read ai summary status: %v", err)
		return nil
	}
	result := make(map[uint]aiSummaryJob, len(values))
	for _, id := range postIDs {
		var job aiSummaryJob
		if raw, ok := values[aiSummaryActiveKey(id)]; ok && json.Unmarshal([]byte(raw), &job) == nil {
			result[id] = job
		} else if _, ok := values[aiSummaryPendingKey(id)]; ok {
			result[id] = aiSummaryJob{Status: aiSummaryStatusQueued}
		} else if raw, ok := values[aiSummaryResultKey(id)]; ok && json.Unmarshal([]byte(raw), &job) == nil {
			result[id] = job
		}
	}
	return result
}

// FillListStatus 为列表中的文章补充正在进行或失败的任务状态
func (s *AISummaryService) FillListStatus(posts []*dto.PostDto) {
	ids := make([]uint, len(posts))
	for i, post := range posts {
		ids[i] = post.ID
	}
	statuses := s.jobStatuses(ids)
	for _, post := range posts {
		if job, ok := statuses[post.ID]; ok && (job.active() || job.Status == aiSummaryStatusFailed) {
			post.AISummaryStatus = job.Status
			post.AISummaryError = job.Err
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
	if !aiSummaryHasContent(post.Content) {
		return errs.NewBadRequest("ai_summary_empty_content")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return svcerr
	}

	userID, _ := ctxutils.GetCurrentUserID(ctx)
	queued, err := s.enqueue(post, cfg, userID)
	if err != nil {
		return errs.Internal("failed_to_create_target", err)
	}
	if !queued {
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
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	posts, err := repo.Post.ListPostsForAISummary()
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	result := &dto.BatchAISummaryResultDto{}
	for i := range posts {
		post := &posts[i]
		switch {
		case !aiSummaryHasContent(post.Content):
			result.SkippedEmpty++
		case post.AISummary != "" && post.AISummarySourceHash == model.HashContent(post.Content):
			result.SkippedUpToDate++
		case !overwriteManual && post.Description != "" && post.Description != post.AISummary:
			result.SkippedManual++
		default:
			queued, err := s.enqueue(post, cfg, userID)
			if err != nil {
				return nil, errs.Internal("failed_to_create_target", err)
			}
			if queued {
				result.Queued++
			} else {
				result.SkippedRunning++
			}
		}
	}
	return result, nil
}

// enqueue 登记任务并在后台执行；该文章已有任务在排队或生成中（包括在其他实例）时返回 false。
// userID 为触发生成的用户（记入模型调用用量），中断后由其他实例接手时为 0
func (s *AISummaryService) enqueue(post *model.Post, cfg tools.AIConfig, userID uint) (bool, error) {
	data, _ := json.Marshal(aiSummaryJob{Status: aiSummaryStatusQueued})
	claimed, err := sharedstate.Current().SetNX(aiSummaryActiveKey(post.ID), string(data), aiSummaryActiveTTL)
	if err != nil || !claimed {
		return false, err
	}
	// 清掉上一次的结果，查询时只看到这次任务；登记待办，执行的实例中途退出时由其他实例接着做
	_ = sharedstate.Current().Delete(aiSummaryResultKey(post.ID))
	if err := sharedstate.Current().Set(aiSummaryPendingKey(post.ID), strconv.FormatUint(uint64(post.ID), 10), aiSummaryPendingTTL); err != nil {
		logrus.Warnf("save ai summary pending for post %d: %v", post.ID, err)
	}

	// 以触发时的正文为准，生成期间正文再被修改会在完成后显示为「需要重新生成」
	go s.run(startAISummaryTracker(post.ID), cfg, userID, post.Title, post.Content, model.HashContent(post.Content))
	return true, nil
}

// ResumePending 重新排队执行中途中断的任务：仍在待办里、但已没有排队或生成中状态的文章（执行的实例已退出）。
// 由定时任务调用，多实例时每轮只有一个实例执行；排队时用 SetNX 抢占，同一文章不会被重复执行
func (s *AISummaryService) ResumePending() {
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return
	}
	pending, err := sharedstate.Current().GetByPrefix(aiSummaryPendingKeyPrefix)
	if err != nil {
		logrus.Warnf("list pending ai summaries: %v", err)
		return
	}
	for key, value := range pending {
		id, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			_ = sharedstate.Current().Delete(key)
			continue
		}
		postID := uint(id)
		if _, active, err := sharedstate.Current().Get(aiSummaryActiveKey(postID)); err != nil || active {
			continue
		}
		post, err := repo.Post.GetPostByID(postID)
		if err != nil || !aiSummaryHasContent(post.Content) {
			_ = sharedstate.Current().Delete(key)
			continue
		}
		if queued, err := s.enqueue(post, cfg, 0); err != nil {
			logrus.Warnf("resume ai summary for post %d: %v", postID, err)
		} else if queued {
			logrus.Infof("resumed interrupted ai summary for post %d", postID)
		}
	}
}

// ResumePendingAISummaries 定时任务入口
func ResumePendingAISummaries() {
	aiSummaryService.ResumePending()
}

func (s *AISummaryService) run(job *aiSummaryTracker, cfg tools.AIConfig, userID uint, title, content, sourceHash string) {
	postID := job.postID
	// 排队等待并发名额，拿到后才开始计算超时
	_ = s.limiter.Acquire(context.Background(), s.concurrency, false, nil)
	defer s.limiter.Release()
	job.setRunning()

	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("ai summary panic for post %d: %v", postID, r)
			job.finish(aiSummaryStatusFailed, "internal_error")
		}
	}()
	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeSummary, userID), aiSummaryTimeout)
	defer cancel()
	// 模型拒收图片、按纯文本重试时记在任务结果里，后台提示「已退回纯文本」
	ctx = WithVisionFallbackNotice(ctx, func(string) { job.setVisionFallback() })

	// 识图：正文靠前的图片随正文一起发送，只读取一次（空结果重试时复用）
	prompt, contentImages := buildAISummaryUserPrompt(title, content)
	var images []VisionImage
	if len(contentImages) > 0 && tools.GetAIVisionEnabled() {
		if llmclient.VisionUsable(cfg.BaseURL, cfg.Model) {
			images = LoadVisionImages(ctx, contentImages, AIVisionMaxImages)
		} else {
			job.setVisionFallback() // 该模型最近拒收过图片，本次直接按纯文本生成
		}
	}

	// 少数模型偶尔返回空内容（或只有思考过程），空结果时重试一次
	var summary string
	for attempt := 0; attempt < 2 && summary == ""; attempt++ {
		raw, err := s.complete(ctx, cfg, aiSummarySystemPrompt, prompt, images)
		if err != nil {
			logrus.Warnf("ai summary failed for post %d: %v", postID, err)
			job.finish(aiSummaryStatusFailed, err.Error())
			return
		}
		summary = normalizeAISummary(raw)
	}
	if summary == "" {
		job.finish(aiSummaryStatusFailed, "empty_response")
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
		job.finish(aiSummaryStatusFailed, "failed_to_update_target")
		return
	}
	repo.InvalidatePostCache()
	SyncSearchPost(postID, 0, false)
	job.finish(aiSummaryStatusSucceeded, "")
}

// aiSummaryHasContent 正文有文字，或开启识图时有图片，才能生成摘要
func aiSummaryHasContent(content string) bool {
	if strings.TrimSpace(htmlToPlainText(content)) != "" {
		return true
	}
	return tools.GetAIVisionEnabled() && reHTMLImage.MatchString(content)
}

// buildAISummaryUserPrompt 用户消息：标题 + 转成纯文本（保留标题层级与代码块标记，图片留下 [图N：alt] 占位）的正文，
// 同时返回正文中的图片（按出现顺序）
func buildAISummaryUserPrompt(title, content string) (string, []ContentImage) {
	text, images := articleTextWithImages(content)
	runes := []rune(text)
	if len(runes) > aiSummaryMaxInputRunes {
		head := aiSummaryMaxInputRunes * 3 / 4
		tail := aiSummaryMaxInputRunes - head
		text = string(runes[:head]) + "\n\n……（中间部分省略）……\n\n" + string(runes[len(runes)-tail:])
	}
	return fmt.Sprintf("<title>%s</title>\n\n<article>\n%s\n</article>", title, text), images
}

var (
	reHeading    = regexp.MustCompile(`(?is)<h([1-6])[^>]*>(.*?)</h[1-6]>`)
	rePre        = regexp.MustCompile(`(?is)<pre[^>]*>(.*?)</pre>`)
	reBlockBreak = regexp.MustCompile(`(?i)<(br|/p|/li|/blockquote|/h[1-6]|/figcaption|/tr)[^>]*>`)
	reTableCell  = regexp.MustCompile(`(?i)</t[dh]>`)
	reListItem   = regexp.MustCompile(`(?i)<li[^>]*>`)
	reTag        = regexp.MustCompile(`(?s)<[^>]+>`)
	reBlankLines = regexp.MustCompile(`\n{3,}`)
	// 公式节点（编辑器只保存 data-latex，没有文字内容）
	reMathTag   = regexp.MustCompile(`(?i)<(?:span|div)\b[^>]*\bdata-type="(?:inline|block)-math"[^>]*>`)
	reMathLatex = regexp.MustCompile(`\bdata-latex="([^"]*)"`)
)

// htmlToPlainText 把正文 HTML 转为便于模型理解的纯文本
func htmlToPlainText(content string) string {
	// 公式按 LaTeX 源码计入，写成 $…$
	content = reMathTag.ReplaceAllStringFunc(content, func(m string) string {
		if latex := reMathLatex.FindStringSubmatch(m); latex != nil {
			return " $" + latex[1] + "$ "
		}
		return m
	})
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

// aiSummaryCompletion 摘要调用模型（温度 0.3），用户消息可附带正文图片
func aiSummaryCompletion(ctx context.Context, cfg tools.AIConfig, system, user string, images []VisionImage) (string, error) {
	data, err := chatCompletionRawWithImages(ctx, cfg, system, user, images, 0.3, "")
	if err != nil {
		return "", err
	}
	return llmclient.ParseChatCompletion(data)
}
