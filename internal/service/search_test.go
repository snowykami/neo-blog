package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/meili"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// mockMeiliServer 内存态 Meilisearch 模拟器（通过 RoundTripper 运行，不监听本地端口以兼容受限沙盒）
type mockMeiliServer struct {
	mu          sync.Mutex
	apiKey      string
	failAll     bool
	indexes     map[string]*mockMeiliIndex
	enqueuedCnt int64
	failedCnt   int64
}

type mockMeiliIndex struct {
	uid      string
	settings meili.IndexSettings
	docs     map[uint]map[string]any
}

func newMockMeiliServer(apiKey string) *mockMeiliServer {
	return &mockMeiliServer{
		apiKey:  apiKey,
		indexes: make(map[string]*mockMeiliIndex),
	}
}

func (m *mockMeiliServer) RoundTrip(req *http.Request) (*http.Response, error) {
	rec := httptest.NewRecorder()
	m.serveHTTP(rec, req)
	return rec.Result(), nil
}

func (m *mockMeiliServer) getOrCreateIndexLocked(uid string) *mockMeiliIndex {
	idx, ok := m.indexes[uid]
	if !ok {
		idx = &mockMeiliIndex{
			uid:  uid,
			docs: make(map[uint]map[string]any),
		}
		m.indexes[uid] = idx
	}
	return idx
}

func (m *mockMeiliServer) docSnapshot(uid string) map[uint]map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[uint]map[string]any)
	idx, ok := m.indexes[uid]
	if !ok {
		return out
	}
	for k, doc := range idx.docs {
		cp := make(map[string]any, len(doc))
		for dk, dv := range doc {
			cp[dk] = dv
		}
		out[k] = cp
	}
	return out
}

func (m *mockMeiliServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	if m.failAll {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]any{"message": "service unavailable", "code": "internal"})
		return
	}

	path := r.URL.Path
	// /health 在 Meilisearch 中无需鉴权，其余接口校验 Bearer API Key
	if path != "/health" && m.apiKey != "" {
		if r.Header.Get("Authorization") != "Bearer "+m.apiKey {
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "invalid api key", "code": "invalid_api_key"})
			return
		}
	}

	var rawBody []byte
	if r.Body != nil {
		rawBody, _ = io.ReadAll(r.Body)
	}

	switch {
	case r.Method == http.MethodGet && path == "/health":
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "available"})
	case r.Method == http.MethodGet && path == "/version":
		_ = json.NewEncoder(w).Encode(map[string]string{"pkgVersion": "1.12.0"})
	case r.Method == http.MethodGet && path == "/stats":
		idxStats := make(map[string]any, len(m.indexes))
		for uid, idx := range m.indexes {
			idxStats[uid] = map[string]any{
				"numberOfDocuments": len(idx.docs),
				"isIndexing":        false,
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"databaseSize":     int64(2 * 1024 * 1024),
			"usedDatabaseSize": int64(512 * 1024),
			"indexes":          idxStats,
		})
	case r.Method == http.MethodGet && path == "/tasks":
		statuses := r.URL.Query().Get("statuses")
		total := int64(0)
		if strings.Contains(statuses, "enqueued") {
			total = m.enqueuedCnt
		} else if strings.Contains(statuses, "failed") {
			total = m.failedCnt
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{}, "total": total})
	case r.Method == http.MethodPost && path == "/indexes":
		var body struct {
			UID string `json:"uid"`
		}
		_ = json.Unmarshal(rawBody, &body)
		m.getOrCreateIndexLocked(body.UID)
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"taskUid": 1, "indexUid": body.UID, "status": "enqueued"})
	case r.Method == http.MethodPost && path == "/multi-search":
		var body struct {
			Queries []meili.SearchQuery `json:"queries"`
		}
		_ = json.Unmarshal(rawBody, &body)
		results := make([]meili.SearchResult, 0, len(body.Queries))
		for _, q := range body.Queries {
			results = append(results, m.runSearchLocked(q.IndexUID, q))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
	case strings.HasPrefix(path, "/indexes/"):
		rest := strings.TrimPrefix(path, "/indexes/")
		parts := strings.Split(rest, "/")
		uid := parts[0]
		sub := strings.Join(parts[1:], "/")
		idx := m.getOrCreateIndexLocked(uid)

		switch {
		case r.Method == http.MethodPatch && sub == "settings":
			_ = json.Unmarshal(rawBody, &idx.settings)
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"taskUid": 2})
		case r.Method == http.MethodPost && sub == "documents":
			var arr []map[string]any
			_ = json.Unmarshal(rawBody, &arr)
			for _, d := range arr {
				id := extractUint(d["id"])
				if id > 0 {
					idx.docs[id] = d
				}
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"taskUid": 3})
		case r.Method == http.MethodGet && sub == "documents":
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			if limit <= 0 {
				limit = 100
			}
			ids := make([]uint, 0, len(idx.docs))
			for id := range idx.docs {
				ids = append(ids, id)
			}
			slices.Sort(ids)
			var out []map[string]any
			for i := offset; i < len(ids) && len(out) < limit; i++ {
				out = append(out, map[string]any{"id": ids[i]})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"results": out, "total": len(ids)})
		case r.Method == http.MethodPost && sub == "documents/delete-batch":
			var ids []uint
			_ = json.Unmarshal(rawBody, &ids)
			for _, id := range ids {
				delete(idx.docs, id)
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"taskUid": 4})
		case r.Method == http.MethodPost && sub == "documents/delete":
			var body struct {
				Filter string `json:"filter"`
			}
			_ = json.Unmarshal(rawBody, &body)
			for id, doc := range idx.docs {
				if evalMockFilter(doc, body.Filter) {
					delete(idx.docs, id)
				}
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"taskUid": 5})
		case r.Method == http.MethodDelete && strings.HasPrefix(sub, "documents/"):
			idStr := strings.TrimPrefix(sub, "documents/")
			if id, err := strconv.ParseUint(idStr, 10, 64); err == nil {
				delete(idx.docs, uint(id))
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"taskUid": 6})
		case r.Method == http.MethodPost && sub == "search":
			var q meili.SearchQuery
			_ = json.Unmarshal(rawBody, &q)
			res := m.runSearchLocked(uid, q)
			_ = json.NewEncoder(w).Encode(res)
		default:
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "not found"})
		}
	default:
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"message": "not found"})
	}
}

func (m *mockMeiliServer) runSearchLocked(uid string, q meili.SearchQuery) meili.SearchResult {
	idx, ok := m.indexes[uid]
	if !ok {
		return meili.SearchResult{Hits: []map[string]any{}}
	}
	tokens := strings.Fields(strings.ToLower(strings.TrimSpace(q.Query)))
	searchable := idx.settings.SearchableAttributes
	if len(searchable) == 0 {
		searchable = []string{"title", "title_pinyin", "title_initials", "username", "nickname", "nickname_pinyin", "nickname_initials", "content", "plain_content"}
	}

	type scored struct {
		id   uint
		rank int
		hit  map[string]any
	}
	var matched []scored
	for id, doc := range idx.docs {
		if !evalMockFilter(doc, q.Filter) {
			continue
		}
		bestRank := -1
		if len(tokens) == 0 {
			bestRank = 0
		} else {
			allTokensMatched := true
			for _, tk := range tokens {
				tkRank := -1
				for attrIdx, attr := range searchable {
					if valContains(doc[attr], tk) {
						tkRank = attrIdx
						break
					}
				}
				if tkRank < 0 {
					allTokensMatched = false
					break
				}
				if bestRank < 0 || tkRank > bestRank {
					bestRank = tkRank
				}
			}
			if !allTokensMatched {
				continue
			}
		}

		hit := map[string]any{"id": id}
		if len(q.AttributesToHighlight) > 0 {
			pre := q.HighlightPreTag
			post := q.HighlightPostTag
			formatted := make(map[string]any)
			for _, attr := range q.AttributesToHighlight {
				switch v := doc[attr].(type) {
				case string:
					text := v
					if slices.Contains(q.AttributesToCrop, attr) && q.CropLength > 0 {
						runes := []rune(text)
						if len(runes) > q.CropLength {
							text = string(runes[:q.CropLength]) + "…"
						}
					}
					formatted[attr] = highlightMockString(text, tokens, pre, post)
				case []any:
					arr := make([]string, 0, len(v))
					for _, elem := range v {
						if s, ok := elem.(string); ok {
							arr = append(arr, highlightMockString(s, tokens, pre, post))
						}
					}
					formatted[attr] = arr
				}
			}
			hit["_formatted"] = formatted
		}
		matched = append(matched, scored{id: id, rank: bestRank, hit: hit})
	}

	slices.SortFunc(matched, func(a, b scored) int {
		if a.rank != b.rank {
			return a.rank - b.rank
		}
		return int(b.id) - int(a.id)
	})

	total := int64(len(matched))
	offset := q.Offset
	limit := q.Limit
	if q.HitsPerPage > 0 {
		limit = q.HitsPerPage
		page := max(q.Page, 1)
		offset = (page - 1) * limit
	}
	if limit <= 0 {
		limit = 20
	}
	hits := make([]map[string]any, 0, limit)
	for i := offset; i < len(matched) && len(hits) < limit; i++ {
		hits = append(hits, matched[i].hit)
	}
	return meili.SearchResult{
		Hits:               hits,
		EstimatedTotalHits: total,
		TotalHits:          total,
	}
}

func highlightMockString(s string, tokens []string, pre, post string) string {
	if s == "" || len(tokens) == 0 || pre == "" {
		return s
	}
	out := s
	for _, tk := range tokens {
		if tk == "" {
			continue
		}
		lower := strings.ToLower(out)
		idx := strings.Index(lower, tk)
		if idx >= 0 {
			var buf bytes.Buffer
			buf.WriteString(out[:idx])
			buf.WriteString(pre)
			buf.WriteString(out[idx : idx+len(tk)])
			buf.WriteString(post)
			buf.WriteString(out[idx+len(tk):])
			out = buf.String()
		}
	}
	return out
}

func valContains(v any, tokenLower string) bool {
	switch val := v.(type) {
	case string:
		return strings.Contains(strings.ToLower(val), tokenLower)
	case []any:
		for _, item := range val {
			if s, ok := item.(string); ok && strings.Contains(strings.ToLower(s), tokenLower) {
				return true
			}
		}
	}
	return false
}

func extractUint(v any) uint {
	switch n := v.(type) {
	case float64:
		return uint(n)
	case uint:
		return n
	case int:
		return uint(n)
	}
	return 0
}

func evalMockFilter(doc map[string]any, filter string) bool {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return true
	}
	if filter == `has_public_post = true OR role IN ["admin", "editor"]` {
		hp, _ := doc["has_public_post"].(bool)
		role, _ := doc["role"].(string)
		return hp || role == "admin" || role == "editor"
	}
	parts := strings.Split(filter, " AND ")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		switch {
		case strings.Contains(part, "!="):
			kv := strings.SplitN(part, "!=", 2)
			field := strings.TrimSpace(kv[0])
			want, _ := strconv.ParseUint(strings.TrimSpace(kv[1]), 10, 64)
			if extractUint(doc[field]) == uint(want) {
				return false
			}
		case strings.Contains(part, "="):
			kv := strings.SplitN(part, "=", 2)
			field := strings.TrimSpace(kv[0])
			raw := strings.Trim(strings.TrimSpace(kv[1]), `"`)
			switch field {
			case "target_type", "role", "kind":
				s, _ := doc[field].(string)
				if s != raw {
					return false
				}
			case "show_in_nav", "has_public_post":
				b, _ := doc[field].(bool)
				if b != (raw == "true") {
					return false
				}
			case "label_ids":
				want, _ := strconv.ParseUint(raw, 10, 64)
				arr, _ := doc["label_ids"].([]any)
				matched := false
				for _, x := range arr {
					if extractUint(x) == uint(want) {
						matched = true
						break
					}
				}
				if !matched {
					return false
				}
			default:
				want, _ := strconv.ParseUint(raw, 10, 64)
				if extractUint(doc[field]) != uint(want) {
					return false
				}
			}
		}
	}
	return true
}

func setupSearchTestEnv(t *testing.T) (*mockMeiliServer, context.Context, context.Context, context.Context, []*model.User) {
	t.Helper()
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	t.Setenv(constant.EnvKeyMeilisearchEnable, "true")
	t.Setenv(constant.EnvKeyMeilisearchURL, "http://meili.test:7700")
	t.Setenv(constant.EnvKeyMeilisearchAPIKey, "master-secret")
	t.Setenv(constant.EnvKeyMeilisearchIndexPrefix, "testblog_")

	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	mock := newMockMeiliServer("master-secret")
	searchClientHolder.mu.Lock()
	searchClientHolder.url = ""
	searchClientHolder.apiKey = ""
	searchClientHolder.client = nil
	searchClientHolder.transport = mock
	searchClientHolder.syncInline = true
	searchClientHolder.mu.Unlock()
	resetSearchMetricsCountersForTest()

	t.Cleanup(func() {
		searchClientHolder.mu.Lock()
		searchClientHolder.url = ""
		searchClientHolder.apiKey = ""
		searchClientHolder.client = nil
		searchClientHolder.transport = nil
		searchClientHolder.syncInline = false
		searchClientHolder.mu.Unlock()
	})

	users := []*model.User{
		{Username: "snowy", Nickname: "雪神", Email: "snowy@secret.local", Role: constant.RoleAdmin},
		{Username: "chenfeng", Nickname: "晨风", Email: "chen@secret.local", Role: constant.RoleEditor},
		{Username: "luren", Nickname: "路人甲", Email: "luren@secret.local", Role: constant.RoleUser},
		{Username: "banned", Nickname: "封禁用户", Email: "ban@secret.local", Role: constant.RoleUser, Disabled: true},
	}
	for _, u := range users {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Username, err)
		}
	}
	ctxOf := func(u *model.User) context.Context { return context.WithValue(context.Background(), "user_id", u.ID) }
	return mock, ctxOf(users[0]), ctxOf(users[1]), ctxOf(users[2]), users
}

func resetSearchMetricsCountersForTest() {
	searchStats.calls.Store(0)
	searchStats.nanos.Store(0)
	searchStats.lastFlush.Store(0)
}

func TestMeilisearchPublicOnlySyncAndPinyinSearch(t *testing.T) {
	mock, adminCtx, editorCtx, readerCtx, users := setupSearchTestEnv(t)

	// 创建标签与分类
	lbGo := &model.Label{Name: "云原生", Slug: "cloud-native"}
	if err := repo.GetDB().Create(lbGo).Error; err != nil {
		t.Fatalf("create label: %v", err)
	}
	cat := &model.Category{Name: "架构设计", Slug: "arch"}
	if err := repo.GetDB().Create(cat).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}

	isPublic := false
	isPrivate := true
	draftSecret := "<p>绝密未发布草稿 secret_draft_token</p>"

	// 1. 公开文章（带中文标题、代码块与未发布草稿）
	pubPostID, svcerr := NewPostService().CreatePost(editorCtx, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{
			Title:        "深入理解重庆分布式缓存",
			Content:      "<p>本文讲解缓存一致性。</p><pre><code>redis.SetNX(key, val)</code></pre><script>alert('xss')</script>",
			DraftContent: &draftSecret,
			CategoryID:   &cat.ID,
			LabelIds:     []uint{lbGo.ID},
		},
		IsPrivate: &isPublic,
	})
	if svcerr != nil {
		t.Fatalf("create public post: %v", svcerr)
	}

	// 2. 私密文章（绝不能进入索引）
	privPostID, svcerr := NewPostService().CreatePost(editorCtx, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{
			Title:   "私密日记不对外公开",
			Content: "<p>private_diary_secret</p>",
		},
		IsPrivate: &isPrivate,
	})
	if svcerr != nil {
		t.Fatalf("create private post: %v", svcerr)
	}

	// 3. 公开页面（正文页 + HTML 静态包页）与私密页面
	contentKind := model.PageKindContent
	htmlKind := model.PageKindHTML
	pubPageID, svcerr := NewPageService().CreatePage(adminCtx, &dto.CreateOrUpdatePageReq{
		PageBaseDto: dto.PageBaseDto{
			Title:   "关于本站",
			Slug:    "about",
			Content: "<p>欢迎来到新博客系统</p>",
		},
		Kind:        &contentKind,
		Description: new("站点介绍"),
		IsPrivate:   &isPublic,
	})
	if svcerr != nil {
		t.Fatalf("create public content page: %v", svcerr)
	}
	htmlPageID, svcerr := NewPageService().CreatePage(adminCtx, &dto.CreateOrUpdatePageReq{
		PageBaseDto: dto.PageBaseDto{
			Title:   "互动实验室",
			Slug:    "lab",
			Content: "<p>should_not_be_indexed_for_html_kind</p>",
		},
		Kind:        &htmlKind,
		Description: new("WebGL 演示合集"),
		IsPrivate:   &isPublic,
	})
	if svcerr != nil {
		t.Fatalf("create html page: %v", svcerr)
	}
	privPageID, svcerr := NewPageService().CreatePage(adminCtx, &dto.CreateOrUpdatePageReq{
		PageBaseDto: dto.PageBaseDto{
			Title:   "内部运维手册",
			Slug:    "ops-secret",
			Content: "<p>internal_ops_only</p>",
		},
		IsPrivate: &isPrivate,
	})
	if svcerr != nil {
		t.Fatalf("create private page: %v", svcerr)
	}

	// 4. 公开评论、私密评论、以及私密文章下的公开评论
	pubCommentID, svcerr := NewCommentService().CreateComment(readerCtx, &dto.CreateCommentReq{
		TargetType: constant.TargetTypePost,
		TargetID:   pubPostID,
		Content:    "这篇分布式文章写得非常透彻！",
		IsPrivate:  false,
	})
	if svcerr != nil {
		t.Fatalf("create public comment: %v", svcerr)
	}
	privCommentID, svcerr := NewCommentService().CreateComment(readerCtx, &dto.CreateCommentReq{
		TargetType: constant.TargetTypePost,
		TargetID:   pubPostID,
		Content:    "悄悄话评论 secret_whisper",
		IsPrivate:  true,
	})
	if svcerr != nil {
		t.Fatalf("create private comment: %v", svcerr)
	}
	commentOnPrivPostID, svcerr := NewCommentService().CreateComment(editorCtx, &dto.CreateCommentReq{
		TargetType: constant.TargetTypePost,
		TargetID:   privPostID,
		Content:    "私密文章下的自言自语",
		IsPrivate:  false,
	})
	if svcerr != nil {
		t.Fatalf("create comment on private post: %v", svcerr)
	}

	// 执行全量平滑重建，校验索引物理隔离性
	reindexResp, svcerr := NewAdminService().ReindexSearch()
	if svcerr != nil || !reindexResp.Started {
		t.Fatalf("reindex search failed: resp=%+v err=%v", reindexResp, svcerr)
	}

	postDocs := mock.docSnapshot("testblog_posts")
	if _, ok := postDocs[pubPostID]; !ok {
		t.Fatalf("expected public post %d in index", pubPostID)
	}
	if _, ok := postDocs[privPostID]; ok {
		t.Fatalf("private post %d MUST NOT be in index", privPostID)
	}
	plainBody, _ := postDocs[pubPostID]["plain_content"].(string)
	if strings.Contains(plainBody, "secret_draft_token") || strings.Contains(plainBody, "alert(") {
		t.Fatalf("draft content or script leaked into plain_content: %q", plainBody)
	}
	if !strings.Contains(plainBody, "redis.SetNX") {
		t.Fatalf("expected code block preserved in plain_content, got %q", plainBody)
	}

	pageDocs := mock.docSnapshot("testblog_pages")
	if _, ok := pageDocs[pubPageID]; !ok {
		t.Fatalf("expected public page %d in index", pubPageID)
	}
	if _, ok := pageDocs[privPageID]; ok {
		t.Fatalf("private page %d MUST NOT be in index", privPageID)
	}
	if htmlPlain, _ := pageDocs[htmlPageID]["plain_content"].(string); htmlPlain != "" {
		t.Fatalf("html page should only index title/description, got plain_content=%q", htmlPlain)
	}

	commentDocs := mock.docSnapshot("testblog_comments")
	if _, ok := commentDocs[pubCommentID]; !ok {
		t.Fatalf("expected public comment %d in index", pubCommentID)
	}
	if _, ok := commentDocs[privCommentID]; ok {
		t.Fatalf("private comment %d MUST NOT be in index", privCommentID)
	}
	if _, ok := commentDocs[commentOnPrivPostID]; ok {
		t.Fatalf("comment %d on private post MUST NOT be in index", commentOnPrivPostID)
	}

	userDocs := mock.docSnapshot("testblog_users")
	if _, ok := userDocs[users[3].ID]; ok {
		t.Fatalf("disabled user %d MUST NOT be in index", users[3].ID)
	}
	for uid, doc := range userDocs {
		raw, _ := json.Marshal(doc)
		if strings.Contains(string(raw), "secret.local") || strings.Contains(string(raw), "email") {
			t.Fatalf("user %d index doc leaked email field: %s", uid, string(raw))
		}
	}

	// 5. 测试多音字拼音与首字母检索（"重庆" -> chongqing / srylzqfbshc）
	posts, total, svcerr := NewPostService().ListPosts(context.Background(), &dto.ListPostReq{
		Query:            "chongqing",
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10},
	})
	if svcerr != nil || total != 1 || len(posts) != 1 || posts[0].ID != pubPostID {
		t.Fatalf("pinyin search 'chongqing' failed: total=%d len=%d err=%v", total, len(posts), svcerr)
	}

	// 代码标识符检索与摘要裁剪高亮词提取
	posts, total, svcerr = NewPostService().ListPosts(context.Background(), &dto.ListPostReq{
		Query:            "SetNX",
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10},
	})
	if svcerr != nil || total != 1 || posts[0].SearchSnippet == "" || len(posts[0].HighlightTerms) == 0 {
		t.Fatalf("code token search failed: total=%d post=%+v err=%v", total, posts, svcerr)
	}

	// 6. 测试全站聚合搜索：未登录访客搜用户只返回创作者（有公开文章或编辑/管理员），不暴露纯路人账号
	guestRes, svcerr := NewSearchService().GlobalSearch(context.Background(), &dto.GlobalSearchReq{
		Query: "lu", // 匹配 luren，但路人甲无公开文章且角色为 user
		Limit: 10,
	}, "203.0.113.10")
	if svcerr != nil {
		t.Fatalf("guest global search error: %v", svcerr)
	}
	if len(guestRes.Users) != 0 {
		t.Fatalf("guest user search should NOT expose non-creator ordinary user, got %+v", guestRes.Users)
	}

	// 访客按拼音搜作者 "chenfeng" 可正常搜到编辑者
	guestCreatorRes, svcerr := NewSearchService().GlobalSearch(context.Background(), &dto.GlobalSearchReq{
		Query: "cf", // 晨风首字母
		Limit: 10,
	}, "203.0.113.10")
	if svcerr != nil || len(guestCreatorRes.Users) == 0 || guestCreatorRes.Users[0].ID != users[1].ID {
		t.Fatalf("guest creator initials search failed: res=%+v err=%v", guestCreatorRes, svcerr)
	}

	// 登录用户聚合搜索与 @提及候选搜索可以按拼音搜到活跃普通用户（排除自己）
	loggedRes, svcerr := NewSearchService().GlobalSearch(adminCtx, &dto.GlobalSearchReq{
		Query: "lrj", // 路人甲首字母
		Limit: 10,
	}, "203.0.113.11")
	if svcerr != nil || len(loggedRes.Users) != 1 || loggedRes.Users[0].ID != users[2].ID {
		t.Fatalf("logged-in user initials search failed: res=%+v err=%v", loggedRes, svcerr)
	}

	// 通配符 "%" 不得作为占位符全量返回用户
	wildcardUsers, svcerr := NewUserService().SearchUsers(adminCtx, &dto.SearchUsersReq{Query: "%", Limit: 10})
	if svcerr != nil || len(wildcardUsers) != 0 {
		t.Fatalf("wildcard '%%' user search must return 0 results, got %+v err=%v", wildcardUsers, svcerr)
	}

	// 7. 可见性动态翻转：公开文章改为私密 -> 文章与底下公开评论同步从索引物理移除
	if _, svcerr := NewPostService().UpdatePost(editorCtx, &dto.CreateOrUpdatePostReq{
		ID:        pubPostID,
		IsPrivate: &isPrivate,
	}); svcerr != nil {
		t.Fatalf("set post private: %v", svcerr)
	}
	if _, ok := mock.docSnapshot("testblog_posts")[pubPostID]; ok {
		t.Fatalf("post %d should be removed from index immediately when turned private", pubPostID)
	}
	if _, ok := mock.docSnapshot("testblog_comments")[pubCommentID]; ok {
		t.Fatalf("comment %d under newly-private post %d must be removed from index", pubCommentID, pubPostID)
	}
	// 作者已无公开文章，has_public_post 应自动更新为 false
	if hp, _ := mock.docSnapshot("testblog_users")[users[1].ID]["has_public_post"].(bool); hp {
		t.Fatalf("author has_public_post should become false after hiding only public post")
	}

	// 重新设为公开 -> 文章与底下公开评论恢复入索引，私密评论仍不入索引
	if _, svcerr := NewPostService().UpdatePost(editorCtx, &dto.CreateOrUpdatePostReq{
		ID:        pubPostID,
		IsPrivate: &isPublic,
	}); svcerr != nil {
		t.Fatalf("set post public again: %v", svcerr)
	}
	if _, ok := mock.docSnapshot("testblog_posts")[pubPostID]; !ok {
		t.Fatalf("post %d should be re-indexed when turned public", pubPostID)
	}
	if _, ok := mock.docSnapshot("testblog_comments")[pubCommentID]; !ok {
		t.Fatalf("public comment %d should be re-indexed when post turned public", pubCommentID)
	}
	if _, ok := mock.docSnapshot("testblog_comments")[privCommentID]; ok {
		t.Fatalf("private comment %d must remain excluded when post turned public", privCommentID)
	}
}

func TestMeilisearchFallbackMonitoringAndTestEndpoint(t *testing.T) {
	mock, adminCtx, editorCtx, _, _ := setupSearchTestEnv(t)

	isPublic := false
	postID, svcerr := NewPostService().CreatePost(editorCtx, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{
			Title:   "高可用降级测试文章",
			Content: "<p>当搜索引擎故障时自动回退数据库查询</p>",
		},
		IsPrivate: &isPublic,
	})
	if svcerr != nil {
		t.Fatalf("create post: %v", svcerr)
	}

	// 1. Admin TestMeilisearch：正确密钥成功，错误密钥报错
	testOK, svcerr := NewAdminService().TestMeilisearch(adminCtx, &dto.TestMeilisearchReq{})
	if svcerr != nil || testOK.Version != "1.12.0" {
		t.Fatalf("TestMeilisearch expected success, got resp=%+v err=%v", testOK, svcerr)
	}
	wrongKey := "wrong-key"
	if _, svcerr := NewAdminService().TestMeilisearch(adminCtx, &dto.TestMeilisearchReq{APIKey: &wrongKey}); svcerr == nil {
		t.Fatalf("TestMeilisearch with wrong api key should fail")
	}

	// 2. 发起一次正常检索并上报指标，验证运行状态依赖监控卡片数据
	if _, _, svcerr := NewPostService().ListPosts(context.Background(), &dto.ListPostReq{Query: "高可用", PaginationParams: dto.PaginationParams{Page: 1, Size: 10}}); svcerr != nil {
		t.Fatalf("list posts via meili: %v", svcerr)
	}
	mock.mu.Lock()
	mock.enqueuedCnt = 3
	mock.mu.Unlock()
	flushSearchStatsInstance()
	SampleDependencyMetrics()

	deps := GetDependencyMetrics()
	if deps == nil || deps.Meilisearch == nil {
		t.Fatalf("expected Meilisearch dependency metrics, got %+v", deps)
	}
	mm := deps.Meilisearch
	if mm.Error != "" || mm.Version != "1.12.0" || mm.PendingTasks != 3 || mm.Documents == 0 {
		t.Fatalf("unexpected Meilisearch metrics: %+v", mm)
	}
	if len(mm.Indexes) != 4 {
		t.Fatalf("expected 4 index stat groups, got %d (%+v)", len(mm.Indexes), mm.Indexes)
	}

	// 3. 模拟 Meilisearch 宕机：前台文章列表与全站聚合搜索无缝降级到数据库，不向用户报错
	mock.mu.Lock()
	mock.failAll = true
	mock.mu.Unlock()

	fallbackPosts, total, svcerr := NewPostService().ListPosts(context.Background(), &dto.ListPostReq{
		Query:            "高可用降级",
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt, Desc: true},
	})
	if svcerr != nil || total != 1 || len(fallbackPosts) != 1 || fallbackPosts[0].ID != postID {
		t.Fatalf("expected seamless DB fallback for ListPosts, got total=%d len=%d err=%v", total, len(fallbackPosts), svcerr)
	}

	fallbackGlobal, svcerr := NewSearchService().GlobalSearch(context.Background(), &dto.GlobalSearchReq{
		Query: "高可用降级",
		Limit: 5,
	}, "203.0.113.55")
	if svcerr != nil || fallbackGlobal.Engine != "database" || len(fallbackGlobal.Posts) != 1 {
		t.Fatalf("expected seamless DB fallback for GlobalSearch, got %+v err=%v", fallbackGlobal, svcerr)
	}

	// 宕机时监控采集记录 Error 状态
	SampleDependencyMetrics()
	depsDown := GetDependencyMetrics()
	if depsDown == nil || depsDown.Meilisearch == nil || depsDown.Meilisearch.Error == "" {
		t.Fatalf("expected Meilisearch error in dependency metrics when down, got %+v", depsDown)
	}
	_ = fmt.Sprint(postID)
}
