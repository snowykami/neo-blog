package service

import (
	"context"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
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
