package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
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
	"github.com/snowykami/neo-blog/pkg/sharedstate"
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

// allowVisitReport 按 IP 固定窗口限流，防止上报接口被刷；计数在共享状态中，多副本时各实例共用同一个窗口
func allowVisitReport(ip string) bool {
	return utils.AllowRequest("visit_report:"+ip, visitRateLimit, visitRateWindow)
}

// siteHosts 本站域名：请求方传入的域名（如 X-Forwarded-Host）加上配置的站点地址，用于识别站内跳转
func siteHosts(requestHosts []string) []string {
	hosts := append([]string{}, requestHosts...)
	if u, err := url.Parse(tools.GetBaseUrl()); err == nil && u.Host != "" {
		hosts = append(hosts, u.Host)
	}
	return hosts
}

// VisitClient 访问请求附带的客户端信息，由 controller 从连接与请求头中读取
type VisitClient struct {
	IP             string
	UserAgent      string
	AcceptLanguage string
	CHUA           string   // Sec-CH-UA
	CHUAMobile     string   // Sec-CH-UA-Mobile
	CHUAPlatform   string   // Sec-CH-UA-Platform
	DoNotTrack     bool     // 浏览器开启 DNT / GPC
	Hosts          []string // 本次请求的站点域名，用于区分站内跳转与外部来源
}

// Report 记录一次访问，返回应写入 Cookie 的访客ID（为空表示不写入）
// 开启请勿追踪时只做匿名计数：不识别访客，不保存 IP、UA 与浏览器信号
// 每次访问都会做一致性检测，疑似自动化的访问照常记录，但不计入浏览量
func (s *VisitService) Report(ctx context.Context, req *dto.ReportVisitReq, visitorKey string, client VisitClient) (string, *errs.ServiceError) {
	ip, userAgent, doNotTrack := client.IP, client.UserAgent, client.DoNotTrack
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
	targetType, targetID := publicVisitTarget(req.TargetType, req.TargetID)

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
	region := ipregion.Lookup(ip)
	location := region.String()
	referrer := utils.Truncate(strings.TrimSpace(req.Referrer), maxVisitTextLength)
	source, sourceHost := utils.ClassifyReferrer(referrer, path, siteHosts(client.Hosts)...)
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
		IPCountry:    regionCountry(region),
		ISP:          utils.Truncate(region.ISP, 64),
		Datacenter:   isDatacenterISP(region.ISP),
	}

	if doNotTrack {
		applyVisitTrust(log)
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
	// 登录后把登录前的匿名访问补记到该用户；放在去重之前：登录后常常回到刚看过的页面，这次上报会被去重。
	// 同一访客登录同一用户期间只做一次（共享状态记一个带过期的标记），不必每浏览一页都查一遍
	if userID != nil {
		if claimVisitAttribution(visitor.ID, *userID) {
			attributeAnonymousVisits(visitor.ID, *userID, fingerprint, ip, now)
		}
	} else if visitor.ID != 0 && visitor.UserID != nil {
		// 登出后的匿名浏览：清掉标记，下次登录时把这段补记上
		resetVisitAttribution(visitor.ID)
	}

	// 去重：刷新页面不重复记录，只更新最近活跃时间
	if visitor.ID != 0 {
		recent, err := repo.Visit.HasRecentVisit(visitor.ID, path, now.Add(-visitDedupWindow))
		if err == nil && recent {
			_ = repo.Visit.TouchVisitor(visitor.ID, now)
			return visitor.VisitorKey, nil
		}
	}

	fillVisitSignals(log, req.Signals, client)
	if visitor.ID != 0 {
		log.PrevCountry = visitor.LastCountry
	}
	applyVisitTrust(log)

	if fingerprint != "" {
		visitor.Fingerprint = fingerprint
	}
	if userID != nil {
		visitor.UserID = userID
	}
	visitor.LastIP = ip
	visitor.LastLocation = location
	visitor.LastCountry = log.IPCountry
	visitor.OS, visitor.Browser, visitor.DeviceType = ua.OS, ua.Browser, log.DeviceType
	visitor.LastSeenAt = now
	// 访问次数原子加一：同一访客的并发上报（多标签页）各自整行保存会互相覆盖、丢计数
	if err := repo.Visit.SaveVisitorAndCount(visitor); err != nil {
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

// publicVisitTarget 只把公开的文章 / 页面记为访问目标：不存在或私密的（前台对所有人 404）按「其他页面」记录，不加浏览量。
// 上报内容来自浏览器，不能信任；查询出错时同样按其他页面处理（保守）
func publicVisitTarget(targetType string, targetID uint) (string, uint) {
	if targetID == 0 {
		return "other", 0
	}
	var (
		meta *repo.PostMeta
		err  error
	)
	switch targetType {
	case constant.TargetTypePost:
		meta, err = repo.Post.GetPostMeta(targetID)
	case constant.TargetTypePage:
		meta, err = repo.Page.GetPageMeta(targetID)
	default:
		return "other", 0
	}
	if err != nil || meta.IsPrivate {
		return "other", 0
	}
	return targetType, targetID
}

// 登录后补记匿名访问的标记：记下这个访客上一次补记时登录的用户，同一用户在有效期内不再重复补记；
// 换了用户登录、或登出后又有匿名浏览（清掉标记）时会再补记一次
const visitAttributionTTL = 12 * time.Hour

func visitAttributionKey(visitorID uint) string {
	return fmt.Sprintf("visit:attributed:%d", visitorID)
}

// claimVisitAttribution 是否需要为这个访客补记（新访客还没有 ID，总要做一次）；共享状态出错时照常补记
func claimVisitAttribution(visitorID, userID uint) bool {
	if visitorID == 0 {
		return true
	}
	key, user := visitAttributionKey(visitorID), strconv.FormatUint(uint64(userID), 10)
	if v, ok, err := sharedstate.Current().Get(key); err == nil && ok && v == user {
		return false
	}
	if err := sharedstate.Current().Set(key, user, visitAttributionTTL); err != nil {
		logrus.Warnf("mark visit attribution of visitor %d: %v", visitorID, err)
	}
	return true
}

func resetVisitAttribution(visitorID uint) {
	if err := sharedstate.Current().Delete(visitAttributionKey(visitorID)); err != nil {
		logrus.Warnf("reset visit attribution of visitor %d: %v", visitorID, err)
	}
}

// countPostView 记录了一次新的文章访问（已去重、排除爬虫、疑似自动化与管理员）后累加文章浏览量；失败只打日志
func countPostView(log *model.VisitLog) {
	if log.TargetType != constant.TargetTypePost || log.TargetID == 0 || log.Trust == constant.VisitTrustBot {
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
// attributeAnonymousVisits 把登录前的匿名访问补记到用户，失败只记日志、不影响上报：
//   - 同一浏览器：该访客在上一次由其他用户登录访问之后的匿名访问（共用电脑时不把别人的浏览算进来）；
//   - 指纹推断（可在后台关闭）：指纹相同、从未登录过的其他访客，最近 7 天内来自同一 IP 段的匿名访问。
//     指纹只含低区分度的特征，同网络下同型号设备可能被认错，补记的记录标为 fingerprint 以便区分
func attributeAnonymousVisits(visitorID, userID uint, fingerprint, ip string, now time.Time) {
	if visitorID != 0 {
		after, err := repo.Visit.LastOtherUserVisitAt(visitorID, userID)
		if err == nil {
			_, err = repo.Visit.AttributeVisitorVisits(visitorID, userID, after, constant.VisitUserSourceBrowser)
		}
		if err != nil {
			logrus.Warnf("attribute visits of visitor %d: %v", visitorID, err)
		}
	}
	prefix := utils.IPPrefix(ip)
	if fingerprint == "" || prefix == "" || !tools.GetVisitFingerprintAttribution() {
		return
	}
	since := now.Add(-fingerprintMatchWindow)
	candidates, err := repo.Visit.ListVisitorsByFingerprint(fingerprint, since)
	if err != nil {
		logrus.Warnf("list visitors by fingerprint: %v", err)
		return
	}
	others := make([]uint, 0, len(candidates))
	for _, c := range candidates {
		if c.ID != visitorID && c.UserID == nil {
			others = append(others, c.ID)
		}
	}
	logs, err := repo.Visit.ListAnonymousVisits(others, since)
	if err != nil {
		logrus.Warnf("list anonymous visits: %v", err)
		return
	}
	ids := make([]uint, 0, len(logs))
	for _, l := range logs {
		if utils.IPPrefix(l.IP) == prefix {
			ids = append(ids, l.ID)
		}
	}
	if _, err := repo.Visit.AttributeVisits(ids, userID, constant.VisitUserSourceFingerprint); err != nil {
		logrus.Warnf("attribute visits by fingerprint: %v", err)
	}
}

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
	result, err := s.enrichVisitLogs(logs)
	if err != nil {
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
	}
	return result, total, nil
}

// enrichVisitLogs 转换为 DTO，附带文章/页面标题、评论摘要与常见页面名称
func (s *VisitService) enrichVisitLogs(logs []model.VisitLog) ([]*dto.VisitLogDto, error) {
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
		return nil, err
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
			return nil, err
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
			return nil, err
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
				item.Subject = &dto.CommentTargetDto{ID: info.ID, Type: targetType, Title: info.Title, Slug: info.Slug, IsPrivate: info.IsPrivate}
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
	return result, nil
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

// visitHistoryLimit 访问详情中展示的同一访客最近访问数
const visitHistoryLimit = 10

// GetVisitDetail 后台：单次访问详情，附带全部信号、一致性检测过程与同一访客最近的访问
func (s *VisitService) GetVisitDetail(ctx context.Context, id uint) (*dto.VisitDetailDto, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	log, err := repo.Visit.GetVisitLog(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	logs := []model.VisitLog{*log}
	if log.VisitorID != nil {
		history, err := repo.Visit.ListVisitorVisits(*log.VisitorID, visitHistoryLimit)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_get_target")
		}
		logs = append(logs, history...)
	}
	items, err := s.enrichVisitLogs(logs)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	detail := &dto.VisitDetailDto{Visit: items[0], Signals: log.SignalsDto(), History: items[1:]}
	if log.Action == constant.VisitActionVisit {
		detail.Trust = analyzeVisitTrust(log)
	}
	if log.VisitorID == nil {
		detail.History = []*dto.VisitLogDto{}
	}
	return detail, nil
}

// visitInsightsTop 统计列表的最大条数
const visitInsightsTop = 10

// GetInsights 后台：访客统计。今日按小时、近 7 / 30 天按天汇总，按服务器时区计算
func (s *VisitService) GetInsights(ctx context.Context, req *dto.VisitInsightsReq) (*dto.VisitInsightsDto, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	days := req.Days
	if !(days == 1 || days == 7 || days == 30) {
		days = 7
	}
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	since := midnight.AddDate(0, 0, 1-days)
	logs, err := repo.Visit.ListInsightVisits(since)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}

	// 时间桶：今日 24 小时，其余每天一个
	var labels []string
	if days == 1 {
		for h := 0; h < 24; h++ {
			labels = append(labels, strconv.Itoa(h))
		}
	} else {
		for d := 0; d < days; d++ {
			labels = append(labels, since.AddDate(0, 0, d).Format(time.DateOnly))
		}
	}
	trend := make(map[string]map[string]int64, len(labels))
	for _, label := range labels {
		trend[label] = map[string]int64{}
	}

	counters := map[string]map[string]int64{}
	add := func(group, name string) {
		if name == "" {
			return
		}
		if counters[group] == nil {
			counters[group] = map[string]int64{}
		}
		counters[group][name]++
	}
	result := &dto.VisitInsightsDto{Days: days}
	visitors := map[uint]bool{}
	for i := range logs {
		l := &logs[i]
		verdict := l.Trust
		if verdict == "" {
			verdict = constant.VisitTrustUnknown
		}
		result.Total++
		add("verdicts", verdict)
		label := l.CreatedAt.In(now.Location()).Format(time.DateOnly)
		if days == 1 {
			label = strconv.Itoa(l.CreatedAt.In(now.Location()).Hour())
		}
		if bucket, ok := trend[label]; ok {
			bucket[verdict]++
		}
		for _, flag := range l.ParseTrustFlags() {
			if flag.Severity != sevInfo {
				add("rules", flag.ID)
			}
		}
		if verdict == constant.VisitTrustProxy {
			add("proxy_exits", l.IPCountry)
		}
		if verdict != constant.VisitTrustBot {
			result.PV++
			if l.VisitorID != nil {
				visitors[*l.VisitorID] = true
			}
		}
		add("devices", l.DeviceType)
		add("os", l.OS)
		add("browsers", l.Browser)
		if l.HasSignals {
			result.SignalVisits++
			add("ip_countries", l.IPCountry)
			add("inferred_countries", l.InferredCountry)
			add("time_zones", l.TimeZone)
			add("color_schemes", l.ColorScheme)
			if langs := l.LanguageList(); len(langs) > 0 {
				add("languages", langs[0])
			}
		}
	}
	result.UV = int64(len(visitors))
	top := func(group string, limit int) []dto.NamedCount { return topCounts(counters[group], limit) }
	result.Verdicts = top("verdicts", 0)
	result.IPCountries = top("ip_countries", 0)
	result.InferredCountries = top("inferred_countries", 0)
	result.ProxyExits = top("proxy_exits", visitInsightsTop)
	result.Rules = top("rules", visitInsightsTop)
	result.Devices = top("devices", visitInsightsTop)
	result.OS = top("os", visitInsightsTop)
	result.Browsers = top("browsers", visitInsightsTop)
	result.Languages = top("languages", visitInsightsTop)
	result.TimeZones = top("time_zones", visitInsightsTop)
	result.ColorSchemes = top("color_schemes", 0)
	result.Trend = make([]dto.VisitTrendPoint, len(labels))
	for i, label := range labels {
		result.Trend[i] = dto.VisitTrendPoint{Label: label, Counts: trend[label]}
	}
	visitorIDs := make([]uint, 0, len(visitors))
	for id := range visitors {
		visitorIDs = append(visitorIDs, id)
	}
	if err := fillContentInsights(result, logs, visitorIDs, since); err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if err := fillVitalInsights(result, since); err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	return result, nil
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
