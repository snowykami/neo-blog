package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestGithubRepo(t *testing.T) {
	var calls atomic.Int32
	failing := atomic.Bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if failing.Load() {
			w.WriteHeader(http.StatusForbidden) // 模拟触发限流
			return
		}
		switch r.URL.Path {
		case "/repos/snowykami/neo-blog":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"full_name": "snowykami/neo-blog", "name": "neo-blog", "description": "blog",
				"html_url": "https://github.com/snowykami/neo-blog", "language": "Go",
				"stargazers_count": 42, "forks_count": 3, "topics": []string{"blog"},
				"owner":   map[string]any{"login": "snowykami", "avatar_url": "https://avatars.githubusercontent.com/u/1"},
				"license": map[string]any{"spdx_id": "MIT"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	original := githubAPIBaseURL
	githubAPIBaseURL = srv.URL
	t.Cleanup(func() { githubAPIBaseURL = original })
	githubRepoCache.Lock()
	githubRepoCache.entries = map[string]githubRepoEntry{}
	githubRepoCache.Unlock()

	s := NewGithubService()
	ctx := context.Background()

	// 非法名称不发出请求
	for _, name := range [][2]string{{"a/b", "c"}, {"owner", ".."}, {"-bad", "repo"}, {"owner", "re/po"}, {"", "repo"}} {
		_, svcerr := s.GetRepo(ctx, name[0], name[1])
		expectCode(t, svcerr, http.StatusBadRequest, "invalid name "+name[0]+"/"+name[1])
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid names should not request github, calls=%d", calls.Load())
	}

	repo, svcerr := s.GetRepo(ctx, "snowykami", "neo-blog")
	if svcerr != nil || repo.FullName != "snowykami/neo-blog" || repo.Stars != 42 || repo.License != "MIT" || repo.Owner != "snowykami" {
		t.Fatalf("repo: %v %+v", svcerr, repo)
	}
	// 缓存期内（大小写不同也视为同一仓库）不再请求
	if _, svcerr = s.GetRepo(ctx, "SnowyKami", "Neo-Blog"); svcerr != nil || calls.Load() != 1 {
		t.Fatalf("repo should be cached: %v %d", svcerr, calls.Load())
	}

	// 不存在的仓库也缓存
	_, svcerr = s.GetRepo(ctx, "snowykami", "missing")
	expectCode(t, svcerr, http.StatusNotFound, "missing repo")
	_, svcerr = s.GetRepo(ctx, "snowykami", "missing")
	expectCode(t, svcerr, http.StatusNotFound, "cached missing repo")
	if calls.Load() != 2 {
		t.Fatalf("missing repo should be cached, calls=%d", calls.Load())
	}

	// 过期后请求失败时返回旧数据；没有旧数据时返回 502
	failing.Store(true)
	githubRepoCache.Lock()
	entry := githubRepoCache.entries["snowykami/neo-blog"]
	entry.fetchedAt = time.Now().Add(-githubRepoTTL)
	githubRepoCache.entries["snowykami/neo-blog"] = entry
	githubRepoCache.Unlock()
	if repo, svcerr = s.GetRepo(ctx, "snowykami", "neo-blog"); svcerr != nil || repo.Stars != 42 {
		t.Fatalf("stale repo: %v %+v", svcerr, repo)
	}
	_, svcerr = s.GetRepo(ctx, "snowykami", "other")
	expectCode(t, svcerr, http.StatusBadGateway, "upstream failed")
}
