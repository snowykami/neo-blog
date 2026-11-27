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
	"unicode/utf8"

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

	engagementWindow     = 24 * time.Hour        // engagement 归属到该访客这段时间内最近一次访问同一路径
	maxEngagedPerEvent   = int64(30 * 60 * 1000) // 单次上报的停留时长上限，超出视为异常
	MaxEventBatchItems   = 50                    // 单批上报允许的最大事件条数
	MaxPageviewsPerBatch = 10                    // 单批允许携带的最大 pageview 条数，防止单包刷量放大
	maxSafeJSONUint      = float64(1 << 53)
)

var (
	webVitalNames   = map[string]bool{"LCP": true, "INP": true, "CLS": true, "FCP": true, "TTFB": true}
	webVitalRatings = map[string]bool{"good": true, "needs-improvement": true, "poor": true}
)

type parsedPlausibleEvent struct {
	raw        dto.PlausibleEvent
	path       string
	vitalValue float64
}

type engagementAggregate struct {
	engagedMs   int64
	scrollDepth int
}

type webVitalDedupKey struct {
	visitID uint
	path    string
	metric  string
}

// HandleEvent 处理单条兼容 Plausible 的事件，内部委托给批量处理逻辑以保持语义完全一致
func (s *VisitService) HandleEvent(ctx context.Context, event *dto.PlausibleEvent, visitorKey string, client VisitClient) (string, *errs.ServiceError) {
	if event == nil {
		return "", errs.NewBadRequest("invalid_request_parameters")
	}
	return s.HandleEvents(ctx, []dto.PlausibleEvent{*event}, visitorKey, client)
}

// HandleEvents 按事件时序单遍处理批量 Plausible 事件：
// - 非 pageview 批量事件整批只消耗 1 次限流配额；多条 pageview 按条数扣减配额以防刷量放大
// - 按数组顺序执行 pageview 与后续事件，确保切页前后的 engagement / 事件准确归属到各自的 VisitLog
// - 同批次按 (visitorKey, path) 缓存查库结果，聚合 engagement 更新，同访问同指标 Web Vital 去重后批量落库
func (s *VisitService) HandleEvents(ctx context.Context, events []dto.PlausibleEvent, visitorKey string, client VisitClient) (string, *errs.ServiceError) {
	if len(events) == 0 || len(events) > MaxEventBatchItems {
		return "", errs.NewBadRequest("invalid_request_parameters")
	}

	parsed := make([]parsedPlausibleEvent, len(events))
	pageviewCount := 0
	hasNonPageview := false
	for i := range events {
		item, svcerr := validatePlausibleEvent(&events[i])
		if svcerr != nil {
			return "", svcerr
		}
		parsed[i] = item
		if events[i].Name == plausiblePageview {
			pageviewCount++
			if pageviewCount > MaxPageviewsPerBatch {
				return "", errs.NewBadRequest("invalid_request_parameters")
			}
		} else {
			hasNonPageview = true
		}
	}

	requiredTokens := max(1, pageviewCount)
	for range requiredTokens {
		if !allowVisitReport(client.IP) {
			return "", errs.New(http.StatusTooManyRequests, "too_many_requests", nil)
		}
	}

	ua := utils.ParseUA(client.UserAgent)
	skipNonPageview := false
	if hasNonPageview {
		if client.DoNotTrack || ua.DeviceType == utils.DeviceBot {
			skipNonPageview = true
		} else if user, ok := ctxutils.GetCurrentUser(ctx); ok && user.IsAdmin() {
			skipNonPageview = true
		}
	}

	effectiveVisitorKey := visitorKey
	returnedVisitorKey := ""

	var (
		visitorResolved bool
		visitor         *model.Visitor
		visitCache      = make(map[string]*model.VisitLog)
		visitChecked    = make(map[string]bool)
		since           = time.Now().Add(-engagementWindow)
	)
	resolveVisit := func(path string) (*model.VisitLog, *errs.ServiceError) {
		if effectiveVisitorKey == "" {
			return nil, nil
		}
		if visitChecked[path] {
			return visitCache[path], nil
		}
		if !visitorResolved {
			visitorResolved = true
			v, err := repo.Visit.GetVisitorByKey(effectiveVisitorKey)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errs.NewInternalServer("failed_to_get_target")
			}
			visitor = v
		}
		visitChecked[path] = true
		if visitor == nil {
			return nil, nil
		}
		visit, err := repo.Visit.FindLatestVisit(visitor.ID, path, since)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewInternalServer("failed_to_get_target")
		}
		visitCache[path] = visit
		return visit, nil
	}

	now := time.Now()
	engagements := make(map[uint]*engagementAggregate)
	engagementOrder := make([]uint, 0)
	toCreate := make([]*model.VisitEvent, 0, len(parsed))
	webVitalIndex := make(map[webVitalDedupKey]int)

	for i := range parsed {
		ev := &parsed[i].raw
		path := parsed[i].path
		if ev.Name == plausiblePageview {
			req := &dto.ReportVisitReq{
				Path:        path,
				TargetType:  propString(ev.Props, "target_type"),
				TargetID:    propUint(ev.Props, "target_id"),
				Fingerprint: propString(ev.Props, "fingerprint"),
				Signals:     propSignals(ev.Props),
			}
			if ev.Referrer != nil {
				req.Referrer = *ev.Referrer
			}
			key, svcerr := s.reportWithoutRateLimit(ctx, req, effectiveVisitorKey, client)
			if svcerr != nil {
				return returnedVisitorKey, svcerr
			}
			if key != "" {
				returnedVisitorKey = key
				if key != effectiveVisitorKey {
					effectiveVisitorKey = key
					visitorResolved = false
					visitor = nil
					clear(visitChecked)
					clear(visitCache)
				}
			}
			// 同一路径产生新访问后失效缓存，使后续事件归属到新 VisitLog
			delete(visitChecked, path)
			delete(visitCache, path)
			continue
		}

		if skipNonPageview {
			continue
		}

		switch ev.Name {
		case plausibleEngagement:
			if ev.EngagedMs == nil {
				continue
			}
			visit, svcerr := resolveVisit(path)
			if svcerr != nil {
				return returnedVisitorKey, svcerr
			}
			if visit == nil {
				continue
			}
			engaged := min(max(*ev.EngagedMs, 0), maxEngagedPerEvent)
			depth := 0
			if ev.ScrollDepth != nil {
				depth = min(max(*ev.ScrollDepth, 0), 100)
			}
			agg, exists := engagements[visit.ID]
			if !exists {
				agg = &engagementAggregate{}
				engagements[visit.ID] = agg
				engagementOrder = append(engagementOrder, visit.ID)
			}
			agg.engagedMs = min(agg.engagedMs+engaged, maxEngagedPerEvent)
			if depth > agg.scrollDepth {
				agg.scrollDepth = depth
			}
		case plausibleOutbound, plausibleDownload:
			visit, svcerr := resolveVisit(path)
			if svcerr != nil {
				return returnedVisitorKey, svcerr
			}
			link := strings.TrimSpace(propString(ev.Props, "url"))
			name := constant.VisitEventOutbound
			if ev.Name == plausibleDownload {
				name = constant.VisitEventDownload
			}
			toCreate = append(toCreate, buildVisitEvent(now, visit, &model.VisitEvent{
				Name:       name,
				Path:       path,
				Label:      strings.TrimSpace(utils.Truncate(link, maxVisitTextLength)),
				DeviceType: ua.DeviceType,
			}))
		case plausibleWebVital:
			visit, svcerr := resolveVisit(path)
			if svcerr != nil {
				return returnedVisitorKey, svcerr
			}
			metric, rating := propString(ev.Props, "metric"), propString(ev.Props, "rating")
			item := buildVisitEvent(now, visit, &model.VisitEvent{
				Name:       constant.VisitEventWebVital,
				Path:       path,
				Label:      metric,
				Value:      parsed[i].vitalValue,
				Rating:     rating,
				DeviceType: ua.DeviceType,
			})
			var visitID uint
			if visit != nil {
				visitID = visit.ID
			}
			dedupKey := webVitalDedupKey{visitID: visitID, path: path, metric: metric}
			if idx, exists := webVitalIndex[dedupKey]; exists {
				toCreate[idx] = item
			} else {
				webVitalIndex[dedupKey] = len(toCreate)
				toCreate = append(toCreate, item)
			}
		}
	}

	for _, visitID := range engagementOrder {
		agg := engagements[visitID]
		if err := repo.Visit.AddVisitEngagement(visitID, agg.engagedMs, agg.scrollDepth); err != nil {
			return returnedVisitorKey, errs.NewInternalServer("failed_to_update_target")
		}
	}
	if err := repo.Visit.CreateVisitEvents(toCreate); err != nil {
		logrus.Errorf("create visit events: %v", err)
		return returnedVisitorKey, errs.NewInternalServer("failed_to_create_target")
	}
	return returnedVisitorKey, nil
}

func validatePlausibleEvent(event *dto.PlausibleEvent) (parsedPlausibleEvent, *errs.ServiceError) {
	path := normalizeVisitPath(eventPath(event.URL))
	if path == "" {
		return parsedPlausibleEvent{}, errs.NewBadRequest("invalid_request_parameters")
	}
	out := parsedPlausibleEvent{raw: *event, path: path}
	switch event.Name {
	case plausibleOutbound, plausibleDownload:
		link := strings.TrimSpace(propString(event.Props, "url"))
		if !utf8.ValidString(link) || !(strings.HasPrefix(link, "http://") || strings.HasPrefix(link, "https://")) {
			return parsedPlausibleEvent{}, errs.NewBadRequest("invalid_request_parameters")
		}
	case plausibleWebVital:
		metric, rating := propString(event.Props, "metric"), propString(event.Props, "rating")
		value, ok := propFloatOk(event.Props, "value")
		if !ok || !webVitalNames[metric] || !webVitalRatings[rating] || value < 0 || value > 600000 {
			return parsedPlausibleEvent{}, errs.NewBadRequest("invalid_request_parameters")
		}
		out.vitalValue = value
	}
	return out, nil
}

func buildVisitEvent(now time.Time, visit *model.VisitLog, event *model.VisitEvent) *model.VisitEvent {
	event.CreatedAt = now
	if visit != nil {
		visitID := visit.ID
		event.VisitLogID, event.VisitorID = &visitID, visit.VisitorID
		if visit.DeviceType != "" {
			event.DeviceType = visit.DeviceType
		}
	}
	return event
}

// eventPath 事件地址中的路径与查询参数：仅接受 http(s) 绝对地址或站内 / 相对路径
func eventPath(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.HasPrefix(u.Path, "/") {
		return ""
	}
	if u.Scheme == "" {
		if u.Host != "" {
			return ""
		}
	} else if u.Scheme != "http" && u.Scheme != "https" {
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
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return ""
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	}
	return ""
}

func propFloatOk(props map[string]any, key string) (float64, bool) {
	raw, exists := props[key]
	if !exists || raw == nil {
		return 0, false
	}
	var (
		f   float64
		err error
	)
	switch v := raw.(type) {
	case float64:
		f = v
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, false
		}
		f, err = strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}

func propFloat(props map[string]any, key string) float64 {
	f, _ := propFloatOk(props, key)
	return f
}

func propUint(props map[string]any, key string) uint {
	f, ok := propFloatOk(props, key)
	if !ok || f <= 0 || f > maxSafeJSONUint {
		return 0
	}
	return uint(math.Round(f))
}

func propInt(props map[string]any, key string) *int {
	f, ok := propFloatOk(props, key)
	if !ok || f < math.MinInt32 || f > math.MaxInt32 {
		return nil
	}
	n := int(math.Round(f))
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
