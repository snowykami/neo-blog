package meili

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	// HighlightPre / HighlightPost 用不可见控制字符包裹命中词，避免与正文中的 HTML 标签或符号混淆
	HighlightPre  = "\x00"
	HighlightPost = "\x01"
)

// APIError Meilisearch 返回的非 2xx 错误响应
type APIError struct {
	StatusCode int
	Code       string `json:"code"`
	Type       string `json:"type"`
	Message    string `json:"message"`
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("meilisearch %d (%s): %s", e.StatusCode, e.Code, e.Message)
	}
	return fmt.Sprintf("meilisearch %d: %s", e.StatusCode, e.Message)
}

// IsIndexNotFound 索引不存在错误
func IsIndexNotFound(err error) bool {
	if apiErr, ok := err.(*APIError); ok {
		return apiErr.StatusCode == http.StatusNotFound || apiErr.Code == "index_not_found"
	}
	return false
}

// Client 轻量级 Meilisearch HTTP 客户端
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewClient 创建客户端；baseURL 会去掉末尾斜杠
func NewClient(baseURL, apiKey string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		apiKey:  strings.TrimSpace(apiKey),
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) BaseURL() string { return c.baseURL }

// WithTransport 替换底层 HTTP 传输层（便于离线单元测试）
func (c *Client) WithTransport(rt http.RoundTripper) *Client {
	if rt != nil {
		c.httpClient.Transport = rt
	}
	return c
}

// Location 用于监控展示的脱敏地址（host 或 host:port）
func (c *Client) Location() string {
	u, err := url.Parse(c.baseURL)
	if err != nil || u.Host == "" {
		return c.baseURL
	}
	if u.Path != "" && u.Path != "/" {
		return u.Host + u.Path
	}
	return u.Host
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body any, out any) error {
	fullURL := c.baseURL + path
	if len(query) > 0 {
		fullURL += "?" + query.Encode()
	}
	var reqBody io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reqBody = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, fullURL, reqBody)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		apiErr := &APIError{StatusCode: resp.StatusCode, Message: strings.TrimSpace(string(respBytes))}
		_ = json.Unmarshal(respBytes, apiErr)
		apiErr.StatusCode = resp.StatusCode
		return apiErr
	}
	if out != nil && len(respBytes) > 0 {
		if err := json.Unmarshal(respBytes, out); err != nil {
			return err
		}
	}
	return nil
}

// Health 探测服务健康状态（GET /health）
func (c *Client) Health(ctx context.Context) error {
	var res struct {
		Status string `json:"status"`
	}
	if err := c.do(ctx, http.MethodGet, "/health", nil, nil, &res); err != nil {
		return err
	}
	if res.Status != "" && res.Status != "available" {
		return fmt.Errorf("meilisearch status: %s", res.Status)
	}
	return nil
}

// Version 读取服务端版本号（GET /version）
func (c *Client) Version(ctx context.Context) (string, error) {
	var res struct {
		PkgVersion string `json:"pkgVersion"`
	}
	if err := c.do(ctx, http.MethodGet, "/version", nil, nil, &res); err != nil {
		return "", err
	}
	return res.PkgVersion, nil
}

// IndexStat 单个索引的统计信息
type IndexStat struct {
	NumberOfDocuments int64 `json:"numberOfDocuments"`
	IsIndexing        bool  `json:"isIndexing"`
}

// StatsResp 全局统计信息（GET /stats）
type StatsResp struct {
	DatabaseSize     int64                `json:"databaseSize"`
	UsedDatabaseSize int64                `json:"usedDatabaseSize"` // Meilisearch 1.10+ 返回实际已用字节数
	LastUpdate       *time.Time           `json:"lastUpdate"`
	Indexes          map[string]IndexStat `json:"indexes"`
}

// Stats 读取实例存储与索引统计
func (c *Client) Stats(ctx context.Context) (*StatsResp, error) {
	var res StatsResp
	if err := c.do(ctx, http.MethodGet, "/stats", nil, nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// TaskSummary 任务队列的计数摘要
type TaskSummary struct {
	Pending   int64 // enqueued + processing
	Succeeded int64 // 累计成功任务数
	Failed    int64 // 累计失败任务数
}

func (c *Client) countTasksByStatuses(ctx context.Context, statuses string) (int64, error) {
	q := url.Values{"statuses": {statuses}, "limit": {"0"}}
	var res struct {
		Total int64 `json:"total"`
	}
	if err := c.do(ctx, http.MethodGet, "/tasks", q, nil, &res); err != nil {
		return 0, err
	}
	return res.Total, nil
}

// TaskCounts 查询排队中、累计成功与累计失败任务数（GET /tasks?limit=0）
func (c *Client) TaskCounts(ctx context.Context) (*TaskSummary, error) {
	pending, err := c.countTasksByStatuses(ctx, "enqueued,processing")
	if err != nil {
		return nil, err
	}
	succeeded, err := c.countTasksByStatuses(ctx, "succeeded")
	if err != nil {
		return nil, err
	}
	failed, err := c.countTasksByStatuses(ctx, "failed")
	if err != nil {
		return nil, err
	}
	return &TaskSummary{Pending: pending, Succeeded: succeeded, Failed: failed}, nil
}

// TaskInfo 异步写入任务的摘要
type TaskInfo struct {
	TaskUID int64  `json:"taskUid"`
	Status  string `json:"status"`
}

// WaitTask 等待指定任务执行完成（主要用于测试或初始化）
func (c *Client) WaitTask(ctx context.Context, taskUID int64, interval time.Duration) error {
	if interval <= 0 {
		interval = 25 * time.Millisecond
	}
	path := fmt.Sprintf("/tasks/%d", taskUID)
	for {
		var res struct {
			Status string `json:"status"`
			Error  struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := c.do(ctx, http.MethodGet, path, nil, nil, &res); err != nil {
			return err
		}
		switch res.Status {
		case "succeeded":
			return nil
		case "failed", "canceled":
			return fmt.Errorf("meilisearch task %d %s: %s (%s)", taskUID, res.Status, res.Error.Message, res.Error.Code)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
		}
	}
}

// TypoTolerance 拼写容错设置
type TypoTolerance struct {
	Enabled             bool     `json:"enabled"`
	DisableOnAttributes []string `json:"disableOnAttributes,omitempty"`
}

// IndexSettings 索引配置
type IndexSettings struct {
	SearchableAttributes []string       `json:"searchableAttributes,omitempty"`
	FilterableAttributes []string       `json:"filterableAttributes,omitempty"`
	SortableAttributes   []string       `json:"sortableAttributes,omitempty"`
	RankingRules         []string       `json:"rankingRules,omitempty"`
	TypoTolerance        *TypoTolerance `json:"typoTolerance,omitempty"`
}

// EnsureIndex 确保索引存在并设置主键
func (c *Client) EnsureIndex(ctx context.Context, uid, primaryKey string) (*TaskInfo, error) {
	var info TaskInfo
	err := c.do(ctx, http.MethodPost, "/indexes", nil, map[string]string{
		"uid":        uid,
		"primaryKey": primaryKey,
	}, &info)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// UpdateSettings 更新索引设置
func (c *Client) UpdateSettings(ctx context.Context, uid string, settings IndexSettings) (*TaskInfo, error) {
	var info TaskInfo
	err := c.do(ctx, http.MethodPatch, "/indexes/"+url.PathEscape(uid)+"/settings", nil, settings, &info)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// UpsertDocuments 批量新增或更新文档
func (c *Client) UpsertDocuments(ctx context.Context, uid, primaryKey string, docs any) (*TaskInfo, error) {
	q := url.Values{}
	if primaryKey != "" {
		q.Set("primaryKey", primaryKey)
	}
	var info TaskInfo
	if err := c.do(ctx, http.MethodPost, "/indexes/"+url.PathEscape(uid)+"/documents", q, docs, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// DeleteDocument 删除单条文档
func (c *Client) DeleteDocument(ctx context.Context, uid, docID string) (*TaskInfo, error) {
	var info TaskInfo
	err := c.do(ctx, http.MethodDelete, "/indexes/"+url.PathEscape(uid)+"/documents/"+url.PathEscape(docID), nil, nil, &info)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// DeleteDocuments 批量按主键删除文档
func (c *Client) DeleteDocuments(ctx context.Context, uid string, docIDs []uint) (*TaskInfo, error) {
	if len(docIDs) == 0 {
		return &TaskInfo{}, nil
	}
	var info TaskInfo
	err := c.do(ctx, http.MethodPost, "/indexes/"+url.PathEscape(uid)+"/documents/delete-batch", nil, docIDs, &info)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// DeleteByFilter 按过滤表达式批量删除文档（如文章转为私密时清理其公开评论索引）
func (c *Client) DeleteByFilter(ctx context.Context, uid, filter string) (*TaskInfo, error) {
	var info TaskInfo
	err := c.do(ctx, http.MethodPost, "/indexes/"+url.PathEscape(uid)+"/documents/delete", nil, map[string]string{
		"filter": filter,
	}, &info)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// DeleteAllDocuments 清空索引内的全部文档
func (c *Client) DeleteAllDocuments(ctx context.Context, uid string) (*TaskInfo, error) {
	var info TaskInfo
	if err := c.do(ctx, http.MethodDelete, "/indexes/"+url.PathEscape(uid)+"/documents", nil, nil, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// FetchDocuments 分页读取索引内文档的指定字段（用于周期对账）
func (c *Client) FetchDocuments(ctx context.Context, uid string, offset, limit int, fields []string, out any) (int64, error) {
	q := url.Values{
		"offset": {strconv.Itoa(offset)},
		"limit":  {strconv.Itoa(limit)},
	}
	if len(fields) > 0 {
		q.Set("fields", strings.Join(fields, ","))
	}
	var wrapper struct {
		Results json.RawMessage `json:"results"`
		Total   int64           `json:"total"`
	}
	if err := c.do(ctx, http.MethodGet, "/indexes/"+url.PathEscape(uid)+"/documents", q, nil, &wrapper); err != nil {
		return 0, err
	}
	if out != nil && len(wrapper.Results) > 0 {
		if err := json.Unmarshal(wrapper.Results, out); err != nil {
			return 0, err
		}
	}
	return wrapper.Total, nil
}

// SearchQuery 单索引或聚合搜索请求参数
type SearchQuery struct {
	IndexUID              string   `json:"indexUid,omitempty"`
	Query                 string   `json:"q"`
	Filter                string   `json:"filter,omitempty"`
	Sort                  []string `json:"sort,omitempty"`
	AttributesToRetrieve  []string `json:"attributesToRetrieve,omitempty"`
	AttributesToHighlight []string `json:"attributesToHighlight,omitempty"`
	HighlightPreTag       string   `json:"highlightPreTag,omitempty"`
	HighlightPostTag      string   `json:"highlightPostTag,omitempty"`
	AttributesToCrop      []string `json:"attributesToCrop,omitempty"`
	CropLength            int      `json:"cropLength,omitempty"`
	CropMarker            string   `json:"cropMarker,omitempty"`
	Offset                int      `json:"offset,omitempty"`
	Limit                 int      `json:"limit,omitempty"`
	Page                  int      `json:"page,omitempty"`
	HitsPerPage           int      `json:"hitsPerPage,omitempty"`
}

func (q *SearchQuery) applyDefaults() {
	if len(q.AttributesToHighlight) > 0 {
		if q.HighlightPreTag == "" {
			q.HighlightPreTag = HighlightPre
		}
		if q.HighlightPostTag == "" {
			q.HighlightPostTag = HighlightPost
		}
	}
	if len(q.AttributesToCrop) > 0 && q.CropMarker == "" {
		q.CropMarker = "…"
	}
}

// SearchResult 搜索响应
type SearchResult struct {
	Hits               []map[string]any `json:"hits"`
	EstimatedTotalHits int64            `json:"estimatedTotalHits"`
	TotalHits          int64            `json:"totalHits"` // 指定 page / hitsPerPage 时返回精确总数
	ProcessingTimeMs   int64            `json:"processingTimeMs"`
}

// Total 返回命中总数（优先精确 TotalHits，否则 EstimatedTotalHits）
func (r *SearchResult) Total() int64 {
	if r.TotalHits > 0 || len(r.Hits) == 0 {
		if r.TotalHits > 0 {
			return r.TotalHits
		}
	}
	return r.EstimatedTotalHits
}

// Search 单索引搜索
func (c *Client) Search(ctx context.Context, uid string, q SearchQuery) (*SearchResult, error) {
	q.IndexUID = ""
	q.applyDefaults()
	var res SearchResult
	if err := c.do(ctx, http.MethodPost, "/indexes/"+url.PathEscape(uid)+"/search", nil, q, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// MultiSearch 跨多索引聚合搜索（POST /multi-search）
func (c *Client) MultiSearch(ctx context.Context, queries []SearchQuery) ([]SearchResult, error) {
	cloned := slices.Clone(queries)
	for i := range cloned {
		cloned[i].applyDefaults()
	}
	var res struct {
		Results []SearchResult `json:"results"`
	}
	if err := c.do(ctx, http.MethodPost, "/multi-search", nil, map[string]any{"queries": cloned}, &res); err != nil {
		return nil, err
	}
	return res.Results, nil
}

// ParseHighlighted 解析带 HighlightPre / HighlightPost 标记的格式化字符串，
// 返回去掉标记后的纯文本与实际被引擎高亮的原文词列表（长词在前、不区分大小写去重）
func ParseHighlighted(formatted string) (clean string, terms []string) {
	if formatted == "" {
		return "", nil
	}
	if !strings.Contains(formatted, HighlightPre) {
		return formatted, nil
	}
	var out strings.Builder
	var matched []string
	rest := formatted
	for {
		start := strings.Index(rest, HighlightPre)
		if start < 0 {
			out.WriteString(rest)
			break
		}
		out.WriteString(rest[:start])
		rest = rest[start+len(HighlightPre):]
		end := strings.Index(rest, HighlightPost)
		if end < 0 {
			out.WriteString(rest)
			break
		}
		word := rest[:end]
		out.WriteString(word)
		if trimmed := strings.TrimSpace(word); trimmed != "" {
			lower := strings.ToLower(trimmed)
			if !slices.ContainsFunc(matched, func(s string) bool { return strings.ToLower(s) == lower }) {
				matched = append(matched, trimmed)
			}
		}
		rest = rest[end+len(HighlightPost):]
	}
	slices.SortFunc(matched, func(a, b string) int {
		return len([]rune(b)) - len([]rune(a))
	})
	return out.String(), matched
}

// HitUintID 从单条 Hit 中提取 uint 主键
func HitUintID(hit map[string]any) (uint, bool) {
	raw, ok := hit["id"]
	if !ok {
		return 0, false
	}
	switch v := raw.(type) {
	case float64:
		if v > 0 {
			return uint(v), true
		}
	case int:
		if v > 0 {
			return uint(v), true
		}
	case string:
		if n, err := strconv.ParseUint(v, 10, 64); err == nil && n > 0 {
			return uint(n), true
		}
	}
	return 0, false
}

// HitFormattedString 读取 hit._formatted[field]
func HitFormattedString(hit map[string]any, field string) string {
	fm, ok := hit["_formatted"].(map[string]any)
	if !ok {
		return ""
	}
	s, _ := fm[field].(string)
	return s
}
