package repo

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
)

// 用量统计的查询在 SQLite 与 Postgres 上结果一致：按用途合计（含失败次数）、逐日分桶、按时间清理
func TestLLMUsageQueries(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		now := time.Now()
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		userID := uint(7)
		rows := []model.LLMUsage{
			{CreatedAt: today.Add(time.Hour), Purpose: "summary", Model: "m", PromptTokens: 100, CachedTokens: 40, CompletionTokens: 20, UserID: &userID, Success: true},
			{CreatedAt: today.Add(2 * time.Hour), Purpose: "summary", Model: "m", Success: false, Error: "status 500"},
			{CreatedAt: today.AddDate(0, 0, -1).Add(time.Hour), Purpose: "translation", Model: "m", PromptTokens: 10, CompletionTokens: 5, CacheWriteTokens: 3, Success: true},
			{CreatedAt: today.AddDate(0, -14, 0), Purpose: "summary", Model: "m", PromptTokens: 999, Success: true},
		}
		for i := range rows {
			if err := LLMUsage.Create(&rows[i]); err != nil {
				t.Fatalf("create: %v", err)
			}
		}

		since := today.AddDate(0, 0, -1)
		if total, err := LLMUsage.SumTokens(since); err != nil || total != 135 {
			t.Fatalf("sum tokens = %d, %v", total, err)
		}
		totals, err := LLMUsage.TotalsByPurpose(since)
		if err != nil {
			t.Fatalf("totals: %v", err)
		}
		got := map[string]LLMUsagePurposeTotal{}
		for _, row := range totals {
			got[row.Purpose] = row
		}
		if s := got["summary"]; s.Calls != 2 || s.Failed != 1 || s.PromptTokens != 100 || s.CachedTokens != 40 || s.CompletionTokens != 20 {
			t.Fatalf("summary totals = %+v", s)
		}
		if tr := got["translation"]; tr.Calls != 1 || tr.Failed != 0 || tr.CacheWriteTokens != 3 {
			t.Fatalf("translation totals = %+v", tr)
		}

		ranges := []TimeRange{{From: today.AddDate(0, 0, -1), To: today}, {From: today, To: today.AddDate(0, 0, 1)}}
		daily, err := LLMUsage.DailyByPurpose(ranges)
		if err != nil {
			t.Fatalf("daily: %v", err)
		}
		byPurpose := map[string]LLMUsageDaily{}
		for _, item := range daily {
			byPurpose[item.Purpose] = item
		}
		if s := byPurpose["summary"]; s.Calls[0] != 0 || s.Calls[1] != 2 || s.Tokens[1] != 120 {
			t.Fatalf("summary daily = %+v", s)
		}
		if tr := byPurpose["translation"]; tr.Calls[0] != 1 || tr.Tokens[0] != 15 || tr.Calls[1] != 0 {
			t.Fatalf("translation daily = %+v", tr)
		}

		deleted, err := LLMUsage.DeleteBefore(today.AddDate(0, -13, 0))
		if err != nil || deleted != 1 {
			t.Fatalf("delete before = %d, %v", deleted, err)
		}
	})
}
