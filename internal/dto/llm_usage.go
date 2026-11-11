package dto

// AIUsageStatsDto 后台的 AI 用量统计：本月按用途分组的合计、近 30 天逐日趋势与预算
type AIUsageStatsDto struct {
	Month            string              `json:"month"`              // 统计的月份 YYYY-MM（服务器时区）
	Budget           int64               `json:"budget"`             // 全站 AI 月度 token 预算，0 为不限
	MonthTokens      int64               `json:"month_tokens"`       // 本月全站已用 token（输入 + 输出，全部用途）
	MonthCalls       int64               `json:"month_calls"`        // 本月全站调用次数（含失败）
	AgentBudget      int64               `json:"agent_budget"`       // AI 用户的月度 token 预算，0 为不限
	AgentMonthTokens int64               `json:"agent_month_tokens"` // 本月 AI 用户已用 token（与 AI 用户预算检查同源，取自运行记录）
	Purposes         []AIUsagePurposeDto `json:"purposes"`
	Dates            []string            `json:"dates"`  // 趋势的日期 YYYY-MM-DD，与 Series 中的数组一一对应
	Series           []AIUsageSeriesDto  `json:"series"` // 每个用途逐日的调用次数与 token
}

// AIUsagePurposeDto 一个用途的本月合计
type AIUsagePurposeDto struct {
	Purpose          string `json:"purpose"`
	Calls            int64  `json:"calls"`
	Failed           int64  `json:"failed"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CachedTokens     int64  `json:"cached_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
}

// AIUsageSeriesDto 一个用途逐日的调用次数与 token
type AIUsageSeriesDto struct {
	Purpose string  `json:"purpose"`
	Calls   []int64 `json:"calls"`
	Tokens  []int64 `json:"tokens"`
}
