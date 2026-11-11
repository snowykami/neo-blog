package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// fakeLLMServer 模拟 OpenAI 兼容接口：非流式返回带 usage 的 JSON，流式在最后一块返回 usage；/fail 下的请求返回 500
func fakeLLMServer(t *testing.T, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if strings.HasPrefix(r.URL.Path, "/fail") {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `{"error":{"message":"upstream down"}}`)
			return
		}
		var body struct {
			Stream        bool           `json:"stream"`
			StreamOptions map[string]any `json:"stream_options"`
		}
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &body)
		usage := `{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":30},"cache_creation_input_tokens":5}`
		content := `{\"source_lang\": \"en\", \"translation\": \"你好\"}`
		if body.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"写好了\"}}]}\n\n")
			if body.StreamOptions["include_usage"] == true {
				_, _ = fmt.Fprintf(w, "data: {\"choices\":[],\"usage\":%s}\n\n", usage)
			}
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"content":"%s"}}],"usage":%s}`, content, usage)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func setAIBaseURL(t *testing.T, url string) {
	t.Helper()
	for k, v := range map[string]any{"ai_api_base_url": url, "ai_api_key": "sk-test", "ai_model": "test-model"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatalf("set %s: %v", k, err)
		}
	}
}

func llmUsageRows(t *testing.T) []model.LLMUsage {
	t.Helper()
	var rows []model.LLMUsage
	if err := repo.GetDB().Order("id").Find(&rows).Error; err != nil {
		t.Fatalf("list llm usages: %v", err)
	}
	return rows
}

// waitLLMUsage 等后台任务（AI 摘要）记下某个用途的用量
func waitLLMUsage(t *testing.T, purpose string) model.LLMUsage {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var row model.LLMUsage
		if err := repo.GetDB().Where("purpose = ?", purpose).First(&row).Error; err == nil {
			return row
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no llm usage recorded for %s", purpose)
	return model.LLMUsage{}
}

// 所有调用模型的入口都按用途记一条用量（含缓存读写与触发用户），失败的调用也记（token 为 0、带错误）
func TestLLMUsageRecordedForAllPurposes(t *testing.T) {
	admin, author, ai1, _, postID := setupAgentTest(t)
	var calls atomic.Int32
	srv := fakeLLMServer(t, &calls)
	setAIBaseURL(t, srv.URL)
	cfg := tools.GetAIConfig()
	authorID := userIDOf(t, author)

	// AI 摘要：后台任务，记触发的用户
	if svcerr := NewAISummaryService().Trigger(author, postID); svcerr != nil {
		t.Fatalf("trigger summary: %v", svcerr)
	}
	summary := waitLLMUsage(t, constant.LLMPurposeSummary)
	if summary.UserID == nil || *summary.UserID != authorID || !summary.Success || summary.PromptTokens != 100 || summary.CompletionTokens != 20 ||
		summary.CachedTokens != 30 || summary.CacheWriteTokens != 5 || summary.Model != "test-model" {
		t.Fatalf("summary usage = %+v", summary)
	}

	// AI 写作：流式，用量取自最后一块
	rec := &eventRecorder{}
	NewAIWriteService().Stream(context.Background(), &AIWriteJob{userID: authorID, cfg: cfg, system: "s", user: "u"}, rec.emit)
	writing := waitLLMUsage(t, constant.LLMPurposeWriting)
	if writing.UserID == nil || *writing.UserID != authorID || writing.PromptTokens != 100 || writing.CompletionTokens != 20 || writing.CachedTokens != 30 {
		t.Fatalf("writing usage = %+v", writing)
	}

	// 评论翻译
	commentID, svcerr := createComment(admin, postID, 0, false)
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	if _, svcerr := NewCommentTranslateService().Translate(author, &dto.TranslateCommentReq{ID: commentID, TargetLang: "zh", RemoteAddr: "203.0.113.9"}); svcerr != nil {
		t.Fatalf("translate: %v", svcerr)
	}
	translation := waitLLMUsage(t, constant.LLMPurposeTranslation)
	if translation.UserID == nil || *translation.UserID != authorID || translation.PromptTokens != 100 {
		t.Fatalf("translation usage = %+v", translation)
	}

	// 歌词标注：由访客触发，不记用户
	if _, err := lyricAnnotations.call(cfg, "sys", "user"); err != nil {
		t.Fatalf("lyric annotation call: %v", err)
	}
	if lyric := waitLLMUsage(t, constant.LLMPurposeLyricAnnotation); lyric.UserID != nil || lyric.PromptTokens != 100 {
		t.Fatalf("lyric usage = %+v", lyric)
	}

	// AI 用户的运行：记在该 AI 用户的账号下，运行记录上的用量照旧
	_, run := leaseCtx(t, ai1.ID, constant.AgentRunKindBrowse)
	if _, err := NewAIAgentService().AgentChat(context.Background(), run.ID, map[string]any{"messages": chatMessages("s", "u")}); err != nil {
		t.Fatalf("agent chat: %v", err)
	}
	agent := waitLLMUsage(t, constant.LLMPurposeAIAgent)
	if agent.UserID == nil || *agent.UserID != ai1.User.ID || agent.PromptTokens != 100 {
		t.Fatalf("agent usage = %+v", agent)
	}
	if got, _ := repo.AIAgent.GetRun(run.ID); got.PromptTokens != 100 || got.CompletionTokens != 20 {
		t.Fatalf("agent run usage = %+v", got)
	}

	// AI 用户的后台任务：记忆整理、人设生成
	if _, err := backgroundAgentChat(context.Background(), model.AgentRun{AgentID: ai1.ID, Trigger: constant.AgentTriggerMemoryConsolidate}, cfg, "s", "u", 0.3, ""); err != nil {
		t.Fatalf("memory chat: %v", err)
	}
	if _, err := backgroundAgentChat(context.Background(), model.AgentRun{Trigger: constant.AgentTriggerGroupGenerate}, cfg, "s", "u", 0.9, ""); err != nil {
		t.Fatalf("persona chat: %v", err)
	}
	waitLLMUsage(t, constant.LLMPurposeAIAgentMemory)
	waitLLMUsage(t, constant.LLMPurposeAIAgentPersona)

	// 调用失败也记一条：token 为 0、带错误
	failCfg := cfg
	failCfg.BaseURL = srv.URL + "/fail"
	if _, err := chatCompletion(withLLMPurpose(context.Background(), constant.LLMPurposeTranslation, 0), failCfg, "s", "u"); err == nil {
		t.Fatal("failing upstream should return an error")
	}
	var failed model.LLMUsage
	if err := repo.GetDB().Where("success = ?", false).First(&failed).Error; err != nil {
		t.Fatalf("failed call not recorded: %v", err)
	}
	if failed.PromptTokens != 0 || failed.CompletionTokens != 0 || !strings.Contains(failed.Error, "status 500") || failed.Purpose != constant.LLMPurposeTranslation {
		t.Fatalf("failed usage = %+v", failed)
	}

	// 没有入口漏标用途
	for _, row := range llmUsageRows(t) {
		if row.Purpose == constant.LLMPurposeOther {
			t.Fatalf("llm call without purpose: %+v", row)
		}
	}

	// 后台统计：仅管理员，本月按用途分组、近 30 天逐日
	if _, svcerr := NewLLMUsageService().Stats(author); svcerr == nil {
		t.Fatal("non-admin must not read ai usage")
	}
	stats, svcerr := NewLLMUsageService().Stats(admin)
	if svcerr != nil {
		t.Fatalf("stats: %v", svcerr)
	}
	if len(stats.Dates) != 30 || stats.Dates[29] != time.Now().Format(time.DateOnly) || stats.MonthCalls != int64(len(llmUsageRows(t))) {
		t.Fatalf("stats dates/calls = %v / %d", stats.Dates, stats.MonthCalls)
	}
	byPurpose := map[string]dto.AIUsagePurposeDto{}
	for _, p := range stats.Purposes {
		byPurpose[p.Purpose] = p
	}
	if p := byPurpose[constant.LLMPurposeTranslation]; p.Calls != 2 || p.Failed != 1 || p.TotalTokens != 120 || p.CachedTokens != 30 {
		t.Fatalf("translation stats = %+v", p)
	}
	if stats.AgentMonthTokens != 360 {
		t.Fatalf("agent month tokens = %d", stats.AgentMonthTokens)
	}
	for _, series := range stats.Series {
		if len(series.Calls) != 30 || len(series.Tokens) != 30 {
			t.Fatalf("series %s length = %d/%d", series.Purpose, len(series.Calls), len(series.Tokens))
		}
		if series.Purpose == constant.LLMPurposeSummary && (series.Calls[29] != 1 || series.Tokens[29] != 120) {
			t.Fatalf("summary series today = %d calls / %d tokens", series.Calls[29], series.Tokens[29])
		}
	}
}

// 全站 AI 月度预算：默认不限；用完后摘要、写作、翻译、歌词标注返回 ai_budget_exceeded 且不调用模型、不记用量，
// AI 用户的调用不受全站预算拦截（只看自己的预算）
func TestSiteAIBudget(t *testing.T) {
	admin, author, ai1, _, postID := setupAgentTest(t)
	var calls atomic.Int32
	srv := fakeLLMServer(t, &calls)
	setAIBaseURL(t, srv.URL)
	cfg := tools.GetAIConfig()

	if err := repo.LLMUsage.Create(&model.LLMUsage{Purpose: constant.LLMPurposeAIAgent, PromptTokens: 150, CompletionTokens: 50, Success: true}); err != nil {
		t.Fatal(err)
	}
	// 默认不限
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		t.Fatalf("budget should be unlimited by default: %v", svcerr)
	}
	if err := repo.KV.SetKV("ai_monthly_token_budget", 200); err != nil {
		t.Fatal(err)
	}
	before := len(llmUsageRows(t))
	expectBudget := func(name string, code string) {
		t.Helper()
		if code != "ai_budget_exceeded" {
			t.Fatalf("%s: got %q, want ai_budget_exceeded", name, code)
		}
	}
	svcerr := NewAISummaryService().Trigger(author, postID)
	expectBudget("summary", svcerr.Error())
	if svcerr.Code != http.StatusTooManyRequests {
		t.Fatalf("budget error status = %d", svcerr.Code)
	}
	_, svcerr = NewAIWriteService().Prepare(author, constant.TargetTypePost, postID, &dto.AIWriteReq{Mode: aiWriteModeWrite, Document: "<p>x</p>"})
	expectBudget("writing prepare", svcerr.Error())
	// 底层兜底：入口检查之后才用完的，调用前再拦一次
	err := chatCompletionStream(withLLMPurpose(context.Background(), constant.LLMPurposeWriting, 1), cfg, "s", "u", func(string, string) error { return nil })
	expectBudget("writing stream", fmt.Sprint(err))
	commentID, _ := createComment(admin, postID, 0, false)
	_, svcerr = NewCommentTranslateService().Translate(author, &dto.TranslateCommentReq{ID: commentID, TargetLang: "en", RemoteAddr: "203.0.113.9"})
	if svcerr == nil {
		t.Fatal("translate should be rejected")
	}
	expectBudget("translate", svcerr.Message)
	_, err = lyricAnnotations.call(cfg, "sys", "user")
	expectBudget("lyric annotation", fmt.Sprint(err))
	if calls.Load() != 0 || len(llmUsageRows(t)) != before {
		t.Fatalf("rejected calls must not reach the model or be recorded: calls=%d rows=%d->%d", calls.Load(), before, len(llmUsageRows(t)))
	}

	// AI 用户的调用照常进行，并记入统一用量
	_, run := leaseCtx(t, ai1.ID, constant.AgentRunKindBrowse)
	if _, err := NewAIAgentService().AgentChat(context.Background(), run.ID, map[string]any{"messages": chatMessages("s", "u")}); err != nil {
		t.Fatalf("agent chat should not be blocked by the site budget: %v", err)
	}
	if calls.Load() != 1 || len(llmUsageRows(t)) != before+1 {
		t.Fatalf("agent call: calls=%d rows=%d", calls.Load(), len(llmUsageRows(t)))
	}

	// 放宽预算后恢复（预算检查的本月合计有 30 秒缓存，这里换一个更大的预算）
	if err := repo.KV.SetKV("ai_monthly_token_budget", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := lyricAnnotations.call(cfg, "sys", "user"); err != nil {
		t.Fatalf("unlimited budget: %v", err)
	}
}

func userIDOf(t *testing.T, ctx context.Context) uint {
	t.Helper()
	id, ok := ctx.Value("user_id").(uint)
	if !ok {
		t.Fatal("ctx without user id")
	}
	return id
}
