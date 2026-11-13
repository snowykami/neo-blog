package service

import (
	"context"
	"slices"
	"strconv"
	"time"

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
)

// 所有模型调用的统一用量记录与全站 AI 月度预算。
// 调用模型的底层函数（chatCompletionRaw、chatCompletionStream、AgentChat）在调用前后经过 beginLLMCall：
// 调用前按全站预算拦截（AI 用户的调用除外，它们有自己的预算），调用后无论成败都记一条用量。
// 用途与触发用户由各入口用 withLLMPurpose 挂在 ctx 上；漏标的调用记为 other，便于发现

const (
	llmUsageErrorLimit      = 500              // 用量记录里失败原因的长度上限
	llmUsageStatsTrendDays  = 30               // 后台用量统计的趋势天数
	llmUsageMonthTokensTTL  = 30 * time.Second // 本月全站 token 合计的缓存时间（预算检查用）
	llmUsageMonthTokensPref = "ai:site_tokens:m:"
)

// llmUsage 一次调用的 token 用量（取自上游响应的 usage）
type llmUsage = llmclient.Usage

type llmCallKey struct{}

// llmCallInfo 本次调用的用途与触发用户
type llmCallInfo struct {
	purpose string
	userID  uint
}

// withLLMPurpose 标明之后的模型调用属于哪个用途、由谁触发（userID 为 0 表示后台任务或访客）
func withLLMPurpose(ctx context.Context, purpose string, userID uint) context.Context {
	return context.WithValue(ctx, llmCallKey{}, llmCallInfo{purpose: purpose, userID: userID})
}

func llmCallFrom(ctx context.Context) llmCallInfo {
	if info, ok := ctx.Value(llmCallKey{}).(llmCallInfo); ok && info.purpose != "" {
		return info
	}
	return llmCallInfo{purpose: constant.LLMPurposeOther}
}

// errAIBudgetExceeded 全站 AI 月度预算已用完（429，前端按错误码提示）
func errAIBudgetExceeded() *errs.ServiceError {
	return errs.NewTooManyRequests("ai_budget_exceeded")
}

// siteMonthTokens 本月全站已用 token（全部用途，含 AI 用户），缓存 30 秒
func siteMonthTokens(now time.Time) int64 {
	key := llmUsageMonthTokensPref + now.Format("200601")
	if v, ok, _ := sharedstate.Current().Get(key); ok {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	n, err := repo.LLMUsage.SumTokens(monthStart(now))
	if err != nil {
		logrus.Warnf("sum llm usage tokens: %v", err)
		return 0
	}
	_ = sharedstate.Current().Set(key, strconv.FormatInt(n, 10), llmUsageMonthTokensTTL)
	return n
}

// checkSiteAIBudget 非 AI 用户的调用（摘要、写作、翻译、歌词标注）前的检查：配置了全站月度预算且本月全站用量已达到时拒绝。
// 入口处提前调用可以直接给用户明确的错误；底层调用前还会再检查一次兜底
func checkSiteAIBudget(now time.Time) *errs.ServiceError {
	budget := tools.GetAIMonthlyTokenBudget()
	if budget > 0 && siteMonthTokens(now) >= budget {
		return errAIBudgetExceeded()
	}
	return nil
}

// beginLLMCall 每次调用模型前调用：按用途检查全站预算（AI 用户的调用不受全站预算拦截），
// 通过时返回在调用结束后记录用量的函数（失败也记，token 为 0、带错误）
func beginLLMCall(ctx context.Context, modelName string) (func(usage llmUsage, err error), error) {
	info := llmCallFrom(ctx)
	if !constant.IsAIAgentLLMPurpose(info.purpose) {
		if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
			llmBudgetRejectionsTotal.Inc(info.purpose)
			logrus.WithContext(ctx).Warnf("llm call (%s) rejected: site monthly ai budget used up", info.purpose)
			return nil, svcerr
		}
	}
	start := time.Now()
	requestID := ctxutils.RequestID(ctx)
	return func(usage llmUsage, err error) {
		recordLLMUsage(info, modelName, requestID, usage, err, time.Since(start))
	}, nil
}

// recordLLMUsage 写一条用量记录并累加指标；写库失败只写日志，不影响调用结果
func recordLLMUsage(info llmCallInfo, modelName, requestID string, usage llmUsage, callErr error, elapsed time.Duration) {
	observeLLMCall(info.purpose, usage, callErr)
	row := &model.LLMUsage{
		Purpose:          info.purpose,
		Model:            clipRunes(modelName, 128),
		PromptTokens:     usage.Prompt,
		CachedTokens:     usage.Cached,
		CacheWriteTokens: usage.CacheWrite,
		CompletionTokens: usage.Completion,
		Success:          callErr == nil,
		DurationMs:       elapsed.Milliseconds(),
		RequestID:        requestID,
	}
	if info.userID != 0 {
		userID := info.userID
		row.UserID = &userID
	}
	if callErr != nil {
		row.Error = clipRunes(callErr.Error(), llmUsageErrorLimit)
	}
	if err := repo.LLMUsage.Create(row); err != nil {
		logrus.Warnf("record llm usage (%s): %v", info.purpose, err)
	}
}

// LLMUsageService 后台的 AI 用量统计
type LLMUsageService struct{}

func NewLLMUsageService() *LLMUsageService { return &LLMUsageService{} }

// Stats 本月按用途分组的调用次数与 token、近 30 天逐日趋势与全站预算（仅管理员）
func (s *LLMUsageService) Stats(ctx context.Context) (*dto.AIUsageStatsDto, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	now := time.Now()
	totals, err := repo.LLMUsage.TotalsByPurpose(monthStart(now))
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	start := today.AddDate(0, 0, -(llmUsageStatsTrendDays - 1))
	ranges := make([]repo.TimeRange, llmUsageStatsTrendDays)
	dates := make([]string, llmUsageStatsTrendDays)
	for i := range ranges {
		// 用 AddDate 而不是加 24 小时，夏令时切换日也能对齐零点
		ranges[i] = repo.TimeRange{From: start.AddDate(0, 0, i), To: start.AddDate(0, 0, i+1)}
		dates[i] = ranges[i].From.Format(time.DateOnly)
	}
	daily, err := repo.LLMUsage.DailyByPurpose(ranges)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}

	result := &dto.AIUsageStatsDto{
		Month:       now.Format("2006-01"),
		Budget:      tools.GetAIMonthlyTokenBudget(),
		AgentBudget: int64(tools.GetAIAgentConfig().MonthlyTokenBudget),
		Purposes:    []dto.AIUsagePurposeDto{},
		Dates:       dates,
		Series:      []dto.AIUsageSeriesDto{},
	}
	// AI 用户的本月用量与其预算检查同源（运行记录），升级前已产生的用量也计入
	if agentTokens, err := repo.AIAgent.SumTokens(monthStart(now)); err == nil {
		result.AgentMonthTokens = agentTokens
	} else {
		logrus.Warnf("sum agent run tokens: %v", err)
	}
	byPurpose := map[string]repo.LLMUsagePurposeTotal{}
	for _, t := range totals {
		byPurpose[t.Purpose] = t
	}
	dailyByPurpose := map[string]repo.LLMUsageDaily{}
	for _, item := range daily {
		dailyByPurpose[item.Purpose] = item
	}
	// 按固定顺序输出有数据的用途；不认识的用途（旧版本写入）排在最后
	order := append([]string{}, constant.LLMPurposes...)
	for _, t := range totals {
		if !slices.Contains(order, t.Purpose) {
			order = append(order, t.Purpose)
		}
	}
	for _, item := range daily {
		if !slices.Contains(order, item.Purpose) {
			order = append(order, item.Purpose)
		}
	}
	for _, purpose := range order {
		if t, ok := byPurpose[purpose]; ok {
			total := t.PromptTokens + t.CompletionTokens
			result.Purposes = append(result.Purposes, dto.AIUsagePurposeDto{
				Purpose: purpose, Calls: t.Calls, Failed: t.Failed,
				PromptTokens: t.PromptTokens, CachedTokens: t.CachedTokens, CacheWriteTokens: t.CacheWriteTokens,
				CompletionTokens: t.CompletionTokens, TotalTokens: total,
			})
			result.MonthCalls += t.Calls
			result.MonthTokens += total
		}
		if item, ok := dailyByPurpose[purpose]; ok {
			result.Series = append(result.Series, dto.AIUsageSeriesDto{Purpose: purpose, Calls: item.Calls, Tokens: item.Tokens})
		}
	}
	return result, nil
}

// CleanupLLMUsage 删除超过保留期的用量记录（保留 13 个月，覆盖月度统计与同比）
func CleanupLLMUsage() {
	before := time.Now().AddDate(0, -13, 0)
	n, err := repo.LLMUsage.DeleteBefore(before)
	if err != nil {
		logrus.Errorf("llm usage cleanup failed: %v", err)
	} else if n > 0 {
		logrus.Infof("llm usage cleanup: deleted %d records before %s", n, before.Format(time.DateOnly))
	}
}

// chatCompletion 调用 OpenAI 兼容的 /chat/completions 接口（温度 0.3，偏稳定）并记录用量
func chatCompletion(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
	return chatCompletionWithTemperature(ctx, cfg, system, user, 0.3)
}

// chatCompletionWithTemperature 同 chatCompletion，可指定温度
func chatCompletionWithTemperature(ctx context.Context, cfg tools.AIConfig, system, user string, temperature float64) (string, error) {
	return chatCompletionWithReasoning(ctx, cfg, system, user, temperature, "")
}

// chatCompletionWithReasoning 同 chatCompletionWithTemperature，可指定思考强度（reasoning_effort）
func chatCompletionWithReasoning(ctx context.Context, cfg tools.AIConfig, system, user string, temperature float64, effort string) (string, error) {
	data, err := chatCompletionRaw(ctx, cfg, system, user, temperature, effort)
	if err != nil {
		return "", err
	}
	return llmclient.ParseChatCompletion(data)
}

// chatCompletionRaw 调用前检查全站 AI 预算，调用后记录用量并返回原始响应体
func chatCompletionRaw(ctx context.Context, cfg tools.AIConfig, system, user string, temperature float64, effort string) ([]byte, error) {
	return chatCompletionRawWithImages(ctx, cfg, system, user, nil, temperature, effort)
}

// chatCompletionRawWithImages 同 chatCompletionRaw，用户消息可附带图片
func chatCompletionRawWithImages(ctx context.Context, cfg tools.AIConfig, system, user string, images []VisionImage, temperature float64, effort string) ([]byte, error) {
	finish, err := beginLLMCall(ctx, cfg.Model)
	if err != nil {
		return nil, err
	}
	data, err := llmclient.ChatCompletionRawCall(ctx, cfg, system, user, images, temperature, effort)
	var usage llmUsage
	if err == nil {
		usage = llmclient.ParseUsageDetail(data)
	}
	finish(usage, err)
	return data, err
}

// chatCompletionStream 流式调用模型并记录全站预算与用量
func chatCompletionStream(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content, reasoning string) error) error {
	finish, err := beginLLMCall(ctx, cfg.Model)
	if err != nil {
		return err
	}
	usage, err := llmclient.ChatCompletionStreamCall(ctx, cfg, system, user, onChunk)
	finish(usage, err)
	return err
}
