package service

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// 兼容 Plausible 事件接口（@plausible-analytics/tracker）的事件名
const (
	plausiblePageview   = "pageview"
	plausibleEngagement = "engagement"
	plausibleOutbound   = "Outbound Link: Click"
	plausibleDownload   = "File Download"
	plausibleWebVital   = "Web Vital" // 本站自定义：前端经 next/web-vitals 采集后以自定义事件上报

	engagementWindow   = 24 * time.Hour        // engagement 归属到该访客这段时间内最近一次访问同一路径
	maxEngagedPerEvent = int64(30 * 60 * 1000) // 单次上报的停留时长上限，超出视为异常
)

var (
	webVitalNames   = map[string]bool{"LCP": true, "INP": true, "CLS": true, "FCP": true, "TTFB": true}
	webVitalRatings = map[string]bool{"good": true, "needs-improvement": true, "poor": true}
)

// HandleEvent 处理兼容 Plausible 的事件：pageview 记为一次访问（返回应写入 Cookie 的访客ID），
// engagement 累计到对应访问的停留时长与滚动深度，外链点击、文件下载与 Web Vitals 写入事件表
// 除 pageview 外的事件在开启请勿追踪、爬虫与管理员访问时一律不记录
func (s *VisitService) HandleEvent(ctx context.Context, event *dto.PlausibleEvent, visitorKey string, client VisitClient) (string, *errs.ServiceError) {
	path := eventPath(event.URL)
	if path == "" {
		return "", errs.NewBadRequest("invalid_request_parameters")
	}
	if event.Name == plausiblePageview {
		req := &dto.ReportVisitReq{
			Path:        path,
			TargetType:  propString(event.Props, "target_type"),
			TargetID:    uint(max(propFloat(event.Props, "target_id"), 0)),
			Fingerprint: propString(event.Props, "fingerprint"),
			Signals:     propSignals(event.Props),
		}
		if event.Referrer != nil {
			req.Referrer = *event.Referrer
		}
		return s.Report(ctx, req, visitorKey, client)
	}

	if !allowVisitReport(client.IP) {
		return "", errs.New(http.StatusTooManyRequests, "too_many_requests", nil)
	}
	ua := utils.ParseUA(client.UserAgent)
	if client.DoNotTrack || ua.DeviceType == utils.DeviceBot {
		return "", nil
	}
	if user, ok := ctxutils.GetCurrentUser(ctx); ok && user.IsAdmin() {
		return "", nil
	}
	visit, err := findEventVisit(visitorKey, path)
	if err != nil {
		return "", errs.NewInternalServer("failed_to_get_target")
	}

	switch event.Name {
	case plausibleEngagement:
		if visit == nil || event.EngagedMs == nil {
			return "", nil
		}
		engaged := min(max(*event.EngagedMs, 0), maxEngagedPerEvent)
		depth := 0
		if event.ScrollDepth != nil {
			depth = min(max(*event.ScrollDepth, 0), 100)
		}
		if err := repo.Visit.AddVisitEngagement(visit.ID, engaged, depth); err != nil {
			return "", errs.NewInternalServer("failed_to_update_target")
		}
		return "", nil
	case plausibleOutbound, plausibleDownload:
		link := propString(event.Props, "url")
		if !(strings.HasPrefix(link, "http://") || strings.HasPrefix(link, "https://")) {
			return "", errs.NewBadRequest("invalid_request_parameters")
		}
		name := constant.VisitEventOutbound
		if event.Name == plausibleDownload {
			name = constant.VisitEventDownload
		}
		return "", s.createEvent(visit, &model.VisitEvent{Name: name, Path: path, Label: utils.Truncate(link, maxVisitTextLength), DeviceType: ua.DeviceType})
	case plausibleWebVital:
		metric, rating := propString(event.Props, "metric"), propString(event.Props, "rating")
		value := propFloat(event.Props, "value")
		if !webVitalNames[metric] || !webVitalRatings[rating] || value < 0 || value > 600000 || math.IsNaN(value) {
			return "", errs.NewBadRequest("invalid_request_parameters")
		}
		return "", s.createEvent(visit, &model.VisitEvent{Name: constant.VisitEventWebVital, Path: path, Label: metric, Value: value, Rating: rating, DeviceType: ua.DeviceType})
	}
	// 未识别的自定义事件直接忽略
	return "", nil
}

func (s *VisitService) createEvent(visit *model.VisitLog, event *model.VisitEvent) *errs.ServiceError {
	event.CreatedAt = time.Now()
	if visit != nil {
		event.VisitLogID, event.VisitorID = &visit.ID, visit.VisitorID
		if visit.DeviceType != "" {
			event.DeviceType = visit.DeviceType
		}
	}
	if err := repo.Visit.CreateVisitEvent(event); err != nil {
		logrus.Errorf("create visit event: %v", err)
		return errs.NewInternalServer("failed_to_create_target")
	}
	return nil
}

// findEventVisit 事件所在的那次访问：按访客 Cookie 找到该访客最近一次访问同一路径的记录，找不到时为空
func findEventVisit(visitorKey, path string) (*model.VisitLog, error) {
	if visitorKey == "" {
		return nil, nil
	}
	visitor, err := repo.Visit.GetVisitorByKey(visitorKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	visit, err := repo.Visit.FindLatestVisit(visitor.ID, path, time.Now().Add(-engagementWindow))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return visit, err
}

// eventPath 事件地址中的路径与查询参数
func eventPath(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.HasPrefix(u.Path, "/") {
		return ""
	}
	if u.RawQuery != "" {
		return u.Path + "?" + u.RawQuery
	}
	return u.Path
}

func propString(props map[string]any, key string) string {
	switch v := props[key].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	}
	return ""
}

func propFloat(props map[string]any, key string) float64 {
	switch v := props[key].(type) {
	case float64:
		return v
	case string:
		f, _ := strconv.ParseFloat(v, 64)
		return f
	}
	return 0
}

func propInt(props map[string]any, key string) *int {
	if _, ok := props[key]; !ok {
		return nil
	}
	n := int(math.Round(propFloat(props, key)))
	return &n
}

// propSignals 从 pageview 的自定义属性还原浏览器信号；未采集（如开启请勿追踪）时为空
func propSignals(props map[string]any) *dto.VisitSignals {
	if _, ok := props["time_zone"]; !ok {
		return nil
	}
	signals := &dto.VisitSignals{
		TimeZone:    propString(props, "time_zone"),
		UTCOffset:   propInt(props, "utc_offset"),
		Screen:      propString(props, "screen"),
		DPR:         propFloat(props, "dpr"),
		TouchPoints: propInt(props, "touch_points"),
		Pointer:     propString(props, "pointer"),
		ColorScheme: propString(props, "color_scheme"),
		Webdriver:   propString(props, "webdriver") == "true",
	}
	if languages := propString(props, "languages"); languages != "" {
		signals.Languages = strings.Split(languages, ",")
	}
	return signals
}
