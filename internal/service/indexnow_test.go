package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func waitForIndexNowDrain(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		indexNowState.mu.Lock()
		draining := indexNowState.draining
		done := indexNowState.drainDone
		indexNowState.mu.Unlock()
		if !draining {
			return
		}
		if done != nil {
			select {
			case <-done:
			case <-time.After(time.Until(deadline)):
				t.Fatal("timed out waiting for IndexNow queue drain")
			}
		} else {
			if time.Now().After(deadline) {
				t.Fatal("timed out waiting for IndexNow queue idle")
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
}

func setupIndexNowMockServer(t *testing.T, coalesce time.Duration) *struct {
	mu       sync.Mutex
	payloads []indexNowPayload
} {
	t.Helper()
	rec := &struct {
		mu       sync.Mutex
		payloads []indexNowPayload
	}{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		var p indexNowPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Errorf("decode payload: %v", err)
		}
		rec.mu.Lock()
		rec.payloads = append(rec.payloads, p)
		rec.mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))

	indexNowState.mu.Lock()
	indexNowState.endpoint = srv.URL
	indexNowState.client = srv.Client()
	indexNowState.allowLocalHost = true
	indexNowState.enabledInTests = true
	indexNowState.coalesceDelay = coalesce
	indexNowState.pending = nil
	indexNowState.pendingSet = nil
	indexNowState.mu.Unlock()

	t.Cleanup(func() {
		waitForIndexNowDrain(t)
		indexNowState.mu.Lock()
		indexNowState.endpoint = ""
		indexNowState.client = nil
		indexNowState.allowLocalHost = false
		indexNowState.enabledInTests = false
		indexNowState.coalesceDelay = 0
		indexNowState.pending = nil
		indexNowState.pendingSet = nil
		indexNowState.mu.Unlock()
		srv.Close()
	})
	return rec
}

func TestNormalizeIndexNowKeyAndCrossCheck(t *testing.T) {
	setupEditTest(t)

	valid := "a1b2c3d4-E5F6-7890-abcd-ef1234567890"
	if got := tools.NormalizeIndexNowKey(valid); got != valid {
		t.Fatalf("expected %q, got %q", valid, got)
	}
	if got := tools.NormalizeIndexNowKey("  " + valid + ".txt "); got != valid {
		t.Fatalf("expected .txt suffix stripped to %q, got %q", valid, got)
	}
	for _, invalid := range []string{"", "short7", "has_underscore_key", "../etc/passwd", "key with space", "key/slash/1234"} {
		if got := tools.NormalizeIndexNowKey(invalid); got != "" {
			t.Fatalf("expected invalid key %q to normalize to empty, got %q", invalid, got)
		}
	}

	// 开启 IndexNow 但未填密钥时应拒绝保存
	if svcerr := config.Save([]config.Change{{Key: "seo_indexnow_enabled", Value: true}}); svcerr == nil || svcerr.Message != "indexnow_key_invalid" {
		t.Fatalf("expected indexnow_key_invalid when enabling without key, got %v", svcerr)
	}
	// 即使未开启，填入非法密钥也应拒绝保存
	if svcerr := config.Save([]config.Change{{Key: "seo_indexnow_key", Value: "bad_key!"}}); svcerr == nil || svcerr.Message != "indexnow_key_invalid" {
		t.Fatalf("expected indexnow_key_invalid on malformed key, got %v", svcerr)
	}
	// 同时保存合法密钥与开启开关应成功
	if svcerr := config.Save([]config.Change{
		{Key: "seo_indexnow_key", Value: valid},
		{Key: "seo_indexnow_enabled", Value: true},
	}); svcerr != nil {
		t.Fatalf("expected valid IndexNow config save to succeed, got %v", svcerr)
	}
	// 管理员显式在后台关闭开关后，即使环境变量提供了 INDEXNOW_KEY 也必须保持关闭
	t.Setenv(constant.EnvKeyIndexNowKey, valid)
	if svcerr := config.Save([]config.Change{{Key: "seo_indexnow_enabled", Value: false}}); svcerr != nil {
		t.Fatalf("expected disabling IndexNow to succeed, got %v", svcerr)
	}
	if tools.GetIndexNowConfig().Enabled() {
		t.Fatal("expected IndexNowConfig.Enabled() to respect DB false when INDEXNOW_ENABLED env is unset")
	}
}

func TestIsPublicIndexNowHost(t *testing.T) {
	for _, host := range []string{"localhost", "sub.localhost", "127.0.0.1", "::1", "10.0.0.8", "192.168.1.2", "myhost", "app.local"} {
		if isPublicIndexNowHost(host) {
			t.Fatalf("expected %q to be rejected as non-public host", host)
		}
	}
	for _, host := range []string{"blog.sfkm.me", "example.com", "8.8.8.8"} {
		if !isPublicIndexNowHost(host) {
			t.Fatalf("expected %q to be accepted as public host", host)
		}
	}
}

func TestSubmitIndexNowPathsSync(t *testing.T) {
	setupEditTest(t)
	rec := setupIndexNowMockServer(t, 0)

	key := "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
	t.Setenv(constant.EnvKeyBaseUrl, "https://blog.example.com/")
	t.Setenv(constant.EnvKeyIndexNowEnabled, "true")
	t.Setenv(constant.EnvKeyIndexNowKey, key)

	if err := submitIndexNowPathsSync(context.Background(), []string{"/p/hello-world", "/", "/p/hello-world", "a"}); err != nil {
		t.Fatalf("submitIndexNowPathsSync error: %v", err)
	}
	rec.mu.Lock()
	if len(rec.payloads) != 1 {
		t.Fatalf("expected 1 IndexNow HTTP call, got %d", len(rec.payloads))
	}
	received := rec.payloads[0]
	rec.mu.Unlock()

	if received.Host != "blog.example.com" || received.Key != key {
		t.Fatalf("unexpected host/key: %+v", received)
	}
	if received.KeyLocation != "https://blog.example.com/"+key+".txt" {
		t.Fatalf("unexpected keyLocation %q", received.KeyLocation)
	}
	wantURLs := []string{
		"https://blog.example.com/p/hello-world",
		"https://blog.example.com/",
		"https://blog.example.com/a",
	}
	if !slices.Equal(received.URLList, wantURLs) {
		t.Fatalf("unexpected urlList: got %v, want %v", received.URLList, wantURLs)
	}

	// 关闭全站索引时不得推送
	if svcerr := config.Save([]config.Change{{Key: "seo_allow_indexing", Value: false}}); svcerr != nil {
		t.Fatal(svcerr)
	}
	if err := submitIndexNowPathsSync(context.Background(), []string{"/p/blocked"}); err != nil {
		t.Fatalf("expected nil when indexing disabled, got %v", err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.payloads) != 1 {
		t.Fatalf("expected no IndexNow call when seo_allow_indexing=false, got %d", len(rec.payloads))
	}
}

func TestPostAndPageServiceIndexNowTriggersAndBatchCoalescing(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	rec := setupIndexNowMockServer(t, 25*time.Millisecond)

	key := "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
	t.Setenv(constant.EnvKeyBaseUrl, "https://blog.example.com")
	t.Setenv(constant.EnvKeyIndexNowEnabled, "true")
	t.Setenv(constant.EnvKeyIndexNowKey, key)

	postSvc := NewPostService()
	pageSvc := NewPageService()

	takePayloads := func() []indexNowPayload {
		waitForIndexNowDrain(t)
		rec.mu.Lock()
		defer rec.mu.Unlock()
		out := slices.Clone(rec.payloads)
		rec.payloads = nil
		return out
	}

	// 1. 空正文草稿与私密文章不应触发 IndexNow
	draftSlug := "draft-only"
	draftText := "draft body"
	draftID, svcerr := postSvc.CreatePost(author, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "Draft", Slug: &draftSlug, DraftContent: &draftText, Type: "markdown"},
	})
	if svcerr != nil {
		t.Fatalf("create draft: %v", svcerr)
	}
	privTrue := true
	privSlug := "secret-post"
	privID, svcerr := postSvc.CreatePost(author, &dto.CreateOrUpdatePostReq{
		IsPrivate:   &privTrue,
		PostBaseDto: dto.PostBaseDto{Title: "Private", Slug: &privSlug, Content: "secret", Type: "markdown"},
	})
	if svcerr != nil {
		t.Fatalf("create private post: %v", svcerr)
	}
	if got := takePayloads(); len(got) != 0 {
		t.Fatalf("expected 0 IndexNow calls for draft & private posts, got %+v", got)
	}

	// 2. 首次发布草稿且同时改 slug：推送新公开地址，但不泄露未公开过的旧草稿 slug
	pubSlug := "published-v1"
	pubRes, svcerr := postSvc.UpdatePost(author, &dto.CreateOrUpdatePostReq{
		ID:          draftID,
		PostBaseDto: dto.PostBaseDto{Content: "hello public world", Slug: &pubSlug},
	})
	if svcerr != nil {
		t.Fatalf("publish draft: %v", svcerr)
	}
	got := takePayloads()
	if len(got) != 1 || !slices.Equal(got[0].URLList, []string{
		"https://blog.example.com/p/published-v1",
		"https://blog.example.com/",
		"https://blog.example.com/a",
	}) {
		t.Fatalf("unexpected payload on first publish: %+v", got)
	}

	// 3. 在已公开文章上仅自动保存草稿（draft_content）：不应触发 IndexNow
	updatedDraft := "autosaving draft..."
	baseVer := pubRes.DraftVersion
	if _, svcerr := postSvc.UpdatePost(author, &dto.CreateOrUpdatePostReq{
		ID:               draftID,
		BaseDraftVersion: &baseVer,
		PostBaseDto:      dto.PostBaseDto{DraftContent: &updatedDraft},
	}); svcerr != nil {
		t.Fatalf("autosave draft on public post: %v", svcerr)
	}
	if got := takePayloads(); len(got) != 0 {
		t.Fatalf("expected 0 IndexNow calls on draft-only save, got %+v", got)
	}

	// 4. 修改已公开文章的 slug：同时提交新旧两个路径
	renamedSlug := "published-v2"
	if _, svcerr := postSvc.UpdatePost(author, &dto.CreateOrUpdatePostReq{
		ID:          draftID,
		PostBaseDto: dto.PostBaseDto{Slug: &renamedSlug},
	}); svcerr != nil {
		t.Fatalf("rename public post slug: %v", svcerr)
	}
	got = takePayloads()
	if len(got) != 1 || !slices.Contains(got[0].URLList, "https://blog.example.com/p/published-v2") || !slices.Contains(got[0].URLList, "https://blog.example.com/p/published-v1") {
		t.Fatalf("expected both new and old post URLs on public slug rename, got %+v", got)
	}

	// 5. 批量将多篇私密文章设为公开（> 8 篇）：合并为单次请求且不丢弃任何一篇
	batchIDs := []uint{privID}
	for i := 0; i < 11; i++ {
		id, svcerr := postSvc.CreatePost(author, &dto.CreateOrUpdatePostReq{
			IsPrivate:   &privTrue,
			PostBaseDto: dto.PostBaseDto{Title: "Batch Item", Content: "body", Type: "markdown"},
		})
		if svcerr != nil {
			t.Fatalf("create batch private post %d: %v", i, svcerr)
		}
		batchIDs = append(batchIDs, id)
	}
	if got := takePayloads(); len(got) != 0 {
		t.Fatalf("expected 0 calls before batch publish, got %+v", got)
	}
	if _, svcerr := postSvc.BatchUpdateVisibility(author, batchIDs, false); svcerr != nil {
		t.Fatalf("batch publish: %v", svcerr)
	}
	got = takePayloads()
	uniqueURLs := make(map[string]struct{})
	for _, p := range got {
		for _, u := range p.URLList {
			uniqueURLs[u] = struct{}{}
		}
	}
	if len(got) == 0 || len(got) > 4 {
		t.Fatalf("expected batch of 12 posts to coalesce into 1..4 HTTP POSTs, got %d", len(got))
	}
	// 12 篇文章 + 首页 "/" + 归档 "/a" = 14 个唯一 URL，全部不得丢失
	if len(uniqueURLs) != 14 {
		t.Fatalf("expected all 14 unique URLs delivered without drop, got %d: %v", len(uniqueURLs), uniqueURLs)
	}

	// 6. 独立页面：外链页与私密页不推送，公开正文页与改名正常推送
	linkKind := model.PageKindLink
	linkTarget := "https://example.org"
	if _, svcerr := pageSvc.CreatePage(author, &dto.CreateOrUpdatePageReq{
		Kind:        &linkKind,
		LinkURL:     &linkTarget,
		PageBaseDto: dto.PageBaseDto{Title: "Ext", Slug: "ext-link"},
	}); svcerr != nil {
		t.Fatalf("create link page: %v", svcerr)
	}
	if got := takePayloads(); len(got) != 0 {
		t.Fatalf("expected 0 IndexNow calls for link page, got %+v", got)
	}

	pageID, svcerr := pageSvc.CreatePage(author, &dto.CreateOrUpdatePageReq{
		PageBaseDto: dto.PageBaseDto{Title: "About", Slug: "about-me", Content: "<p>hi</p>", Type: "html"},
	})
	if svcerr != nil {
		t.Fatalf("create public page: %v", svcerr)
	}
	got = takePayloads()
	if len(got) != 1 || !slices.Equal(got[0].URLList, []string{"https://blog.example.com/page/about-me"}) {
		t.Fatalf("unexpected page publish payload: %+v", got)
	}

	if _, svcerr := pageSvc.UpdatePage(author, &dto.CreateOrUpdatePageReq{
		ID:          pageID,
		PageBaseDto: dto.PageBaseDto{Slug: "about"},
	}); svcerr != nil {
		t.Fatalf("rename public page: %v", svcerr)
	}
	got = takePayloads()
	if len(got) != 1 || !slices.Equal(got[0].URLList, []string{"https://blog.example.com/page/about", "https://blog.example.com/page/about-me"}) {
		t.Fatalf("unexpected page rename payload: %+v", got)
	}
}
