package service

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/ipregion"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

const (
	VisitorCookieName      = "nb_vid"           // 访客 Cookie 名
	VisitorCookieMaxAge    = 365 * 24 * 60 * 60 // 访客 Cookie 有效期（秒）
	visitDedupWindow       = 10 * time.Minute   // 同一访客同一路径在该时间内只记一次
	fingerprintMatchWindow = 7 * 24 * time.Hour // Cookie 丢失时按指纹找回的有效期
	visitRateLimit         = 60                 // 每个 IP 每分钟最多上报次数
	visitRateWindow        = time.Minute
	maxVisitTextLength     = 512
)

var fingerprintPattern = regexp.MustCompile(`^[0-9a-f]{16,64}$`)

type VisitService struct{}

func NewVisitService() *VisitService {
	return &VisitService{}
}

// 简单的按 IP 固定窗口限流，防止上报接口被刷
var (
	visitRate   = map[string]*visitRateEntry{}
	visitRateMu sync.Mutex
)

type visitRateEntry struct {
	count int
	start time.Time
}

func allowVisitReport(ip string) bool {
	visitRateMu.Lock()
	defer visitRateMu.Unlock()
	now := time.Now()
	if len(visitRate) > 10000 {
		visitRate = map[string]*visitRateEntry{}
	}
	entry, ok := visitRate[ip]
	if !ok || now.Sub(entry.start) > visitRateWindow {
		visitRate[ip] = &visitRateEntry{count: 1, start: now}
		return true
	}
	entry.count++
	return entry.count <= visitRateLimit
}

// siteHosts 本站域名：请求方传入的域名（如 X-Forwarded-Host）加上配置的站点地址，用于识别站内跳转
func siteHosts(requestHosts []string) []string {
	hosts := append([]string{}, requestHosts...)
	if u, err := url.Parse(tools.GetBaseUrl()); err == nil && u.Host != "" {
		hosts = append(hosts, u.Host)
	}
	return hosts
}

// Report 记录一次访问，返回应写入 Cookie 的访客ID（为空表示不写入）
// doNotTrack 为 true 时（浏览器开启 DNT / GPC）只做匿名计数：不识别访客、不保存 IP 与 UA
// requestHosts 为本次请求的站点域名，用于区分站内跳转与外部来源
func (s *VisitService) Report(ctx context.Context, req *dto.ReportVisitReq, visitorKey, ip, userAgent string, doNotTrack bool, requestHosts ...string) (string, *errs.ServiceError) {
	if !allowVisitReport(ip) {
		return "", errs.New(http.StatusTooManyRequests, "too_many_requests", nil)
	}
	path := utils.Truncate(strings.TrimSpace(req.Path), maxVisitTextLength)
	if !strings.HasPrefix(path, "/") {
		return "", errs.NewBadRequest("invalid_request_parameters")
	}
	targetType, targetID := req.TargetType, req.TargetID
	if !(targetType == constant.TargetTypePost || targetType == constant.TargetTypePage) || targetID == 0 {
		targetType, targetID = "other", 0
	}

	ua := utils.ParseUA(userAgent)
	// 爬虫与自动化工具不记录
	if ua.DeviceType == utils.DeviceBot {
		return "", nil
	}
	// 管理员自己的访问不记录，避免干扰统计
	currentUser, loggedIn := ctxutils.GetCurrentUser(ctx)
	if loggedIn && currentUser.IsAdmin() {
		return visitorKey, nil
	}
	var userID *uint
	if loggedIn {
		userID = &currentUser.ID
	}
	now := time.Now()
	location := ipregion.Lookup(ip).String()
	referrer := utils.Truncate(strings.TrimSpace(req.Referrer), maxVisitTextLength)
	source, sourceHost := utils.ClassifyReferrer(referrer, path, siteHosts(requestHosts)...)
	log := &model.VisitLog{
		UserID:       userID,
		TargetType:   targetType,
		TargetID:     targetID,
		Path:         path,
		Referrer:     referrer,
		Source:       source,
		ReferrerHost: utils.Truncate(sourceHost, 255),
		Location:     location,
		OS:           ua.OS,
		Browser:      ua.Browser,
		DeviceType:   ua.DeviceType,
		CreatedAt:    now,
	}

	if doNotTrack {
		if err := repo.Visit.CreateVisitLog(log); err != nil {
			return "", errs.NewInternalServer("failed_to_create_target")
		}
		return "", nil
	}

	fingerprint := strings.ToLower(strings.TrimSpace(req.Fingerprint))
	if !fingerprintPattern.MatchString(fingerprint) {
		fingerprint = ""
	}
	visitor, svcerr := s.resolveVisitor(visitorKey, fingerprint, ip, now)
	if svcerr != nil {
		return "", svcerr
	}

	// 去重：刷新页面不重复记录，只更新最近活跃时间
	if visitor.ID != 0 {
		recent, err := repo.Visit.HasRecentVisit(visitor.ID, path, now.Add(-visitDedupWindow))
		if err == nil && recent {
			visitor.LastSeenAt = now
			_ = repo.Visit.SaveVisitor(visitor)
			return visitor.VisitorKey, nil
		}
	}

	if fingerprint != "" {
		visitor.Fingerprint = fingerprint
	}
	if userID != nil {
		visitor.UserID = userID
	}
	visitor.LastIP = ip
	visitor.LastLocation = location
	visitor.OS, visitor.Browser, visitor.DeviceType = ua.OS, ua.Browser, ua.DeviceType
	visitor.VisitCount++
	visitor.LastSeenAt = now
	if err := repo.Visit.SaveVisitor(visitor); err != nil {
		return "", errs.NewInternalServer("failed_to_update_target")
	}

	log.VisitorID = &visitor.ID
	log.IP = ip
	log.UserAgent = userAgent
	if err := repo.Visit.CreateVisitLog(log); err != nil {
		return "", errs.NewInternalServer("failed_to_create_target")
	}
	return visitor.VisitorKey, nil
}

// resolveVisitor 依次通过 Cookie、指纹（7 天内活跃且同一网段）找回访客，都找不到则新建（未保存）
func (s *VisitService) resolveVisitor(visitorKey, fingerprint, ip string, now time.Time) (*model.Visitor, *errs.ServiceError) {
	if visitorKey != "" {
		visitor, err := repo.Visit.GetVisitorByKey(visitorKey)
		if err == nil {
			return visitor, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewInternalServer("failed_to_get_target")
		}
	}
	if fingerprint != "" {
		candidates, err := repo.Visit.ListVisitorsByFingerprint(fingerprint, now.Add(-fingerprintMatchWindow))
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_get_target")
		}
		prefix := utils.IPPrefix(ip)
		for i := range candidates {
			if prefix != "" && utils.IPPrefix(candidates[i].LastIP) == prefix {
				return &candidates[i], nil
			}
		}
	}
	return &model.Visitor{VisitorKey: utils.Strings.GenerateRandomString(32), CreatedAt: now}, nil
}

// ListVisitLogs 后台：访问记录列表，附带文章/页面当前标题
func (s *VisitService) ListVisitLogs(ctx context.Context, req *dto.ListVisitLogReq) ([]*dto.VisitLogDto, int64, *errs.ServiceError) {
	logs, total, err := repo.Visit.ListVisitLogs(req)
	if err != nil {
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
	}
	ids := map[string][]uint{}
	for _, l := range logs {
		if l.TargetID > 0 {
			ids[l.TargetType] = append(ids[l.TargetType], l.TargetID)
		}
	}
	infos := map[string]map[uint]repo.TargetInfo{}
	for targetType, targetIDs := range ids {
		if infos[targetType], err = repo.Visit.GetTargetInfos(targetType, targetIDs); err != nil {
			return nil, 0, errs.NewInternalServer("failed_to_get_target")
		}
	}
	result := make([]*dto.VisitLogDto, 0, len(logs))
	for i := range logs {
		item := logs[i].ToDto()
		if info, ok := infos[logs[i].TargetType][logs[i].TargetID]; ok {
			item.TargetTitle = info.Title
			if info.Slug != nil {
				item.TargetSlug = *info.Slug
			}
		}
		result = append(result, item)
	}
	return result, total, nil
}

// GetVisitor 后台：访客详情
func (s *VisitService) GetVisitor(ctx context.Context, id uint) (*dto.VisitorDto, *errs.ServiceError) {
	visitor, err := repo.Visit.GetVisitorByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	return visitor.ToDto(), nil
}

// GetStats 后台：今日访问统计（按服务器时区的当天零点起算）
func (s *VisitService) GetStats(ctx context.Context) (*dto.VisitStatsDto, *errs.ServiceError) {
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	stats, err := repo.Visit.CountVisitStats(midnight)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	return stats, nil
}
