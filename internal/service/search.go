package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/meili"
	"github.com/snowykami/neo-blog/pkg/metrics"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

const (
	searchStatsKeyPrefix   = "search_stats:"
	searchStatsTTL         = 2 * time.Minute
	searchStatsFlushWindow = 2 * time.Second

	globalSearchRateLimit  = 90
	globalSearchRateWindow = time.Minute
	globalSearchMaxRunes   = 80
	globalSearchDefaultLim = 5
	globalSearchMaxLim     = 15
)

var (
	meiliSearchesTotal = metrics.NewCounterVec("neo_blog_meilisearch_queries_total",
		"Meilisearch search requests executed by backend, by result (ok / error).", "result")
	meiliSearchDuration = metrics.NewHistogramVec("neo_blog_meilisearch_query_duration_seconds",
		"Meilisearch search duration in seconds, by result (ok / error).", metrics.DefaultBuckets, "result")
)

type searchInstanceCounters struct {
	Calls int64 `json:"calls"`
	Nanos int64 `json:"nanos"`
}

var searchStats struct {
	calls     atomic.Int64
	nanos     atomic.Int64
	lastFlush atomic.Int64
}

func recordSearchCall(elapsed time.Duration, err error) {
	result := "ok"
	if err != nil {
		result = "error"
	}
	meiliSearchesTotal.Inc(result)
	meiliSearchDuration.Observe(elapsed.Seconds(), result)

	calls := searchStats.calls.Add(1)
	nanos := searchStats.nanos.Add(elapsed.Nanoseconds())
	if !sharedstate.Shared() {
		return
	}
	nowNano := time.Now().UnixNano()
	prevFlush := searchStats.lastFlush.Load()
	if nowNano-prevFlush >= int64(searchStatsFlushWindow) && searchStats.lastFlush.CompareAndSwap(prevFlush, nowNano) {
		snap := searchInstanceCounters{Calls: calls, Nanos: nanos}
		go func() {
			defer func() {
				if r := recover(); r != nil {
					logrus.Errorf("flush search stats panicked: %v", r)
				}
			}()
			_ = sharedstate.SetJSON(searchStatsKeyPrefix+sharedstate.InstanceID(), snap, searchStatsTTL)
		}()
	}
}

func flushSearchStatsInstance() {
	snap := searchInstanceCounters{
		Calls: searchStats.calls.Load(),
		Nanos: searchStats.nanos.Load(),
	}
	searchStats.lastFlush.Store(time.Now().UnixNano())
	_ = sharedstate.SetJSON(searchStatsKeyPrefix+sharedstate.InstanceID(), snap, searchStatsTTL)
}

func collectAllSearchCounters() map[string]searchInstanceCounters {
	out := make(map[string]searchInstanceCounters)
	if rawMap, err := sharedstate.Current().GetByPrefix(searchStatsKeyPrefix); err == nil {
		for k, raw := range rawMap {
			id := strings.TrimPrefix(k, searchStatsKeyPrefix)
			var item searchInstanceCounters
			if id != "" && parseJSONInto(raw, &item) {
				out[id] = item
			}
		}
	}
	out[sharedstate.InstanceID()] = searchInstanceCounters{
		Calls: searchStats.calls.Load(),
		Nanos: searchStats.nanos.Load(),
	}
	return out
}

func parseJSONInto(raw string, dst *searchInstanceCounters) bool {
	if raw == "" {
		return false
	}
	c := parseJSONOr(raw, searchInstanceCounters{Calls: -1})
	if c.Calls < 0 {
		return false
	}
	*dst = c
	return true
}

// hasSearchableToken 判断查询词中是否至少包含一个字母或数字：
// 纯标点符号（如 "%"、"..."）在分词器中会被清空而退化为返回全表文档的占位查询，此类输入一律走数据库字面匹配
func hasSearchableToken(q string) bool {
	for _, r := range q {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return true
		}
	}
	return false
}

func mergeHighlightTerms(groups ...[]string) []string {
	var merged []string
	for _, g := range groups {
		for _, term := range g {
			trimmed := strings.TrimSpace(term)
			if trimmed == "" {
				continue
			}
			lower := strings.ToLower(trimmed)
			if !slices.ContainsFunc(merged, func(existing string) bool { return strings.ToLower(existing) == lower }) {
				merged = append(merged, trimmed)
			}
		}
	}
	slices.SortFunc(merged, func(a, b string) int {
		return len([]rune(b)) - len([]rune(a))
	})
	if len(merged) > 12 {
		merged = merged[:12]
	}
	return merged
}

func extractHitSnippetAndTerms(hit map[string]any, snippetFields []string, extraHighlightFields []string) (snippet string, terms []string) {
	var allTerms [][]string
	for _, field := range snippetFields {
		raw := meili.HitFormattedString(hit, field)
		if raw == "" {
			continue
		}
		clean, matched := meili.ParseHighlighted(raw)
		if len(matched) > 0 {
			allTerms = append(allTerms, matched)
			if snippet == "" {
				snippet = strings.TrimSpace(clean)
			}
		}
	}
	for _, field := range extraHighlightFields {
		raw := meili.HitFormattedString(hit, field)
		if raw == "" {
			continue
		}
		_, matched := meili.ParseHighlighted(raw)
		if len(matched) > 0 {
			allTerms = append(allTerms, matched)
		}
	}
	return snippet, mergeHighlightTerms(allTerms...)
}

// ---- 单对象公开检索集成（失败自动回退数据库） ----

func normalizePostSearchQuery(raw string) string {
	parts := strings.Split(raw, ",")
	cleaned := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			cleaned = append(cleaned, s)
		}
	}
	return strings.Join(cleaned, " ")
}

func searchPublicPostsMeili(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, bool) {
	qText := normalizePostSearchQuery(req.Query)
	if qText == "" || !hasSearchableToken(qText) {
		return nil, 0, false
	}
	client, cfg, ok := activeMeiliClient(searchQueryTimeout)
	if !ok {
		return nil, 0, false
	}

	var filters []string
	if req.UserID > 0 {
		filters = append(filters, fmt.Sprintf("user_id = %d", req.UserID))
	}
	if req.Label != "" {
		var labelModel model.Label
		if err := repo.GetDB().Where("name = ? OR slug = ?", req.Label, req.Label).First(&labelModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return []*dto.PostDto{}, 0, true
			}
			return nil, 0, false
		}
		filters = append(filters, fmt.Sprintf("label_ids = %d", labelModel.ID))
	}
	if req.Category != "" {
		var categoryModel model.Category
		if err := repo.GetDB().Where("name = ? OR slug = ?", req.Category, req.Category).First(&categoryModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return []*dto.PostDto{}, 0, true
			}
			return nil, 0, false
		}
		filters = append(filters, fmt.Sprintf("category_id = %d", categoryModel.ID))
	}

	page := max(int(req.Page), 1)
	size := clampInt(int(req.Size), 1, 100)
	orderField := req.OrderBy
	if !slices.Contains(constant.OrderByEnumPost, orderField) {
		orderField = constant.OrderByCreatedAt
	}
	dir := "desc"
	if !req.Desc {
		dir = "asc"
	}

	qCtx, cancel := context.WithTimeout(ctx, searchQueryTimeout)
	defer cancel()
	start := time.Now()
	res, err := client.Search(qCtx, cfg.IndexUID(SearchGroupPosts), meili.SearchQuery{
		Query:                 qText,
		Filter:                strings.Join(filters, " AND "),
		Sort:                  []string{orderField + ":" + dir},
		AttributesToRetrieve:  []string{"id"},
		AttributesToHighlight: []string{"title", "labels", "category_name", "author_nickname", "description", "ai_summary", "plain_content"},
		AttributesToCrop:      []string{"plain_content"},
		CropLength:            64,
		Page:                  page,
		HitsPerPage:           size,
	})
	recordSearchCall(time.Since(start), err)
	if err != nil {
		logrus.Warnf("meilisearch post search fallback to db: %v", err)
		return nil, 0, false
	}

	ids := make([]uint, 0, len(res.Hits))
	type hitMeta struct {
		snippet string
		terms   []string
	}
	metaByID := make(map[uint]hitMeta, len(res.Hits))
	for _, hit := range res.Hits {
		id, ok := meili.HitUintID(hit)
		if !ok {
			continue
		}
		ids = append(ids, id)
		snippet, terms := extractHitSnippetAndTerms(
			hit,
			[]string{"plain_content", "description", "ai_summary"},
			[]string{"title", "labels", "category_name", "author_nickname"},
		)
		metaByID[id] = hitMeta{snippet: snippet, terms: terms}
	}
	if len(ids) == 0 {
		return []*dto.PostDto{}, res.Total(), true
	}

	posts, err := repo.ListPostsByIDsForList(ids, req.NoContent)
	if err != nil {
		return nil, 0, false
	}
	byID := make(map[uint]*model.Post, len(posts))
	for i := range posts {
		byID[posts[i].ID] = &posts[i]
	}

	dtos := make([]*dto.PostDto, 0, len(ids))
	for _, id := range ids {
		p, exists := byID[id]
		if !exists {
			continue
		}
		d := p.ToDtoWithShortContent(200)
		if meta, ok := metaByID[id]; ok {
			if !req.NoContent && meta.snippet != "" {
				d.SearchSnippet = meta.snippet
			}
			d.HighlightTerms = meta.terms
		}
		dtos = append(dtos, d)
	}
	return dtos, res.Total(), true
}

func searchPublicPagesMeili(req *dto.ListPageReq) ([]*dto.PageDto, int64, bool) {
	qText := normalizePostSearchQuery(req.Query)
	if qText == "" || !hasSearchableToken(qText) {
		return nil, 0, false
	}
	client, cfg, ok := activeMeiliClient(searchQueryTimeout)
	if !ok {
		return nil, 0, false
	}

	var filters []string
	if req.UserID > 0 {
		filters = append(filters, fmt.Sprintf("user_id = %d", req.UserID))
	}
	if req.OnlyNav {
		filters = append(filters, "show_in_nav = true")
	}

	page := max(int(req.Page), 1)
	size := clampInt(int(req.Size), 1, 100)
	orderField := repo.AllowedOrderBy(req.OrderBy, constant.OrderByEnumPage, constant.OrderByCreatedAt)
	dir := "desc"
	if !req.Desc {
		dir = "asc"
	}

	qCtx, cancel := context.WithTimeout(context.Background(), searchQueryTimeout)
	defer cancel()
	start := time.Now()
	res, err := client.Search(qCtx, cfg.IndexUID(SearchGroupPages), meili.SearchQuery{
		Query:                qText,
		Filter:               strings.Join(filters, " AND "),
		Sort:                 []string{orderField + ":" + dir},
		AttributesToRetrieve: []string{"id"},
		Page:                 page,
		HitsPerPage:          size,
	})
	recordSearchCall(time.Since(start), err)
	if err != nil {
		logrus.Warnf("meilisearch page search fallback to db: %v", err)
		return nil, 0, false
	}

	ids := make([]uint, 0, len(res.Hits))
	for _, hit := range res.Hits {
		if id, ok := meili.HitUintID(hit); ok {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return []*dto.PageDto{}, res.Total(), true
	}

	pages, err := repo.ListPagesByIDsForList(ids, req.NoContent)
	if err != nil {
		return nil, 0, false
	}
	byID := make(map[uint]*model.Page, len(pages))
	for i := range pages {
		byID[pages[i].ID] = &pages[i]
	}

	dtos := make([]*dto.PageDto, 0, len(ids))
	for _, id := range ids {
		if pg, exists := byID[id]; exists {
			dtos = append(dtos, pg.ToDtoWithShortContent(200))
		}
	}
	return dtos, res.Total(), true
}

func searchUsersMeili(ctx context.Context, keyword string, excludeID uint, limit int) ([]model.User, bool) {
	if keyword == "" || !hasSearchableToken(keyword) {
		return nil, false
	}
	client, cfg, ok := activeMeiliClient(searchQueryTimeout)
	if !ok {
		return nil, false
	}
	if limit <= 0 || limit > 20 {
		limit = 8
	}
	var filter string
	if excludeID > 0 {
		filter = fmt.Sprintf("id != %d", excludeID)
	}
	qCtx, cancel := context.WithTimeout(ctx, searchQueryTimeout)
	defer cancel()
	start := time.Now()
	res, err := client.Search(qCtx, cfg.IndexUID(SearchGroupUsers), meili.SearchQuery{
		Query:                keyword,
		Filter:               filter,
		AttributesToRetrieve: []string{"id"},
		Limit:                limit,
	})
	recordSearchCall(time.Since(start), err)
	if err != nil {
		logrus.Warnf("meilisearch user search fallback to db: %v", err)
		return nil, false
	}

	ids := make([]uint, 0, len(res.Hits))
	for _, hit := range res.Hits {
		if id, ok := meili.HitUintID(hit); ok {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return []model.User{}, true
	}
	users, err := repo.ListActiveUsersByIDs(ids)
	if err != nil {
		return nil, false
	}
	ordered := orderHydratedUsers(users, ids, keyword)
	return ordered, true
}

func orderHydratedUsers(users []model.User, rankedIDs []uint, keyword string) []model.User {
	byID := make(map[uint]model.User, len(users))
	for i := range users {
		byID[users[i].ID] = users[i]
	}
	ordered := make([]model.User, 0, len(users))
	for _, id := range rankedIDs {
		if u, ok := byID[id]; ok {
			ordered = append(ordered, u)
		}
	}
	lowerKw := strings.ToLower(strings.TrimSpace(keyword))
	slices.SortStableFunc(ordered, func(a, b model.User) int {
		aExact := strings.ToLower(a.Username) == lowerKw || strings.ToLower(a.Nickname) == lowerKw
		bExact := strings.ToLower(b.Username) == lowerKw || strings.ToLower(b.Nickname) == lowerKw
		if aExact != bExact {
			if aExact {
				return -1
			}
			return 1
		}
		return 0
	})
	return ordered
}

// ---- 全站公开聚合检索（Posts / Pages / Comments / Users） ----

type SearchService struct{}

func NewSearchService() *SearchService {
	return &SearchService{}
}

func parseSearchTypes(raw string) map[string]bool {
	allowed := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.ToLower(strings.TrimSpace(part))
		if slices.Contains(searchGroups, part) {
			allowed[part] = true
		}
	}
	if len(allowed) == 0 {
		for _, g := range searchGroups {
			allowed[g] = true
		}
	}
	return allowed
}

func emptyGlobalSearchResp(engine string) *dto.GlobalSearchResp {
	return &dto.GlobalSearchResp{
		Engine:   engine,
		Posts:    []dto.SearchPostHitDto{},
		Pages:    []dto.SearchPageHitDto{},
		Comments: []dto.SearchCommentHitDto{},
		Users:    []dto.SearchUserHitDto{},
	}
}

// GlobalSearch 全站公开资源聚合搜索：支持拼音检索、片段裁剪与多端自动回退数据库
func (s *SearchService) GlobalSearch(ctx context.Context, req *dto.GlobalSearchReq, clientIP string) (*dto.GlobalSearchResp, *errs.ServiceError) {
	currentUser, loggedIn := ctxutils.GetCurrentUser(ctx)
	rateKey := "ip:" + clientIP
	var currentUserID uint
	if loggedIn && currentUser != nil {
		currentUserID = currentUser.ID
		rateKey = "u:" + strconv.FormatUint(uint64(currentUserID), 10)
	}
	if !utils.AllowRequest("global_search:"+rateKey, globalSearchRateLimit, globalSearchRateWindow) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}

	query := clipRunes(req.Query, globalSearchMaxRunes)
	limit := req.Limit
	if limit <= 0 {
		limit = globalSearchDefaultLim
	}
	limit = clampInt(limit, 1, globalSearchMaxLim)
	groups := parseSearchTypes(req.Types)

	client, cfg, meiliEnabled := activeMeiliClient(searchQueryTimeout)
	defaultEngine := utils.Ternary(meiliEnabled, "meilisearch", "database")
	if query == "" {
		return emptyGlobalSearchResp(defaultEngine), nil
	}

	if meiliEnabled && hasSearchableToken(query) {
		if resp, ok := s.globalSearchMeili(ctx, client, cfg, query, limit, groups, loggedIn, currentUserID); ok {
			return resp, nil
		}
	}
	return s.globalSearchDatabase(query, limit, groups, loggedIn, currentUserID)
}

func (s *SearchService) globalSearchMeili(
	ctx context.Context,
	client *meili.Client,
	cfg tools.MeilisearchConfig,
	query string,
	limit int,
	groups map[string]bool,
	loggedIn bool,
	currentUserID uint,
) (*dto.GlobalSearchResp, bool) {
	var queries []meili.SearchQuery
	var queryOrder []string

	if groups[SearchGroupPosts] {
		queryOrder = append(queryOrder, SearchGroupPosts)
		queries = append(queries, meili.SearchQuery{
			IndexUID:              cfg.IndexUID(SearchGroupPosts),
			Query:                 query,
			Sort:                  []string{"created_at:desc"},
			AttributesToRetrieve:  []string{"id"},
			AttributesToHighlight: []string{"title", "labels", "category_name", "author_nickname", "description", "ai_summary", "plain_content"},
			AttributesToCrop:      []string{"plain_content"},
			CropLength:            48,
			Limit:                 limit,
		})
	}
	if groups[SearchGroupPages] {
		queryOrder = append(queryOrder, SearchGroupPages)
		queries = append(queries, meili.SearchQuery{
			IndexUID:              cfg.IndexUID(SearchGroupPages),
			Query:                 query,
			AttributesToRetrieve:  []string{"id"},
			AttributesToHighlight: []string{"title", "description", "plain_content"},
			AttributesToCrop:      []string{"plain_content"},
			CropLength:            48,
			Limit:                 limit,
		})
	}
	if groups[SearchGroupComments] {
		queryOrder = append(queryOrder, SearchGroupComments)
		queries = append(queries, meili.SearchQuery{
			IndexUID:              cfg.IndexUID(SearchGroupComments),
			Query:                 query,
			Sort:                  []string{"created_at:desc"},
			AttributesToRetrieve:  []string{"id"},
			AttributesToHighlight: []string{"content", "author_nickname", "target_title"},
			AttributesToCrop:      []string{"content"},
			CropLength:            60,
			Limit:                 limit,
		})
	}
	if groups[SearchGroupUsers] {
		userFilter := `has_public_post = true OR role IN ["admin", "editor"]`
		if loggedIn {
			if currentUserID > 0 {
				userFilter = fmt.Sprintf("id != %d", currentUserID)
			} else {
				userFilter = ""
			}
		}
		queryOrder = append(queryOrder, SearchGroupUsers)
		queries = append(queries, meili.SearchQuery{
			IndexUID:              cfg.IndexUID(SearchGroupUsers),
			Query:                 query,
			Filter:                userFilter,
			AttributesToRetrieve:  []string{"id"},
			AttributesToHighlight: []string{"username", "nickname"},
			Limit:                 limit,
		})
	}

	qCtx, cancel := context.WithTimeout(ctx, searchQueryTimeout)
	defer cancel()
	start := time.Now()
	results, err := client.MultiSearch(qCtx, queries)
	recordSearchCall(time.Since(start), err)
	if err != nil || len(results) != len(queryOrder) {
		if err != nil {
			logrus.Warnf("meilisearch multi-search fallback to db: %v", err)
		}
		return nil, false
	}

	resp := emptyGlobalSearchResp("meilisearch")
	for i, group := range queryOrder {
		res := results[i]
		switch group {
		case SearchGroupPosts:
			hits, ok := hydrateSearchPostHits(res.Hits)
			if !ok {
				return nil, false
			}
			resp.Posts = hits
		case SearchGroupPages:
			hits, ok := hydrateSearchPageHits(res.Hits)
			if !ok {
				return nil, false
			}
			resp.Pages = hits
		case SearchGroupComments:
			hits, ok := hydrateSearchCommentHits(res.Hits)
			if !ok {
				return nil, false
			}
			resp.Comments = hits
		case SearchGroupUsers:
			hits, ok := hydrateSearchUserHits(res.Hits, query)
			if !ok {
				return nil, false
			}
			resp.Users = hits
		}
	}
	return resp, true
}

func hydrateSearchPostHits(hits []map[string]any) ([]dto.SearchPostHitDto, bool) {
	if len(hits) == 0 {
		return []dto.SearchPostHitDto{}, true
	}
	ids := make([]uint, 0, len(hits))
	type meta struct {
		snippet string
		terms   []string
	}
	metaMap := make(map[uint]meta, len(hits))
	for _, h := range hits {
		id, ok := meili.HitUintID(h)
		if !ok {
			continue
		}
		ids = append(ids, id)
		snippet, terms := extractHitSnippetAndTerms(
			h,
			[]string{"plain_content", "description", "ai_summary"},
			[]string{"title", "labels", "category_name", "author_nickname"},
		)
		metaMap[id] = meta{snippet: snippet, terms: terms}
	}
	posts, err := repo.ListPostsByIDsForList(ids, false)
	if err != nil {
		return nil, false
	}
	byID := make(map[uint]*model.Post, len(posts))
	for i := range posts {
		byID[posts[i].ID] = &posts[i]
	}
	out := make([]dto.SearchPostHitDto, 0, len(ids))
	for _, id := range ids {
		p, exists := byID[id]
		if !exists {
			continue
		}
		m := metaMap[id]
		snippet := m.snippet
		if snippet == "" {
			snippet = p.Description
		}
		if snippet == "" {
			snippet = clipRunes(p.Excerpt, 120)
		}
		var catName string
		if p.Category != nil {
			catName = p.Category.Name
		}
		var labels []string
		for _, lb := range p.Labels {
			if lb.Name != "" {
				labels = append(labels, lb.Name)
			}
		}
		author := p.User.Nickname
		if author == "" {
			author = p.User.Username
		}
		out = append(out, dto.SearchPostHitDto{
			ID:             p.ID,
			Title:          p.Title,
			Slug:           p.Slug,
			Cover:          p.Cover,
			Snippet:        snippet,
			CategoryName:   catName,
			Labels:         labels,
			AuthorNickname: author,
			CreatedAt:      p.CreatedAt,
			HighlightTerms: m.terms,
		})
	}
	return out, true
}

func hydrateSearchPageHits(hits []map[string]any) ([]dto.SearchPageHitDto, bool) {
	if len(hits) == 0 {
		return []dto.SearchPageHitDto{}, true
	}
	ids := make([]uint, 0, len(hits))
	type meta struct {
		snippet string
		terms   []string
	}
	metaMap := make(map[uint]meta, len(hits))
	for _, h := range hits {
		id, ok := meili.HitUintID(h)
		if !ok {
			continue
		}
		ids = append(ids, id)
		snippet, terms := extractHitSnippetAndTerms(
			h,
			[]string{"plain_content", "description"},
			[]string{"title"},
		)
		metaMap[id] = meta{snippet: snippet, terms: terms}
	}
	pages, err := repo.ListPagesByIDsForList(ids, false)
	if err != nil {
		return nil, false
	}
	byID := make(map[uint]*model.Page, len(pages))
	for i := range pages {
		byID[pages[i].ID] = &pages[i]
	}
	out := make([]dto.SearchPageHitDto, 0, len(ids))
	for _, id := range ids {
		pg, exists := byID[id]
		if !exists {
			continue
		}
		m := metaMap[id]
		kind := model.NormalizePageKind(pg.Kind)
		snippet := m.snippet
		if snippet == "" {
			snippet = pg.Description
		}
		if snippet == "" && kind == model.PageKindContent {
			snippet = clipRunes(utils.HTMLSearchText(pg.Content, 160), 100)
		}
		out = append(out, dto.SearchPageHitDto{
			ID:             pg.ID,
			Title:          pg.Title,
			Slug:           pg.Slug,
			Kind:           kind,
			LinkURL:        pg.LinkURL,
			Snippet:        snippet,
			HighlightTerms: m.terms,
		})
	}
	return out, true
}

func hydrateSearchCommentHits(hits []map[string]any) ([]dto.SearchCommentHitDto, bool) {
	if len(hits) == 0 {
		return []dto.SearchCommentHitDto{}, true
	}
	ids := make([]uint, 0, len(hits))
	type meta struct {
		snippet string
		terms   []string
	}
	metaMap := make(map[uint]meta, len(hits))
	for _, h := range hits {
		id, ok := meili.HitUintID(h)
		if !ok {
			continue
		}
		ids = append(ids, id)
		snippet, terms := extractHitSnippetAndTerms(
			h,
			[]string{"content"},
			[]string{"author_nickname", "target_title"},
		)
		metaMap[id] = meta{snippet: snippet, terms: terms}
	}
	items, err := repo.ListPublicCommentsByIDs(ids)
	if err != nil {
		return nil, false
	}
	byID := make(map[uint]repo.PublicCommentWithTarget, len(items))
	for i := range items {
		byID[items[i].Comment.ID] = items[i]
	}
	out := make([]dto.SearchCommentHitDto, 0, len(ids))
	for _, id := range ids {
		item, exists := byID[id]
		if !exists {
			continue
		}
		m := metaMap[id]
		content := m.snippet
		if content == "" {
			content = clipRunes(item.Comment.Content, 120)
		}
		var brief *dto.UserBriefDto
		if item.Comment.User.ID > 0 {
			b := item.Comment.User.ToBriefDto()
			brief = &b
		}
		out = append(out, dto.SearchCommentHitDto{
			ID:             item.Comment.ID,
			Content:        content,
			User:           brief,
			TargetType:     item.Comment.TargetType,
			TargetID:       item.Comment.TargetID,
			TargetTitle:    item.TargetTitle,
			TargetSlug:     item.TargetSlug,
			CreatedAt:      item.Comment.CreatedAt,
			HighlightTerms: m.terms,
		})
	}
	return out, true
}

func hydrateSearchUserHits(hits []map[string]any, query string) ([]dto.SearchUserHitDto, bool) {
	if len(hits) == 0 {
		return []dto.SearchUserHitDto{}, true
	}
	ids := make([]uint, 0, len(hits))
	termsMap := make(map[uint][]string, len(hits))
	for _, h := range hits {
		id, ok := meili.HitUintID(h)
		if !ok {
			continue
		}
		ids = append(ids, id)
		_, terms := extractHitSnippetAndTerms(h, nil, []string{"username", "nickname"})
		termsMap[id] = terms
	}
	users, err := repo.ListActiveUsersByIDs(ids)
	if err != nil {
		return nil, false
	}
	ordered := orderHydratedUsers(users, ids, query)
	out := make([]dto.SearchUserHitDto, 0, len(ordered))
	for i := range ordered {
		out = append(out, dto.SearchUserHitDto{
			UserBriefDto:   ordered[i].ToBriefDto(),
			HighlightTerms: termsMap[ordered[i].ID],
		})
	}
	return out, true
}

func (s *SearchService) globalSearchDatabase(
	query string,
	limit int,
	groups map[string]bool,
	loggedIn bool,
	currentUserID uint,
) (*dto.GlobalSearchResp, *errs.ServiceError) {
	resp := emptyGlobalSearchResp("database")
	terms := strings.Fields(query)

	if groups[SearchGroupPosts] {
		posts, _, err := repo.Post.ListPosts(false, []string{query}, &dto.ListPostReq{
			PaginationParams: dto.PaginationParams{Page: 1, Size: uint64(limit), OrderBy: constant.OrderByCreatedAt, Desc: true},
		})
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
		}
		for i := range posts {
			p := &posts[i]
			snippet := p.Description
			if snippet == "" {
				snippet = clipRunes(p.Excerpt, 120)
			}
			var catName string
			if p.Category != nil {
				catName = p.Category.Name
			}
			var labels []string
			for _, lb := range p.Labels {
				if lb.Name != "" {
					labels = append(labels, lb.Name)
				}
			}
			author := p.User.Nickname
			if author == "" {
				author = p.User.Username
			}
			resp.Posts = append(resp.Posts, dto.SearchPostHitDto{
				ID:             p.ID,
				Title:          p.Title,
				Slug:           p.Slug,
				Cover:          p.Cover,
				Snippet:        snippet,
				CategoryName:   catName,
				Labels:         labels,
				AuthorNickname: author,
				CreatedAt:      p.CreatedAt,
				HighlightTerms: terms,
			})
		}
	}

	if groups[SearchGroupPages] {
		pages, _, err := repo.Page.ListPages(false, &dto.ListPageReq{
			PaginationParams: dto.PaginationParams{Page: 1, Size: uint64(limit), OrderBy: constant.OrderByCreatedAt, Desc: true},
		}, []string{query})
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("page")
		}
		for i := range pages {
			pg := &pages[i]
			kind := model.NormalizePageKind(pg.Kind)
			snippet := pg.Description
			if snippet == "" && kind == model.PageKindContent {
				snippet = clipRunes(utils.HTMLSearchText(pg.Content, 160), 100)
			}
			resp.Pages = append(resp.Pages, dto.SearchPageHitDto{
				ID:             pg.ID,
				Title:          pg.Title,
				Slug:           pg.Slug,
				Kind:           kind,
				LinkURL:        pg.LinkURL,
				Snippet:        snippet,
				HighlightTerms: terms,
			})
		}
	}

	if groups[SearchGroupComments] {
		comments, err := repo.SearchPublicCommentsDB(query, limit)
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("comment")
		}
		for i := range comments {
			c := &comments[i]
			var brief *dto.UserBriefDto
			if c.Comment.User.ID > 0 {
				b := c.Comment.User.ToBriefDto()
				brief = &b
			}
			resp.Comments = append(resp.Comments, dto.SearchCommentHitDto{
				ID:             c.Comment.ID,
				Content:        clipRunes(c.Comment.Content, 120),
				User:           brief,
				TargetType:     c.Comment.TargetType,
				TargetID:       c.Comment.TargetID,
				TargetTitle:    c.TargetTitle,
				TargetSlug:     c.TargetSlug,
				CreatedAt:      c.Comment.CreatedAt,
				HighlightTerms: terms,
			})
		}
	}

	if groups[SearchGroupUsers] {
		users, err := repo.SearchPublicCreatorsDB(query, loggedIn, currentUserID, limit)
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("user")
		}
		for i := range users {
			resp.Users = append(resp.Users, dto.SearchUserHitDto{
				UserBriefDto:   users[i].ToBriefDto(),
				HighlightTerms: terms,
			})
		}
	}

	return resp, nil
}

// ---- 管理员测试连接与全量重建接口 ----

// TestMeilisearch 使用后台表单当前填写的地址与密钥（未传项沿用生效配置）验证服务连通性与密钥权限，不改动数据库
func (s *AdminService) TestMeilisearch(ctx context.Context, req *dto.TestMeilisearchReq) (*dto.TestMeilisearchResp, *errs.ServiceError) {
	cfg := tools.GetMeilisearchConfig()
	if req != nil {
		if req.URL != nil {
			rawURL := strings.TrimSpace(*req.URL)
			if rawURL != "" {
				cfg.URL = tools.NormalizeMeilisearchURL(rawURL)
				if cfg.URL == "" {
					return nil, errs.NewBadRequest("meilisearch_url_required")
				}
			}
		}
		if req.APIKey != nil {
			cfg.APIKey = strings.TrimSpace(*req.APIKey)
		}
		if req.IndexPrefix != nil {
			cfg.IndexPrefix = tools.NormalizeMeilisearchPrefix(*req.IndexPrefix)
		}
	}
	if cfg.URL == "" {
		return nil, errs.NewBadRequest("meilisearch_url_required")
	}

	client := meili.NewClient(cfg.URL, cfg.APIKey, 6*time.Second)
	searchClientHolder.mu.Lock()
	if searchClientHolder.transport != nil {
		client.WithTransport(searchClientHolder.transport)
	}
	searchClientHolder.mu.Unlock()

	tCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()

	if err := client.Health(tCtx); err != nil {
		return nil, errs.NewBadRequest("meilisearch_test_failed").WithDetail(err.Error())
	}
	version, err := client.Version(tCtx)
	if err != nil {
		return nil, errs.NewBadRequest("meilisearch_test_failed").WithDetail(err.Error())
	}
	stats, err := client.Stats(tCtx)
	if err != nil {
		return nil, errs.NewBadRequest("meilisearch_test_failed").WithDetail(err.Error())
	}
	return &dto.TestMeilisearchResp{
		Version:      version,
		Location:     client.Location(),
		DatabaseSize: stats.DatabaseSize,
	}, nil
}

// ReindexSearch 手动触发全站公开资源索引平滑重建
func (s *AdminService) ReindexSearch() (*dto.ReindexSearchResp, *errs.ServiceError) {
	if !tools.GetMeilisearchConfig().Enabled() {
		return nil, errs.NewBadRequest("meilisearch_not_enabled")
	}
	res, err := TriggerSearchReindex()
	if err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("search")
	}
	return &res, nil
}
