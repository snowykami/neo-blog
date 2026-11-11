package repo

import (
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
)

type llmUsageRepo struct{}

var LLMUsage = &llmUsageRepo{}

// Create 记一条模型调用用量
func (r *llmUsageRepo) Create(usage *model.LLMUsage) error {
	return GetDB().Create(usage).Error
}

// SumTokens since 之后全部调用消耗的 token（输入 + 输出）
func (r *llmUsageRepo) SumTokens(since time.Time) (int64, error) {
	var total int64
	err := GetDB().Model(&model.LLMUsage{}).Where("created_at >= ?", since).
		Select("COALESCE(SUM(prompt_tokens + completion_tokens), 0)").Scan(&total).Error
	return total, err
}

// LLMUsagePurposeTotal 一个用途在区间内的合计
type LLMUsagePurposeTotal struct {
	Purpose          string
	Calls            int64
	Failed           int64
	PromptTokens     int64
	CachedTokens     int64
	CacheWriteTokens int64
	CompletionTokens int64
}

// TotalsByPurpose since 之后按用途分组的调用次数与 token
func (r *llmUsageRepo) TotalsByPurpose(since time.Time) ([]LLMUsagePurposeTotal, error) {
	var rows []LLMUsagePurposeTotal
	err := GetDB().Model(&model.LLMUsage{}).
		Select(`purpose, COUNT(*) AS calls,
			COALESCE(SUM(CASE WHEN success THEN 0 ELSE 1 END), 0) AS failed,
			COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
			COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
			COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
			COALESCE(SUM(completion_tokens), 0) AS completion_tokens`).
		Where("created_at >= ?", since).Group("purpose").Scan(&rows).Error
	return rows, err
}

// LLMUsageDaily 一个用途逐日的调用次数与 token（与传入的区间一一对应）
type LLMUsageDaily struct {
	Purpose string
	Calls   []int64
	Tokens  []int64
}

// DailyByPurpose 按用途统计各区间（通常为逐日）的调用次数与 token：用 CASE WHEN 在 SQL 内分桶，同时兼容 SQLite 与 Postgres
func (r *llmUsageRepo) DailyByPurpose(ranges []TimeRange) ([]LLMUsageDaily, error) {
	if len(ranges) == 0 {
		return nil, nil
	}
	n := len(ranges)
	cols := make([]string, 0, 2*n+1)
	args := make([]any, 0, 4*n)
	cols = append(cols, "purpose")
	for _, rg := range ranges {
		cols = append(cols, "COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0)")
		args = append(args, rg.From, rg.To)
	}
	for _, rg := range ranges {
		cols = append(cols, "COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN prompt_tokens + completion_tokens ELSE 0 END), 0)")
		args = append(args, rg.From, rg.To)
	}
	rows, err := GetDB().Model(&model.LLMUsage{}).Select(strings.Join(cols, ", "), args...).
		Where("created_at >= ? AND created_at < ?", ranges[0].From, ranges[n-1].To).Group("purpose").Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []LLMUsageDaily
	for rows.Next() {
		item := LLMUsageDaily{Calls: make([]int64, n), Tokens: make([]int64, n)}
		dest := make([]any, 0, 2*n+1)
		dest = append(dest, &item.Purpose)
		for i := range item.Calls {
			dest = append(dest, &item.Calls[i])
		}
		for i := range item.Tokens {
			dest = append(dest, &item.Tokens[i])
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// DeleteBefore 删除 before 之前的用量记录，返回删除条数
func (r *llmUsageRepo) DeleteBefore(before time.Time) (int64, error) {
	res := GetDB().Where("created_at < ?", before).Delete(&model.LLMUsage{})
	return res.RowsAffected, res.Error
}
