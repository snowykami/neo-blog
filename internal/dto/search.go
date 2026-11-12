package dto

import "time"

// GlobalSearchReq 全站公开资源聚合搜索请求
type GlobalSearchReq struct {
	Query string `query:"q"`
	Limit int    `query:"limit"` // 每个分组最多返回的条数，默认 5，上限 15
	Types string `query:"types"` // 可选，逗号分隔的分组（posts,pages,comments,users），为空时查全部
}

// GlobalSearchResp 全站公开资源聚合搜索结果
type GlobalSearchResp struct {
	Engine   string                `json:"engine"` // meilisearch 或 database
	Posts    []SearchPostHitDto    `json:"posts"`
	Pages    []SearchPageHitDto    `json:"pages"`
	Comments []SearchCommentHitDto `json:"comments"`
	Users    []SearchUserHitDto    `json:"users"`
}

// SearchPostHitDto 聚合搜索中的公开文章命中项
type SearchPostHitDto struct {
	ID             uint      `json:"id"`
	Title          string    `json:"title"`
	Slug           *string   `json:"slug"`
	Cover          string    `json:"cover"`
	Snippet        string    `json:"snippet"`
	CategoryName   string    `json:"category_name,omitempty"`
	Labels         []string  `json:"labels,omitempty"`
	AuthorNickname string    `json:"author_nickname,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	HighlightTerms []string  `json:"highlight_terms,omitempty"`
}

// SearchPageHitDto 聚合搜索中的公开页面命中项
type SearchPageHitDto struct {
	ID             uint     `json:"id"`
	Title          string   `json:"title"`
	Slug           string   `json:"slug"`
	Kind           string   `json:"kind"`
	LinkURL        string   `json:"link_url,omitempty"`
	Snippet        string   `json:"snippet"`
	HighlightTerms []string `json:"highlight_terms,omitempty"`
}

// SearchCommentHitDto 聚合搜索中的公开评论命中项
type SearchCommentHitDto struct {
	ID             uint          `json:"id"`
	Content        string        `json:"content"`
	User           *UserBriefDto `json:"user,omitempty"`
	TargetType     string        `json:"target_type"`
	TargetID       uint          `json:"target_id"`
	TargetTitle    string        `json:"target_title"`
	TargetSlug     *string       `json:"target_slug,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
	HighlightTerms []string      `json:"highlight_terms,omitempty"`
}

// SearchUserHitDto 聚合搜索中的公开用户命中项（只含最小公开信息，不含邮箱与邮箱哈希）
type SearchUserHitDto struct {
	UserBriefDto
	HighlightTerms []string `json:"highlight_terms,omitempty"`
}

// TestMeilisearchReq 后台测试 Meilisearch 连接请求：未填字段回退读取已保存的配置，无需先保存即可验证
type TestMeilisearchReq struct {
	URL         *string `json:"url"`
	APIKey      *string `json:"api_key"`
	IndexPrefix *string `json:"index_prefix"`
}

// TestMeilisearchResp 测试连接成功后的服务端摘要
type TestMeilisearchResp struct {
	Version      string `json:"version"`
	Location     string `json:"location"`
	DatabaseSize int64  `json:"database_size"`
}

// ReindexSearchResp 触发全站搜索索引重建的结果
type ReindexSearchResp struct {
	Started        bool `json:"started"`
	AlreadyRunning bool `json:"already_running"`
}
