package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/ipregion"
)

func intPtr(n int) *int { return &n }

func boolPtr(b bool) *bool { return &b }

// trustLog 一次正常的国内桌面 Chrome 访问，各用例在此基础上修改
func trustLog(edit func(l *model.VisitLog)) *model.VisitLog {
	l := &model.VisitLog{
		Action: constant.VisitActionVisit, CreatedAt: time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC),
		Location: "重庆市 重庆市 移动", IPCountry: "CN", ISP: "移动",
		OS: "macOS", Browser: "Chrome", DeviceType: "desktop",
		HasSignals: true, TimeZone: "Asia/Shanghai", UTCOffset: intPtr(480), Languages: "zh-CN,zh",
		Screen: "1512x982", DPR: 2, TouchPoints: intPtr(0), Pointer: "fine", ColorScheme: "light",
		AcceptLanguage: "zh-CN,zh;q=0.9", CHPlatform: "macOS", CHMobile: boolPtr(false), CHBrands: "Chromium 152 · Google Chrome 152",
	}
	if edit != nil {
		edit(l)
	}
	return l
}

func ruleResult(t *dto.VisitTrustDto, id string) dto.VisitRuleResultDto {
	for _, r := range t.Rules {
		if r.ID == id {
			return r
		}
	}
	return dto.VisitRuleResultDto{}
}

func TestAnalyzeVisitTrust(t *testing.T) {
	cases := []struct {
		name       string
		log        *model.VisitLog
		verdict    string
		country    string
		ipTrusted  bool
		hits       map[string]string // 规则 -> 期望的严重度
		confidence string
	}{
		{name: "trusted", log: trustLog(nil), verdict: constant.VisitTrustTrusted, country: "CN", ipTrusted: true, confidence: "high"},
		{
			name: "proxy: tz and language in China, IP in the US",
			log: trustLog(func(l *model.VisitLog) {
				l.IPCountry, l.Location, l.ISP = "US", "United States California Los Angeles", ""
			}),
			verdict: constant.VisitTrustProxy, country: "CN", confidence: "high",
			hits: map[string]string{"tz_vs_ip": sevHigh, "lang_vs_ip": sevMedium},
		},
		{
			name:    "Hong Kong exit has the same offset",
			log:     trustLog(func(l *model.VisitLog) { l.IPCountry, l.Location = "HK", "香港特别行政区 电讯盈科" }),
			verdict: constant.VisitTrustProxy, country: "CN",
			hits: map[string]string{"tz_vs_ip": sevMedium, "lang_vs_ip": sevMedium},
		},
		{
			name: "overseas Chinese reader is trusted",
			log: trustLog(func(l *model.VisitLog) {
				l.IPCountry, l.Location, l.ISP = "US", "United States New York", "Verizon"
				l.TimeZone, l.UTCOffset, l.Languages, l.AcceptLanguage = "America/New_York", intPtr(-300), "zh-CN,en-US", "zh-CN,en-US;q=0.9"
			}),
			verdict: constant.VisitTrustTrusted, country: "US", ipTrusted: true,
			hits: map[string]string{"lang_vs_ip": sevLow},
		},
		{
			name: "UA switched to iPhone on desktop Chrome",
			log: trustLog(func(l *model.VisitLog) {
				l.OS, l.Browser, l.DeviceType, l.CHPlatform = "iOS", "Safari", "mobile", "Windows"
			}),
			verdict: constant.VisitTrustSpoofed, country: "CN", ipTrusted: true,
			hits: map[string]string{"ua_vs_ch_platform": sevHigh, "ua_vs_ch_mobile": sevHigh, "ua_engine_vs_ch": sevHigh, "mobile_no_touch": sevMedium, "mobile_large_screen": sevLow},
		},
		{
			name:    "offset does not match the time zone",
			log:     trustLog(func(l *model.VisitLog) { l.TimeZone = "America/New_York" }),
			verdict: constant.VisitTrustSpoofed, country: "CN", ipTrusted: true, confidence: "medium",
			hits: map[string]string{"offset_vs_tz": sevHigh},
		},
		{
			name:    "webdriver",
			log:     trustLog(func(l *model.VisitLog) { l.Webdriver = true }),
			verdict: constant.VisitTrustBot, country: "CN", ipTrusted: true,
			hits: map[string]string{"webdriver": sevHigh},
		},
		{
			name: "datacenter IP does not vote",
			log: trustLog(func(l *model.VisitLog) {
				l.Location, l.ISP, l.Datacenter = "浙江省 杭州市 阿里", "阿里", true
			}),
			verdict: constant.VisitTrustProxy, country: "CN",
			hits: map[string]string{"datacenter_ip": sevMedium},
		},
		{
			name: "Tor-like browser cannot be located",
			log: trustLog(func(l *model.VisitLog) {
				l.IPCountry, l.Location, l.ISP, l.Datacenter = "DE", "Germany Berlin", "M247", true
				l.TimeZone, l.UTCOffset, l.Languages, l.AcceptLanguage = "UTC", intPtr(0), "en-US,en", "en-US,en;q=0.5"
				l.OS, l.Browser, l.CHPlatform, l.CHMobile, l.CHBrands = "Windows", "Firefox", "", nil, ""
			}),
			verdict: constant.VisitTrustProxy, country: "",
			hits: map[string]string{"tz_hidden": sevLow, "datacenter_ip": sevMedium},
		},
		{
			name:    "do not track has no signals",
			log:     trustLog(func(l *model.VisitLog) { l.HasSignals = false }),
			verdict: constant.VisitTrustUnknown, country: "CN", ipTrusted: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := analyzeVisitTrust(tc.log)
			if got.Verdict != tc.verdict || got.Country != tc.country || got.IPTrusted != tc.ipTrusted {
				t.Fatalf("verdict=%s country=%q ipTrusted=%v, want %s %q %v", got.Verdict, got.Country, got.IPTrusted, tc.verdict, tc.country, tc.ipTrusted)
			}
			if tc.confidence != "" && got.Confidence != tc.confidence {
				t.Fatalf("confidence=%s, want %s", got.Confidence, tc.confidence)
			}
			hits := map[string]string{}
			for _, r := range got.Rules {
				if r.Status == ruleHit {
					hits[r.ID] = r.Severity
				}
			}
			if len(hits) != len(tc.hits) {
				t.Fatalf("hits=%v, want %v", hits, tc.hits)
			}
			for id, sev := range tc.hits {
				if hits[id] != sev {
					t.Fatalf("rule %s severity=%q, want %q (all hits %v)", id, hits[id], sev, hits)
				}
			}
			if (got.Score == nil) != (tc.verdict == constant.VisitTrustUnknown) {
				t.Fatalf("score presence mismatch: %v", got.Score)
			}
		})
	}
}

func TestApplyVisitTrustIPad(t *testing.T) {
	l := trustLog(func(l *model.VisitLog) {
		l.Browser, l.CHPlatform, l.CHMobile, l.CHBrands = "Safari", "", nil, ""
		l.TouchPoints, l.Pointer, l.Screen = intPtr(5), "coarse", "1024x1366"
	})
	applyVisitTrust(l)
	if l.Trust != constant.VisitTrustTrusted || l.DeviceType != "tablet" || l.TrustFlags != "ipad_desktop_ua:info" {
		t.Fatalf("ipad: trust=%s device=%s flags=%s", l.Trust, l.DeviceType, l.TrustFlags)
	}
	if r := ruleResult(analyzeVisitTrust(l), "mobile_no_touch"); r.Status != rulePass {
		t.Fatalf("recomputed ipad should pass touch check, got %+v", r)
	}
}

func TestVisitTrustHelpers(t *testing.T) {
	if cc := regionCountry(ipregion.Region{Country: "中国", Province: "台湾省", CountryCode: "CN"}); cc != "TW" {
		t.Fatalf("taiwan region: %s", cc)
	}
	if cc := regionCountry(ipregion.Region{Country: "中国", Province: "香港特别行政区", CountryCode: "CN"}); cc != "HK" {
		t.Fatalf("hong kong region: %s", cc)
	}
	if got := parseCHBrands(`"Not?A_Brand";v="24", "Chromium";v="152", "Google Chrome";v="152"`); got != "Chromium 152 · Google Chrome 152" {
		t.Fatalf("brands: %q", got)
	}
	if m := parseCHMobile("?1"); m == nil || !*m {
		t.Fatalf("mobile hint")
	}
	if !isDatacenterISP("阿里") || isDatacenterISP("电信") {
		t.Fatalf("datacenter isp")
	}
	if tzCountry["Asia/Taipei"] != "TW" || tzCountry["Asia/Calcutta"] != "IN" {
		t.Fatalf("time zone table")
	}
}

// 上报：保存信号与请求头、计算可信度；疑似自动化照常记录但不计入浏览量与统计；开启请勿追踪时不保存信号
func TestVisitReportSignals(t *testing.T) {
	_, admin, _, post, _ := setupEditTest(t)
	svc := NewVisitService()
	anon := context.Background()
	signals := func(edit func(s *dto.VisitSignals)) *dto.VisitSignals {
		s := &dto.VisitSignals{TimeZone: "Asia/Shanghai", UTCOffset: intPtr(480), Languages: []string{"zh-CN", "zh", "en", "ja"}, Screen: "1512x982", DPR: 2, TouchPoints: intPtr(0), Pointer: "fine", ColorScheme: "dark"}
		if edit != nil {
			edit(s)
		}
		return s
	}
	client := VisitClient{
		IP: "45.76.1.1", UserAgent: testChromeUA, AcceptLanguage: "zh-CN,zh;q=0.9",
		CHUA: `"Chromium";v="141", "Not?A_Brand";v="8"`, CHUAMobile: "?0", CHUAPlatform: `"Windows"`,
	}

	// 1. 时区和语言在国内、IP 在美国：疑似代理，推断为中国
	if _, svcerr := svc.Report(anon, &dto.ReportVisitReq{Path: "/proxy", Signals: signals(nil)}, "", client); svcerr != nil {
		t.Fatalf("report: %v", svcerr)
	}
	var log model.VisitLog
	repo.GetDB().Last(&log)
	if log.Trust != constant.VisitTrustProxy || log.IPCountry != "US" || log.InferredCountry != "CN" || !strings.HasPrefix(log.TrustFlags, "tz_vs_ip:high") {
		t.Fatalf("proxy log: trust=%s ip=%s inferred=%s flags=%s", log.Trust, log.IPCountry, log.InferredCountry, log.TrustFlags)
	}
	if log.Languages != "zh-CN,zh,en" || log.CHPlatform != "Windows" || log.CHBrands != "Chromium 141" || log.CHMobile == nil || *log.CHMobile || log.ColorScheme != "dark" {
		t.Fatalf("signals not saved: %+v", log)
	}

	// 2. 后台按可信度筛选，详情返回完整 IP 与检测过程
	list, total, svcerr := svc.ListVisitLogs(admin, &dto.ListVisitLogReq{Trust: constant.VisitTrustProxy})
	if svcerr != nil || total != 1 || list[0].IP != "45.76.1.1" || list[0].InferredCountry != "CN" || list[0].IPTrusted || list[0].Language != "zh-CN" {
		t.Fatalf("filter by trust: total=%d err=%v item=%+v", total, svcerr, list)
	}
	detail, svcerr := svc.GetVisitDetail(admin, log.ID)
	if svcerr != nil || detail.Trust == nil || len(detail.Trust.Rules) != len(trustRules) || len(detail.Trust.Sources) != 3 || len(detail.History) != 1 {
		t.Fatalf("detail: err=%v detail=%+v", svcerr, detail)
	}
	if _, svcerr := svc.GetVisitDetail(anon, log.ID); svcerr == nil {
		t.Fatalf("anonymous should not read visit detail")
	}

	// 3. 自动化：照常记录，不计入文章浏览量与今日统计
	botReq := &dto.ReportVisitReq{Path: "/p/1", TargetType: constant.TargetTypePost, TargetID: post.ID, Signals: signals(func(s *dto.VisitSignals) { s.Webdriver = true })}
	if _, svcerr := svc.Report(anon, botReq, "", VisitClient{IP: testIP, UserAgent: testChromeUA}); svcerr != nil {
		t.Fatalf("bot report: %v", svcerr)
	}
	log = model.VisitLog{}
	repo.GetDB().Last(&log)
	var fresh model.Post
	repo.GetDB().First(&fresh, post.ID)
	if log.Trust != constant.VisitTrustBot || fresh.ViewCount != post.ViewCount {
		t.Fatalf("bot: trust=%s views=%d->%d", log.Trust, post.ViewCount, fresh.ViewCount)
	}
	stats, _ := svc.GetStats(admin)
	if stats.TodayPV != 1 {
		t.Fatalf("bot visit should be excluded from stats, pv=%d", stats.TodayPV)
	}
	insights, svcerr := svc.GetInsights(admin, &dto.VisitInsightsReq{Days: 1})
	if svcerr != nil || insights.Total != 2 || insights.PV != 1 || insights.SignalVisits != 2 || len(insights.Trend) != 24 {
		t.Fatalf("insights: err=%v %+v", svcerr, insights)
	}

	// 4. 请勿追踪：不保存信号与请求头
	dnt := client
	dnt.DoNotTrack = true
	if _, svcerr := svc.Report(anon, &dto.ReportVisitReq{Path: "/dnt-signals", Signals: signals(nil)}, "", dnt); svcerr != nil {
		t.Fatalf("dnt report: %v", svcerr)
	}
	log = model.VisitLog{}
	repo.GetDB().Last(&log)
	if log.HasSignals || log.TimeZone != "" || log.AcceptLanguage != "" || log.Trust != constant.VisitTrustUnknown || log.IP != "" {
		t.Fatalf("dnt should not keep signals: %+v", log)
	}
}
