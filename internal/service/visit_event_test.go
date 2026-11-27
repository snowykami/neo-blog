package service

import (
	"context"
	"math"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"gorm.io/gorm"
)

func int64Ptr(n int64) *int64 { return &n }

// 兼容 Plausible 的事件上报：pageview 记为访问，engagement 累计到该访问，外链与 Web Vitals 写入事件表
func TestVisitHandleEvent(t *testing.T) {
	author, admin, _, _, _ := setupEditTest(t)
	// 访问目标只认公开文章（私密文章前台 404，不记为目标）
	post := reloadPost(t, createPublicPost(t, author, nil))
	svc := NewVisitService()
	anon := context.Background()
	client := VisitClient{IP: testIP, UserAgent: testChromeUA, AcceptLanguage: "zh-CN,zh;q=0.9", CHUA: `"Chromium";v="141"`, CHUAMobile: "?0", CHUAPlatform: `"Windows"`}
	url := "https://blog.example.com/p/1?from=feed"
	referrer := "https://www.google.com/"

	// 1. pageview：自定义属性还原为文章与浏览器信号
	key, svcerr := svc.HandleEvent(anon, &dto.PlausibleEvent{Name: "pageview", URL: url, Referrer: &referrer, Props: map[string]any{
		"target_type": "post", "target_id": float64(post.ID), "time_zone": "Asia/Shanghai", "utc_offset": float64(480),
		"languages": "zh-CN,zh", "screen": "1512x982", "dpr": float64(2), "touch_points": float64(0), "pointer": "fine", "color_scheme": "light", "webdriver": false,
	}}, "", client)
	if svcerr != nil || key == "" {
		t.Fatalf("pageview: key=%q err=%v", key, svcerr)
	}
	var visit model.VisitLog
	repo.GetDB().Last(&visit)
	if visit.Path != "/p/1?from=feed" || visit.TargetID != post.ID || !visit.HasSignals || visit.Languages != "zh-CN,zh" || visit.Source != "google" || visit.Trust != constant.VisitTrustTrusted {
		t.Fatalf("pageview log: %+v", visit)
	}

	// 2. engagement：停留时长累加、滚动深度取最大；没有 Cookie 或开启请勿追踪时忽略
	engage := func(ms int64, depth int, key string, c VisitClient) {
		if _, svcerr := svc.HandleEvent(anon, &dto.PlausibleEvent{Name: "engagement", URL: url, EngagedMs: &ms, ScrollDepth: &depth}, key, c); svcerr != nil {
			t.Fatalf("engagement: %v", svcerr)
		}
	}
	engage(3000, 40, key, client)
	engage(2000, 95, key, client)
	engage(1000, 50, "", client)
	dnt := client
	dnt.DoNotTrack = true
	engage(1000, 50, key, dnt)
	visit = model.VisitLog{}
	repo.GetDB().Last(&visit)
	if visit.EngagedMs == nil || *visit.EngagedMs != 5000 || visit.ScrollDepth == nil || *visit.ScrollDepth != 95 {
		t.Fatalf("engagement: ms=%v depth=%v", visit.EngagedMs, visit.ScrollDepth)
	}

	// 3. 外链点击与 Web Vitals 写入事件表，非法值拒绝
	if _, svcerr := svc.HandleEvent(anon, &dto.PlausibleEvent{Name: "Outbound Link: Click", URL: url, Props: map[string]any{"url": "https://github.com/snowykami"}}, key, client); svcerr != nil {
		t.Fatalf("outbound: %v", svcerr)
	}
	if _, svcerr := svc.HandleEvent(anon, &dto.PlausibleEvent{Name: "Outbound Link: Click", URL: url, Props: map[string]any{"url": "javascript:alert(1)"}}, key, client); svcerr == nil {
		t.Fatalf("non-http outbound link should be rejected")
	}
	for _, v := range []float64{1800, 2600, 3400, 4200} {
		if _, svcerr := svc.HandleEvent(anon, &dto.PlausibleEvent{Name: "Web Vital", URL: url, Props: map[string]any{"metric": "LCP", "value": v, "rating": "good"}}, key, client); svcerr != nil {
			t.Fatalf("web vital: %v", svcerr)
		}
	}
	if _, svcerr := svc.HandleEvent(anon, &dto.PlausibleEvent{Name: "Web Vital", URL: url, Props: map[string]any{"metric": "FID", "value": float64(10), "rating": "good"}}, key, client); svcerr == nil {
		t.Fatalf("unknown metric should be rejected")
	}
	var event model.VisitEvent
	repo.GetDB().Where("name = ?", constant.VisitEventOutbound).First(&event)
	if event.VisitLogID == nil || *event.VisitLogID != visit.ID || event.Path != "/p/1?from=feed" {
		t.Fatalf("outbound event: %+v", event)
	}

	// 4. 统计：阅读参与度、文章表现、外链、Web Vitals
	insights, svcerr := svc.GetInsights(admin, &dto.VisitInsightsReq{Days: 7})
	if svcerr != nil {
		t.Fatalf("insights: %v", svcerr)
	}
	if insights.Engagement.Visits != 1 || insights.Engagement.Completed != 1 || insights.Engagement.AvgEngagedMs != 5000 || insights.NewVisitors != 1 {
		t.Fatalf("engagement insights: %+v new=%d", insights.Engagement, insights.NewVisitors)
	}
	if len(insights.Posts) != 1 || insights.Posts[0].AvgEngagedMs != 5000 || insights.Posts[0].TopSource != "google" {
		t.Fatalf("post insights: %+v", insights.Posts)
	}
	if len(insights.Outbound) != 1 || insights.Outbound[0].Count != 1 {
		t.Fatalf("outbound insights: %+v", insights.Outbound)
	}
	if len(insights.Vitals) != 1 || insights.Vitals[0].Name != "LCP" || insights.Vitals[0].P75 != 3400 || insights.Vitals[0].DesktopP75 == nil {
		t.Fatalf("vitals: %+v", insights.Vitals)
	}
	if len(insights.SlowPages) != 1 || insights.SlowPages[0].Path != "/p/1" {
		t.Fatalf("slow pages: %+v", insights.SlowPages)
	}
}

func TestPercentile75(t *testing.T) {
	if p := percentile75([]float64{4, 1, 3, 2}); p != 3 {
		t.Fatalf("p75 of 1..4 = %v", p)
	}
	if p := percentile75([]float64{7}); p != 7 {
		t.Fatalf("p75 of single = %v", p)
	}
}

func TestVisitHandleEventsBatch(t *testing.T) {
	author, admin, _, _, _ := setupEditTest(t)
	post := reloadPost(t, createPublicPost(t, author, nil))
	svc := NewVisitService()
	anon := context.Background()
	client := VisitClient{
		IP:             "198.51.100.10",
		UserAgent:      testChromeUA,
		AcceptLanguage: "zh-CN,zh;q=0.9",
		CHUA:           `"Chromium";v="141"`,
		CHUAMobile:     "?0",
		CHUAPlatform:   `"Windows"`,
	}
	pageURL := "https://blog.example.com/p/batch-1"
	referrer := "https://www.bing.com/"

	// 1. 同批次含新访客 pageview + 多次 engagement + 多条事件：刷新 Cookie、聚合停留时长并批量落库
	mixedBatch := []dto.PlausibleEvent{
		{
			Name:     "pageview",
			URL:      pageURL,
			Referrer: &referrer,
			Props: map[string]any{
				"target_type": "post",
				"target_id":   float64(post.ID),
			},
		},
		{Name: "engagement", URL: pageURL, EngagedMs: int64Ptr(2000), ScrollDepth: intPtr(35)},
		{Name: "engagement", URL: pageURL, EngagedMs: int64Ptr(3500), ScrollDepth: intPtr(88)},
		{Name: "engagement", URL: pageURL, EngagedMs: int64Ptr(1500), ScrollDepth: intPtr(60)},
		{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "FCP", "value": float64(620), "rating": "good"}},
		{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "LCP", "value": float64(1450), "rating": "good"}},
		{Name: "Outbound Link: Click", URL: pageURL, Props: map[string]any{"url": "https://example.org/docs"}},
		{Name: "File Download", URL: pageURL, Props: map[string]any{"url": "https://blog.example.com/files/manual.pdf"}},
	}

	visitorKey, svcerr := svc.HandleEvents(anon, mixedBatch, "", client)
	if svcerr != nil || visitorKey == "" {
		t.Fatalf("mixed batch failed: key=%q err=%v", visitorKey, svcerr)
	}

	var visit model.VisitLog
	if err := repo.GetDB().Where("path = ?", "/p/batch-1").Last(&visit).Error; err != nil {
		t.Fatalf("load visit log: %v", err)
	}
	if visit.EngagedMs == nil || *visit.EngagedMs != 7000 || visit.ScrollDepth == nil || *visit.ScrollDepth != 88 {
		t.Fatalf("aggregated engagement mismatch: ms=%v depth=%v", visit.EngagedMs, visit.ScrollDepth)
	}

	var createdEvents []model.VisitEvent
	repo.GetDB().Where("visit_log_id = ?", visit.ID).Find(&createdEvents)
	if len(createdEvents) != 4 {
		t.Fatalf("expected 4 batched VisitEvent rows, got %d", len(createdEvents))
	}

	// 2. 验证同批次相同 (visitorKey, path) 合并查库、engagement 单次更新、VisitEvent 单次批量插入
	var (
		visitorSelects  int
		visitLogSelects int
		visitLogUpdates int
		eventInserts    int
	)
	const cbPrefix = "test:batch_dedup_"
	db := repo.GetDB()
	_ = db.Callback().Query().After("gorm:query").Register(cbPrefix+"query", func(tx *gorm.DB) {
		sql := strings.ToLower(tx.Statement.SQL.String())
		if strings.Contains(sql, "visitors") {
			visitorSelects++
		}
		if strings.Contains(sql, "visit_logs") {
			visitLogSelects++
		}
	})
	_ = db.Callback().Update().After("gorm:update").Register(cbPrefix+"update", func(tx *gorm.DB) {
		if strings.Contains(strings.ToLower(tx.Statement.SQL.String()), "visit_logs") {
			visitLogUpdates++
		}
	})
	_ = db.Callback().Create().After("gorm:create").Register(cbPrefix+"create", func(tx *gorm.DB) {
		if strings.Contains(strings.ToLower(tx.Statement.SQL.String()), "visit_events") {
			eventInserts++
		}
	})
	t.Cleanup(func() {
		_ = db.Callback().Query().Remove(cbPrefix + "query")
		_ = db.Callback().Update().Remove(cbPrefix + "update")
		_ = db.Callback().Create().Remove(cbPrefix + "create")
	})

	dedupBatch := []dto.PlausibleEvent{
		{Name: "engagement", URL: pageURL, EngagedMs: int64Ptr(1200), ScrollDepth: intPtr(50)},
		{Name: "engagement", URL: pageURL, EngagedMs: int64Ptr(1800), ScrollDepth: intPtr(96)},
		{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "CLS", "value": 0.03, "rating": "good"}},
		{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "INP", "value": float64(80), "rating": "good"}},
		{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "TTFB", "value": float64(110), "rating": "good"}},
		{Name: "Outbound Link: Click", URL: pageURL, Props: map[string]any{"url": "https://golang.org"}},
	}
	retKey, svcerr := svc.HandleEvents(anon, dedupBatch, visitorKey, client)
	if svcerr != nil || retKey != "" {
		t.Fatalf("dedup batch failed: retKey=%q err=%v", retKey, svcerr)
	}
	if visitorSelects != 1 || visitLogSelects != 1 {
		t.Fatalf("expected 1 visitor query and 1 visit_log query, got visitor=%d visit_log=%d", visitorSelects, visitLogSelects)
	}
	if visitLogUpdates != 1 {
		t.Fatalf("expected 1 aggregated visit_log engagement update, got %d", visitLogUpdates)
	}
	if eventInserts != 1 {
		t.Fatalf("expected 1 batch INSERT into visit_events, got %d", eventInserts)
	}

	visitID := visit.ID
	visit = model.VisitLog{}
	repo.GetDB().First(&visit, visitID)
	if visit.EngagedMs == nil || *visit.EngagedMs != 10000 || visit.ScrollDepth == nil || *visit.ScrollDepth != 96 {
		t.Fatalf("second aggregated engagement mismatch: ms=%v depth=%v", visit.EngagedMs, visit.ScrollDepth)
	}

	// 3. 参数校验：空批次、超出单批条数上限、批次中夹带非法事件均返回 400 且不部分写入
	if _, err := svc.HandleEvents(anon, nil, visitorKey, client); err == nil || err.Code != http.StatusBadRequest {
		t.Fatalf("empty batch should return 400, got %v", err)
	}
	oversized := make([]dto.PlausibleEvent, MaxEventBatchItems+1)
	for i := range oversized {
		oversized[i] = dto.PlausibleEvent{Name: "engagement", URL: pageURL, EngagedMs: int64Ptr(100)}
	}
	if _, err := svc.HandleEvents(anon, oversized, visitorKey, client); err == nil || err.Code != http.StatusBadRequest {
		t.Fatalf("batch exceeding MaxEventBatchItems should return 400, got %v", err)
	}
	var beforeEventCount int64
	repo.GetDB().Model(&model.VisitEvent{}).Count(&beforeEventCount)
	if _, err := svc.HandleEvents(anon, []dto.PlausibleEvent{
		{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "LCP", "value": float64(900), "rating": "good"}},
		{Name: "Outbound Link: Click", URL: pageURL, Props: map[string]any{"url": "javascript:void(0)"}},
	}, visitorKey, client); err == nil || err.Code != http.StatusBadRequest {
		t.Fatalf("batch with invalid item should return 400, got %v", err)
	}
	var afterEventCount int64
	repo.GetDB().Model(&model.VisitEvent{}).Count(&afterEventCount)
	if afterEventCount != beforeEventCount {
		t.Fatalf("invalid batch must not partially insert events: %d -> %d", beforeEventCount, afterEventCount)
	}

	// 4. DNT / Bot / Admin 过滤逻辑
	dntClient := client
	dntClient.IP = "198.51.100.11"
	dntClient.DoNotTrack = true
	dntKey, svcerr := svc.HandleEvents(anon, []dto.PlausibleEvent{
		{Name: "pageview", URL: "https://blog.example.com/dnt-page"},
		{Name: "engagement", URL: "https://blog.example.com/dnt-page", EngagedMs: int64Ptr(5000), ScrollDepth: intPtr(80)},
		{Name: "Web Vital", URL: "https://blog.example.com/dnt-page", Props: map[string]any{"metric": "LCP", "value": float64(1100), "rating": "good"}},
	}, "", dntClient)
	if svcerr != nil || dntKey != "" {
		t.Fatalf("dnt batch: key=%q err=%v", dntKey, svcerr)
	}
	var dntVisit model.VisitLog
	if err := repo.GetDB().Where("path = ?", "/dnt-page").First(&dntVisit).Error; err != nil {
		t.Fatalf("dnt anonymous pageview should be recorded: %v", err)
	}
	if dntVisit.VisitorID != nil || dntVisit.EngagedMs != nil {
		t.Fatalf("dnt visit should remain anonymous without engagement: %+v", dntVisit)
	}
	var dntEvents int64
	repo.GetDB().Model(&model.VisitEvent{}).Where("path = ?", "/dnt-page").Count(&dntEvents)
	if dntEvents != 0 {
		t.Fatalf("dnt non-pageview events should be ignored, got %d", dntEvents)
	}

	botClient := client
	botClient.IP = "198.51.100.12"
	botClient.UserAgent = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
	if _, svcerr := svc.HandleEvents(anon, []dto.PlausibleEvent{
		{Name: "pageview", URL: "https://blog.example.com/bot-page"},
		{Name: "Web Vital", URL: "https://blog.example.com/bot-page", Props: map[string]any{"metric": "LCP", "value": float64(800), "rating": "good"}},
	}, visitorKey, botClient); svcerr != nil {
		t.Fatalf("bot batch err: %v", svcerr)
	}
	var botEvents int64
	repo.GetDB().Model(&model.VisitEvent{}).Where("path = ?", "/bot-page").Count(&botEvents)
	if botEvents != 0 {
		t.Fatalf("bot events should be ignored, got %d", botEvents)
	}

	if _, svcerr := svc.HandleEvents(admin, []dto.PlausibleEvent{
		{Name: "pageview", URL: "https://blog.example.com/admin-page"},
		{Name: "Web Vital", URL: "https://blog.example.com/admin-page", Props: map[string]any{"metric": "LCP", "value": float64(800), "rating": "good"}},
	}, visitorKey, client); svcerr != nil {
		t.Fatalf("admin batch err: %v", svcerr)
	}
	var adminEvents int64
	repo.GetDB().Model(&model.VisitEvent{}).Where("path = ?", "/admin-page").Count(&adminEvents)
	if adminEvents != 0 {
		t.Fatalf("admin events should be ignored, got %d", adminEvents)
	}

	// 5. 整批请求只记 1 次限流配额，超过 visitRateLimit 后返回 429
	rateClient := client
	rateClient.IP = "203.0.113.88"
	twoItemBatch := []dto.PlausibleEvent{
		{Name: "engagement", URL: pageURL, EngagedMs: int64Ptr(500), ScrollDepth: intPtr(20)},
		{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "FCP", "value": float64(500), "rating": "good"}},
	}
	for i := 0; i < visitRateLimit; i++ {
		if _, err := svc.HandleEvents(anon, twoItemBatch, visitorKey, rateClient); err != nil {
			t.Fatalf("batch %d within rate limit failed: %v", i, err)
		}
	}
	if _, err := svc.HandleEvents(anon, twoItemBatch, visitorKey, rateClient); err == nil || err.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after %d batches, got %v", visitRateLimit, err)
	}

	// 6. 时序归属、同访问同指标 Web Vital 去重、路径空白规范化与数值边界防御
	seqClient := client
	seqClient.IP = "198.51.100.99"
	seqURL := "https://blog.example.com/posts/seq #toc"
	if _, err := svc.HandleEvents(anon, []dto.PlausibleEvent{
		{Name: "pageview", URL: seqURL, Props: map[string]any{"target_type": "post", "target_id": 1e100}},
	}, visitorKey, seqClient); err != nil {
		t.Fatalf("initial seq pageview failed: %v", err)
	}
	var firstSeqVisit model.VisitLog
	if err := repo.GetDB().Where("path = ?", "/posts/seq").Last(&firstSeqVisit).Error; err != nil {
		t.Fatalf("expected normalized path /posts/seq, got err: %v", err)
	}
	// 将首次访问时间回拨超过去重窗口，使后续同路径 pageview 产生新的 VisitLog #2
	past := time.Now().Add(-20 * time.Minute)
	repo.GetDB().Model(&model.VisitLog{}).Where("id = ?", firstSeqVisit.ID).UpdateColumn("created_at", past)
	if firstSeqVisit.VisitorID != nil {
		_ = sharedstate.Current().Delete(visitDedupKey(*firstSeqVisit.VisitorID, "/posts/seq"))
	}

	// 同一批次中：pageview 之前的 engagement/外链应归属旧访问 #1，之后的 engagement 与去重后的 Web Vital 归属新访问 #2
	if _, err := svc.HandleEvents(anon, []dto.PlausibleEvent{
		{Name: "engagement", URL: seqURL, EngagedMs: int64Ptr(4200), ScrollDepth: intPtr(85)},
		{Name: "Outbound Link: Click", URL: seqURL, Props: map[string]any{"url": "https://example.com/old"}},
		{Name: "pageview", URL: seqURL},
		{Name: "engagement", URL: seqURL, EngagedMs: int64Ptr(1600), ScrollDepth: intPtr(25)},
		{Name: "Web Vital", URL: seqURL, Props: map[string]any{"metric": "LCP", "value": float64(1100), "rating": "good"}},
		{Name: "Web Vital", URL: seqURL, Props: map[string]any{"metric": "LCP", "value": float64(1900), "rating": "good"}},
	}, visitorKey, seqClient); err != nil {
		t.Fatalf("chronological batch failed: %v", err)
	}

	var seqVisits []model.VisitLog
	repo.GetDB().Where("path = ?", "/posts/seq").Order("id ASC").Find(&seqVisits)
	if len(seqVisits) != 2 {
		t.Fatalf("expected 2 sequential visits for /posts/seq, got %d", len(seqVisits))
	}
	if seqVisits[0].EngagedMs == nil || *seqVisits[0].EngagedMs != 4200 || seqVisits[0].ScrollDepth == nil || *seqVisits[0].ScrollDepth != 85 {
		t.Fatalf("visit #1 engagement = (%v, %v), want (4200, 85)", seqVisits[0].EngagedMs, seqVisits[0].ScrollDepth)
	}
	if seqVisits[1].EngagedMs == nil || *seqVisits[1].EngagedMs != 1600 || seqVisits[1].ScrollDepth == nil || *seqVisits[1].ScrollDepth != 25 {
		t.Fatalf("visit #2 engagement = (%v, %v), want (1600, 25)", seqVisits[1].EngagedMs, seqVisits[1].ScrollDepth)
	}

	var oldOutbound model.VisitEvent
	if err := repo.GetDB().Where("name = ? AND label = ?", constant.VisitEventOutbound, "https://example.com/old").First(&oldOutbound).Error; err != nil {
		t.Fatalf("load old outbound event: %v", err)
	}
	if oldOutbound.VisitLogID == nil || *oldOutbound.VisitLogID != seqVisits[0].ID {
		t.Fatalf("old outbound VisitLogID = %v, want %d", oldOutbound.VisitLogID, seqVisits[0].ID)
	}

	var seqVitals []model.VisitEvent
	repo.GetDB().Where("name = ? AND visit_log_id = ?", constant.VisitEventWebVital, seqVisits[1].ID).Find(&seqVitals)
	if len(seqVitals) != 1 || seqVitals[0].Value != 1900 {
		t.Fatalf("expected deduplicated latest LCP=1900 on visit #2, got %+v", seqVitals)
	}

	// 校验缺失 value、NaN/Inf、协议相对路径及单批过多 pageview 均被拒绝
	for name, badEvent := range map[string][]dto.PlausibleEvent{
		"missing_vital_value": {{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "LCP", "rating": "good"}}},
		"nan_vital_value":     {{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "LCP", "value": "NaN", "rating": "good"}}},
		"inf_vital_value":     {{Name: "Web Vital", URL: pageURL, Props: map[string]any{"metric": "LCP", "value": "+Inf", "rating": "good"}}},
		"protocol_rel_url":    {{Name: "pageview", URL: "//evil.example.com/phish"}},
		"protocol_rel_path":   {{Name: "pageview", URL: "https://blog.example.com//evil.example.com/phish"}},
		"backslash_rel_path":  {{Name: "pageview", URL: `https://blog.example.com/\evil.example.com`}},
		"invalid_utf8_escape": {{Name: "pageview", URL: "https://blog.example.com/posts/%E4"}},
	} {
		if _, err := svc.HandleEvents(anon, badEvent, visitorKey, seqClient); err == nil || err.Code != http.StatusBadRequest {
			t.Fatalf("case %s should return 400, got %v", name, err)
		}
	}

	negEngaged := int64(math.MinInt64)
	if _, err := svc.HandleEvents(anon, []dto.PlausibleEvent{
		{Name: "engagement", URL: seqURL, EngagedMs: &negEngaged, ScrollDepth: intPtr(-10)},
	}, visitorKey, seqClient); err != nil {
		t.Fatalf("negative engaged/scroll should clamp safely without error: %v", err)
	}

	tooManyPvs := make([]dto.PlausibleEvent, MaxPageviewsPerBatch+1)
	for i := range tooManyPvs {
		tooManyPvs[i] = dto.PlausibleEvent{Name: "pageview", URL: pageURL}
	}
	if _, err := svc.HandleEvents(anon, tooManyPvs, visitorKey, seqClient); err == nil || err.Code != http.StatusBadRequest {
		t.Fatalf("exceeding MaxPageviewsPerBatch should return 400, got %v", err)
	}
}
