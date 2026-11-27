package apiv1

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestVisitEventSingleAndBatchEndpoints(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "visit_event.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	base := startRoutes(t, registerVisitRoutes)
	const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

	postRaw := func(path string, body []byte, cookie *http.Cookie, forwardedFor string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, base+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "text/plain")
		req.Header.Set("User-Agent", ua)
		if forwardedFor != "" {
			req.Header.Set("X-Forwarded-For", forwardedFor)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	// 1. 单条事件向后兼容，种下 nb_vid Cookie
	singleBody, _ := json.Marshal(dto.PlausibleEvent{
		Name: "pageview",
		URL:  "https://blog.example.com/posts/hello",
	})
	resp := postRaw("/event", singleBody, nil, "")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("single pageview status = %d", resp.StatusCode)
	}
	vidCookie := cookiesByName(resp)[service.VisitorCookieName]
	if vidCookie == nil || vidCookie.Value == "" {
		t.Fatalf("expected %s cookie on pageview", service.VisitorCookieName)
	}

	// 2. JSON 数组形态批量上报到 /event
	engagedA, engagedB := int64(3200), int64(1800)
	depthA, depthB := 45, 90
	arrayBody, _ := json.Marshal([]dto.PlausibleEvent{
		{Name: "engagement", URL: "https://blog.example.com/posts/hello", EngagedMs: &engagedA, ScrollDepth: &depthA},
		{Name: "engagement", URL: "https://blog.example.com/posts/hello", EngagedMs: &engagedB, ScrollDepth: &depthB},
		{Name: "Web Vital", URL: "https://blog.example.com/posts/hello", Props: map[string]any{"metric": "FCP", "value": 480, "rating": "good"}},
		{Name: "Web Vital", URL: "https://blog.example.com/posts/hello", Props: map[string]any{"metric": "LCP", "value": 1280, "rating": "good"}},
	})
	resp = postRaw("/event", arrayBody, vidCookie, "")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("array batch status = %d", resp.StatusCode)
	}

	// 3. {"events": [...]} 对象包装形态同时支持 /event（前端默认路径）与 /events
	wrapperOnEventBody, _ := json.Marshal(dto.PlausibleEventBatchReq{
		Events: []dto.PlausibleEvent{
			{Name: "Outbound Link: Click", URL: "https://blog.example.com/posts/hello", Props: map[string]any{"url": "https://github.com/snowykami/neo-blog"}},
		},
	})
	resp = postRaw("/event", wrapperOnEventBody, vidCookie, "")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("wrapper batch on /event status = %d", resp.StatusCode)
	}

	wrapperOnEventsBody, _ := json.Marshal(dto.PlausibleEventBatchReq{
		Events: []dto.PlausibleEvent{
			{Name: "File Download", URL: "https://blog.example.com/posts/hello", Props: map[string]any{"url": "https://blog.example.com/archive.zip"}},
		},
	})
	resp = postRaw("/events", wrapperOnEventsBody, vidCookie, "")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("wrapper batch on /events status = %d", resp.StatusCode)
	}

	var visit model.VisitLog
	if err := repo.GetDB().Where("path = ?", "/posts/hello").First(&visit).Error; err != nil {
		t.Fatalf("find visit log: %v", err)
	}
	if visit.EngagedMs == nil || *visit.EngagedMs != 5000 || visit.ScrollDepth == nil || *visit.ScrollDepth != 90 {
		t.Fatalf("visit engagement = (%v, %v), want (5000, 90)", visit.EngagedMs, visit.ScrollDepth)
	}
	var eventCount int64
	repo.GetDB().Model(&model.VisitEvent{}).Where("visit_log_id = ?", visit.ID).Count(&eventCount)
	if eventCount != 4 {
		t.Fatalf("visit event count = %d, want 4", eventCount)
	}

	// 4. 非法格式、混合字段、空数组、超出单批条数上限、超出 64 KiB 请求体上限均返回 400
	for name, bad := range map[string][]byte{
		"empty":         nil,
		"empty_array":   []byte(`[]`),
		"empty_wrapper": []byte(`{"events":[]}`),
		"null_wrapper":  []byte(`{"events":null}`),
		"mixed_wrapper": []byte(`{"n":"pageview","u":"https://blog.example.com/a","events":[{"n":"engagement","u":"https://blog.example.com/b","e":1000}]}`),
		"trailing_data": []byte(`{"n":"pageview","u":"https://blog.example.com/a"}{}`),
		"invalid_json":  []byte(`{not-json`),
	} {
		r := postRaw("/event", bad, vidCookie, "")
		_ = r.Body.Close()
		if r.StatusCode != http.StatusBadRequest {
			t.Fatalf("case %s: status = %d, want 400", name, r.StatusCode)
		}
	}

	tooMany := make([]dto.PlausibleEvent, service.MaxEventBatchItems+1)
	for i := range tooMany {
		tooMany[i] = dto.PlausibleEvent{
			Name: "Web Vital",
			URL:  "https://blog.example.com/posts/hello",
			Props: map[string]any{
				"metric": "CLS",
				"value":  0.01,
				"rating": "good",
			},
		}
	}
	tooManyBody, _ := json.Marshal(dto.PlausibleEventBatchReq{Events: tooMany})
	resp = postRaw("/event", tooManyBody, vidCookie, "")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("exceeding MaxEventBatchItems: status = %d, want 400", resp.StatusCode)
	}

	hugeURL := "https://blog.example.com/" + strings.Repeat("a", 65<<10)
	hugeBody, _ := json.Marshal(dto.PlausibleEvent{Name: "pageview", URL: hugeURL})
	resp = postRaw("/event", hugeBody, vidCookie, "")
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("oversized body (%d bytes): status = %d, want 400", len(hugeBody), resp.StatusCode)
	}

	// 5. 触发 429 时返回 Retry-After: 60 响应头（单批携带 10 条 pageview 按 10 次配额扣减，加速耗尽测试 IP 配额）
	tenPageviews := make([]dto.PlausibleEvent, service.MaxPageviewsPerBatch)
	for i := range tenPageviews {
		tenPageviews[i] = dto.PlausibleEvent{Name: "pageview", URL: "https://blog.example.com/posts/hello"}
	}
	tenPvBody, _ := json.Marshal(dto.PlausibleEventBatchReq{Events: tenPageviews})
	var got429 bool
	for range 20 {
		r := postRaw("/event", tenPvBody, vidCookie, "198.51.100.250")
		_ = r.Body.Close()
		if r.StatusCode == http.StatusTooManyRequests {
			if got := r.Header.Get("Retry-After"); got != "60" {
				t.Fatalf("429 Retry-After = %q, want 60", got)
			}
			got429 = true
			break
		}
	}
	if !got429 {
		t.Fatalf("expected HTTP 429 with Retry-After header after exhausting IP rate budget")
	}
}
