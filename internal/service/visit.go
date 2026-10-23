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

	"github.com/sirupsen/logrus"
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
	randomPath             = "/random" // 随机文章中转页，只负责跳转，不单独记录
	visitCommentExcerpt    = 100       // 互动记录中评论摘要的最大字符数
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
	// 随机文章中转页不记录，随后跳转到的文章会以“随机”作为来源
	if isRandomPath(path) {
		return visitorKey, nil
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
	if source == utils.SourceInternal {
		if u, err := url.Parse(referrer); err == nil && isRandomPath(u.Path) {
			source = utils.SourceRandom
		}
	}
	log := &model.VisitLog{
		UserID:       userID,
		Action:       constant.VisitActionVisit,
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
		countPostView(log)
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
			_ = repo.Visit.TouchVisitor(visitor.ID, now)
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
	countPostView(log)
	return visitor.VisitorKey, nil
}

// countPostView 记录了一次新的文章访问（已去重、排除爬虫与管理员）后累加文章浏览量；失败只打日志
func countPostView(log *model.VisitLog) {
	if log.TargetType != constant.TargetTypePost || log.TargetID == 0 {
		return
	}
	if err := repo.Post.IncreaseViewCount(log.TargetID); err != nil {
		logrus.Warnf("increase view count of post %d failed: %v", log.TargetID, err)
	}
}

func isRandomPath(path string) bool {
	return path == randomPath || strings.HasPrefix(path, randomPath+"?")
}

// RecordInteraction 把点赞、评论等站内互动记入访客记录时间线
// actorID 为执行互动的用户，ownerID 为被互动内容的作者；自己对自己内容的互动不记录
// 记录失败只打日志，不影响点赞、评论本身
func (s *VisitService) RecordInteraction(actorID, ownerID uint, action, targetType string, targetID, commentID uint) {
	if actorID == 0 || actorID == ownerID {
		return
	}
	log := &model.VisitLog{
		UserID:     &actorID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		CommentID:  commentID,
		CreatedAt:  time.Now(),
	}
	if ownerID != 0 {
		log.TargetUserID = &ownerID
	}
	if err := repo.Visit.CreateVisitLog(log); err != nil {
		logrus.Errorf("RecordInteraction: %v", err)
	}
}

// RemoveInteraction 撤销互动（如取消点赞）时删除对应记录
func (s *VisitService) RemoveInteraction(actorID uint, action, targetType string, targetID uint) {
	if err := repo.Visit.DeleteInteraction(actorID, action, targetType, targetID); err != nil {
		logrus.Errorf("RemoveInteraction: %v", err)
	}
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

// ListVisitLogs 后台：访问与互动时间线，附带文章/页面标题、评论摘要与常见页面名称
func (s *VisitService) ListVisitLogs(ctx context.Context, req *dto.ListVisitLogReq) ([]*dto.VisitLogDto, int64, *errs.ServiceError) {
	// 访客记录包含全站访问与互动，仅管理员可查看；路由已限制，这里再兜底
	if !ctxutils.IsAdmin(ctx) {
		return nil, 0, errs.NewForbidden("permission_denied")
	}
	logs, total, err := repo.Visit.ListVisitLogs(req)
	if err != nil {
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
	}

	// 1. 被点赞/被回复的评论与新发表的评论
	var commentIDs []uint
	for _, l := range logs {
		if l.TargetType == constant.TargetTypeComment {
			commentIDs = append(commentIDs, l.TargetID)
		}
		if l.CommentID > 0 {
			commentIDs = append(commentIDs, l.CommentID)
		}
	}
	comments, err := repo.Visit.GetCommentBriefs(commentIDs)
	if err != nil {
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
	}

	// 2. 所在的文章/页面：目标为评论时取评论所在的文章/页面
	subjectOf := func(l *model.VisitLog) (string, uint) {
		if l.TargetType == constant.TargetTypeComment {
			c := comments[l.TargetID]
			return c.TargetType, c.TargetID
		}
		return l.TargetType, l.TargetID
	}
	ids := map[string][]uint{}
	for i := range logs {
		if targetType, targetID := subjectOf(&logs[i]); targetID > 0 {
			ids[targetType] = append(ids[targetType], targetID)
		}
	}
	infos := map[string]map[uint]repo.TargetInfo{}
	for targetType, targetIDs := range ids {
		if infos[targetType], err = repo.Visit.GetTargetInfos(targetType, targetIDs); err != nil {
			return nil, 0, errs.NewInternalServer("failed_to_get_target")
		}
	}

	// 3. 其他页面：识别首页、标签、分类、用户主页等路由，并批量查询名称
	paths := make([]visitPath, len(logs))
	keys := map[string][]string{}
	for i, l := range logs {
		if l.TargetType == "other" {
			paths[i] = describeVisitPath(l.Path)
			if paths[i].lookup {
				keys[paths[i].kind] = append(keys[paths[i].kind], paths[i].key)
			}
		}
	}
	names := map[string]map[string]string{}
	for kind, kindKeys := range keys {
		if names[kind], err = repo.Visit.GetPathNames(kind, kindKeys); err != nil {
			return nil, 0, errs.NewInternalServer("failed_to_get_target")
		}
	}

	brief := func(id uint) *dto.VisitCommentDto {
		c, ok := comments[id]
		if !ok {
			return nil
		}
		return &dto.VisitCommentDto{ID: c.ID, Content: truncateRunes(c.Content, visitCommentExcerpt)}
	}
	result := make([]*dto.VisitLogDto, 0, len(logs))
	for i := range logs {
		l := &logs[i]
		item := l.ToDto()
		if targetType, targetID := subjectOf(l); targetID > 0 {
			if info, ok := infos[targetType][targetID]; ok {
				item.Subject = &dto.CommentTargetDto{ID: info.ID, Type: targetType, Title: info.Title, Slug: info.Slug}
			}
		}
		if l.TargetType == constant.TargetTypeComment {
			item.TargetComment = brief(l.TargetID)
		}
		if l.CommentID > 0 {
			item.Comment = brief(l.CommentID)
		}
		if l.TargetType == "other" {
			item.PathKind, item.PathName = paths[i].kind, paths[i].key
			if name, ok := names[paths[i].kind][paths[i].key]; ok {
				item.PathName = name
			}
		}
		result = append(result, item)
	}
	return result, total, nil
}

// visitPath 常见页面路由的识别结果，kind 与前端 Console.visits.path_* 文案对应
type visitPath struct {
	kind   string // home / search / label / labels / category / categories / archive / user / privacy / other
	key    string // 标签/分类 slug、用户名或搜索词
	lookup bool   // key 是否需要查表转换为名称
}

// describeVisitPath 识别常见页面路由，与前端 web/src/utils/common/route.ts 中的 mainPath 保持一致
func describeVisitPath(path string) visitPath {
	u, err := url.Parse(path)
	if err != nil {
		return visitPath{kind: "other"}
	}
	segments := strings.Split(strings.Trim(u.Path, "/"), "/")
	query := u.Query()
	switch {
	case u.Path == "/" || u.Path == "":
		// 首页通过查询参数按标签、分类筛选或搜索
		if label := query.Get("label"); label != "" {
			return visitPath{kind: "label", key: label, lookup: true}
		}
		if category := query.Get("category"); category != "" {
			return visitPath{kind: "category", key: category, lookup: true}
		}
		if keyword := query.Get("query"); keyword != "" {
			return visitPath{kind: "search", key: keyword}
		}
		return visitPath{kind: "home"}
	case len(segments) == 1 && segments[0] == "a":
		return visitPath{kind: "archive"}
	case len(segments) == 1 && segments[0] == "l":
		return visitPath{kind: "labels"}
	case len(segments) == 1 && segments[0] == "c":
		return visitPath{kind: "categories"}
	case len(segments) == 2 && segments[0] == "c" && segments[1] != "":
		return visitPath{kind: "category", key: segments[1], lookup: true}
	case len(segments) == 2 && segments[0] == "u" && segments[1] != "":
		return visitPath{kind: "user", key: segments[1], lookup: true}
	case len(segments) == 1 && segments[0] == "privacy":
		return visitPath{kind: "privacy"}
	}
	return visitPath{kind: "other"}
}

// truncateRunes 按字符截断，超出时追加省略号
func truncateRunes(s string, n int) string {
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= n {
		return string(runes)
	}
	return string(runes[:n]) + "…"
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
