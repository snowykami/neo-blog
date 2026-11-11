package repo

import (
	"time"

	"gorm.io/gorm"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

type visitRepo struct{}

var Visit = &visitRepo{}

func (v *visitRepo) GetVisitorByKey(key string) (*model.Visitor, error) {
	var visitor model.Visitor
	if err := GetDB().Where("visitor_key = ?", key).First(&visitor).Error; err != nil {
		return nil, err
	}
	return &visitor, nil
}

func (v *visitRepo) GetVisitorByID(id uint) (*model.Visitor, error) {
	var visitor model.Visitor
	if err := GetDB().Preload("User").First(&visitor, id).Error; err != nil {
		return nil, err
	}
	return &visitor, nil
}

// ListVisitorsByFingerprint 指纹相同且在指定时间之后活跃过的访客，用于 Cookie 丢失时找回
func (v *visitRepo) ListVisitorsByFingerprint(fingerprint string, since time.Time) ([]model.Visitor, error) {
	var visitors []model.Visitor
	err := GetDB().Where("fingerprint = ? AND last_seen_at >= ?", fingerprint, since).
		Order("last_seen_at DESC").Limit(20).Find(&visitors).Error
	return visitors, err
}

// LastOtherUserVisitAt 访客最近一次由其他用户登录访问的时间，没有时为零值
func (v *visitRepo) LastOtherUserVisitAt(visitorID, userID uint) (time.Time, error) {
	var log model.VisitLog
	err := GetDB().Select("created_at").
		Where("visitor_id = ? AND user_id IS NOT NULL AND user_id <> ?", visitorID, userID).
		Order("created_at DESC").Limit(1).Find(&log).Error
	return log.CreatedAt, err
}

// AttributeVisitorVisits 把访客在 after 之后未关联用户的访问补记到用户，返回补记条数
func (v *visitRepo) AttributeVisitorVisits(visitorID, userID uint, after time.Time, source string) (int64, error) {
	res := GetDB().Model(&model.VisitLog{}).
		Where("visitor_id = ? AND user_id IS NULL AND action = ? AND created_at > ?", visitorID, constant.VisitActionVisit, after).
		Updates(map[string]any{"user_id": userID, "user_source": source})
	return res.RowsAffected, res.Error
}

// ListAnonymousVisits 这些访客在 since 之后未关联用户的访问（只取 ID 与 IP）
func (v *visitRepo) ListAnonymousVisits(visitorIDs []uint, since time.Time) ([]model.VisitLog, error) {
	var logs []model.VisitLog
	if len(visitorIDs) == 0 {
		return logs, nil
	}
	err := GetDB().Select("id", "ip").
		Where("visitor_id IN ? AND user_id IS NULL AND action = ? AND created_at >= ?", visitorIDs, constant.VisitActionVisit, since).
		Find(&logs).Error
	return logs, err
}

// AttributeVisits 把指定的访问补记到用户，只改仍未关联用户的记录，返回补记条数
func (v *visitRepo) AttributeVisits(ids []uint, userID uint, source string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	res := GetDB().Model(&model.VisitLog{}).Where("id IN ? AND user_id IS NULL", ids).
		Updates(map[string]any{"user_id": userID, "user_source": source})
	return res.RowsAffected, res.Error
}

// TouchVisitor 只更新最近活跃时间，去重命中时避免整行写入
func (v *visitRepo) TouchVisitor(visitorID uint, at time.Time) error {
	return GetDB().Model(&model.Visitor{}).Where("id = ?", visitorID).UpdateColumn("last_seen_at", at).Error
}

func (v *visitRepo) SaveVisitor(visitor *model.Visitor) error {
	return GetDB().Omit("User").Save(visitor).Error
}

// HasRecentVisit 访客在指定时间之后是否已访问过该路径，用于去重
func (v *visitRepo) HasRecentVisit(visitorID uint, path string, since time.Time) (bool, error) {
	var count int64
	err := GetDB().Model(&model.VisitLog{}).
		Where("visitor_id = ? AND path = ? AND created_at >= ?", visitorID, path, since).
		Limit(1).Count(&count).Error
	return count > 0, err
}

func (v *visitRepo) CreateVisitLog(log *model.VisitLog) error {
	return GetDB().Omit("Visitor", "User").Create(log).Error
}

// DeleteInteraction 删除某用户对某目标的互动记录，如取消点赞
func (v *visitRepo) DeleteInteraction(userID uint, action, targetType string, targetID uint) error {
	return GetDB().Where("user_id = ? AND action = ? AND target_type = ? AND target_id = ?", userID, action, targetType, targetID).
		Delete(&model.VisitLog{}).Error
}

func (v *visitRepo) ListVisitLogs(req *dto.ListVisitLogReq) ([]model.VisitLog, int64, error) {
	q := GetDB().Model(&model.VisitLog{}).Preload("User").Preload("Visitor").Preload("TargetUser").
		// /random 只是跳转中转页，不再记录；升级前的旧记录在这里过滤
		Where("path <> ?", "/random")
	switch req.Action {
	case constant.VisitActionVisit:
		q = q.Where("action = ?", constant.VisitActionVisit)
	case "interaction":
		q = q.Where("action <> ?", constant.VisitActionVisit)
	}
	switch req.Kind {
	case "user":
		q = q.Where("user_id IS NOT NULL")
	case "anonymous":
		q = q.Where("user_id IS NULL")
	}
	if req.VisitorID > 0 {
		q = q.Where("visitor_id = ?", req.VisitorID)
	}
	if req.Source != "" {
		q = q.Where("source = ?", req.Source)
		if req.SourceHost != "" {
			q = q.Where("referrer_host = ?", req.SourceHost)
		}
	}
	if req.Trust != "" {
		q = q.Where("trust = ?", req.Trust)
	}
	if req.Country != "" {
		q = q.Where("inferred_country = ?", req.Country)
	}
	if req.Device != "" {
		q = q.Where("device_type = ?", req.Device)
	}
	if req.TargetType != "" {
		q = q.Where("target_type = ?", req.TargetType)
		if req.TargetID > 0 {
			q = q.Where("target_id = ?", req.TargetID)
		}
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size := req.Size
	if size == 0 || size > 100 {
		size = constant.PageLimitDefault
	}
	page := req.Page
	if page == 0 {
		page = 1
	}
	var logs []model.VisitLog
	err := q.Order("created_at DESC, id DESC").Offset(int((page - 1) * size)).Limit(int(size)).Find(&logs).Error
	return logs, total, err
}

// CountVisitStats 统计指定时间之后的访问量、独立访客数与登录用户访问数，以及累计访客数
func (v *visitRepo) CountVisitStats(since time.Time) (*dto.VisitStatsDto, error) {
	stats := &dto.VisitStatsDto{}
	db := GetDB()
	// 只统计访问，不含点赞、评论等互动记录与疑似自动化
	visits := func() *gorm.DB {
		return HumanVisits(db.Model(&model.VisitLog{}))
	}
	if err := visits().Where("created_at >= ?", since).Count(&stats.TodayPV).Error; err != nil {
		return nil, err
	}
	if err := visits().Where("created_at >= ? AND visitor_id IS NOT NULL", since).
		Distinct("visitor_id").Count(&stats.TodayUV).Error; err != nil {
		return nil, err
	}
	if err := visits().Where("created_at >= ? AND user_id IS NOT NULL", since).
		Count(&stats.TodayUserVisits).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.Visitor{}).Count(&stats.TotalVisitors).Error; err != nil {
		return nil, err
	}
	// 来源排行：常见来源按分类汇总，其他网站按域名区分；不统计站内跳转
	stats.TodaySources = []dto.VisitSourceCount{}
	if err := visits().
		Select("source, CASE WHEN source = ? THEN referrer_host ELSE '' END AS host, COUNT(*) AS count", "external").
		Where("created_at >= ? AND source <> '' AND source <> ?", since, "internal").
		Group("source, host").Order("count DESC").Limit(10).
		Scan(&stats.TodaySources).Error; err != nil {
		return nil, err
	}
	return stats, nil
}

// HumanVisits 只保留访问记录（不含互动），并排除疑似自动化；用于浏览量、访客数等统计
func HumanVisits(q *gorm.DB) *gorm.DB {
	return q.Where("visit_logs.action = ?", constant.VisitActionVisit).
		Where("(visit_logs.trust IS NULL OR visit_logs.trust <> ?)", constant.VisitTrustBot)
}

func (v *visitRepo) GetVisitLog(id uint) (*model.VisitLog, error) {
	var log model.VisitLog
	if err := GetDB().Preload("User").Preload("Visitor").Preload("TargetUser").First(&log, id).Error; err != nil {
		return nil, err
	}
	return &log, nil
}

// ListVisitorVisits 某访客最近的访问记录
func (v *visitRepo) ListVisitorVisits(visitorID uint, limit int) ([]model.VisitLog, error) {
	var logs []model.VisitLog
	err := GetDB().Preload("User").Preload("Visitor").
		Where("visitor_id = ? AND action = ?", visitorID, constant.VisitActionVisit).
		Order("created_at DESC, id DESC").Limit(limit).Find(&logs).Error
	return logs, err
}

// ListInsightVisits 指定时间之后的全部访问（含疑似自动化），只取统计用到的字段
func (v *visitRepo) ListInsightVisits(since time.Time) ([]model.VisitLog, error) {
	var logs []model.VisitLog
	err := GetDB().Model(&model.VisitLog{}).
		Select("visitor_id, created_at, path, target_type, target_id, source, referrer, referrer_host, os, browser, device_type, ip_country, has_signals, time_zone, languages, color_scheme, trust, trust_flags, inferred_country, engaged_ms, scroll_depth").
		Where("action = ? AND created_at >= ? AND path <> ?", constant.VisitActionVisit, since, "/random").
		Find(&logs).Error
	return logs, err
}

// FindLatestVisit 访客在指定时间之后最近一次访问某路径的记录
func (v *visitRepo) FindLatestVisit(visitorID uint, path string, since time.Time) (*model.VisitLog, error) {
	var log model.VisitLog
	err := GetDB().Where("visitor_id = ? AND path = ? AND action = ? AND created_at >= ?", visitorID, path, constant.VisitActionVisit, since).
		Order("created_at DESC, id DESC").First(&log).Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}

// AddVisitEngagement 累加停留时长，滚动深度取最大值
func (v *visitRepo) AddVisitEngagement(visitID uint, engagedMs int64, scrollDepth int) error {
	return GetDB().Model(&model.VisitLog{}).Where("id = ?", visitID).UpdateColumns(map[string]any{
		"engaged_ms":   gorm.Expr("COALESCE(engaged_ms, 0) + ?", engagedMs),
		"scroll_depth": gorm.Expr("CASE WHEN scroll_depth IS NULL OR scroll_depth < ? THEN ? ELSE scroll_depth END", scrollDepth, scrollDepth),
	}).Error
}

func (v *visitRepo) CreateVisitEvent(event *model.VisitEvent) error {
	return GetDB().Create(event).Error
}

// ListVisitEvents 指定时间之后的某类事件
func (v *visitRepo) ListVisitEvents(name string, since time.Time) ([]model.VisitEvent, error) {
	var events []model.VisitEvent
	err := GetDB().Where("name = ? AND created_at >= ?", name, since).Find(&events).Error
	return events, err
}

// CountVisitorsFirstSeenSince 访客中首次访问在指定时间之后的人数
func (v *visitRepo) CountVisitorsFirstSeenSince(ids []uint, since time.Time) (int64, error) {
	var total int64
	for start := 0; start < len(ids); start += 500 {
		var n int64
		end := min(start+500, len(ids))
		if err := GetDB().Model(&model.Visitor{}).Where("id IN ? AND created_at >= ?", ids[start:end], since).Count(&n).Error; err != nil {
			return 0, err
		}
		total += n
	}
	return total, nil
}

// PostInteraction 区间内对某篇文章的点赞或评论次数
type PostInteraction struct {
	TargetID uint
	Action   string
	Count    int64
}

// CountPostInteractions 指定时间之后对文章的点赞与评论（不含对评论的点赞和回复）
func (v *visitRepo) CountPostInteractions(since time.Time) ([]PostInteraction, error) {
	var rows []PostInteraction
	err := GetDB().Model(&model.VisitLog{}).Select("target_id, action, COUNT(*) AS count").
		Where("action IN ? AND target_type = ? AND created_at >= ?", []string{constant.VisitActionLike, constant.VisitActionComment}, constant.TargetTypePost, since).
		Group("target_id, action").Scan(&rows).Error
	return rows, err
}

// DeleteVisitEventsBefore 删除指定时间之前的页面事件
func (v *visitRepo) DeleteVisitEventsBefore(before time.Time) (int64, error) {
	result := GetDB().Where("created_at < ?", before).Delete(&model.VisitEvent{})
	return result.RowsAffected, result.Error
}

// DeleteInactiveVisitors 删除指定时间之后没有再访问的访客汇总，返回删除条数
func (v *visitRepo) DeleteInactiveVisitors(before time.Time) (int64, error) {
	result := GetDB().Where("last_seen_at < ?", before).Delete(&model.Visitor{})
	return result.RowsAffected, result.Error
}

// DeleteVisitLogsBefore 删除指定时间之前的访问记录，返回删除条数
func (v *visitRepo) DeleteVisitLogsBefore(before time.Time) (int64, error) {
	result := GetDB().Where("created_at < ?", before).Delete(&model.VisitLog{})
	return result.RowsAffected, result.Error
}

// TargetInfo 访问目标（文章/页面）的当前标题与 slug
type TargetInfo struct {
	ID        uint
	Title     string
	Slug      *string
	IsPrivate bool // 后台据此把私密文章 / 页面的链接指向后台预览
}

// GetTargetInfos 批量查询文章或页面的标题，用于访问记录展示
func (v *visitRepo) GetTargetInfos(targetType string, ids []uint) (map[uint]TargetInfo, error) {
	result := map[uint]TargetInfo{}
	if len(ids) == 0 {
		return result, nil
	}
	var target any
	switch targetType {
	case constant.TargetTypePost:
		target = &model.Post{}
	case constant.TargetTypePage:
		target = &model.Page{}
	default:
		return result, nil
	}
	var infos []TargetInfo
	if err := GetDB().Model(target).Select("id, title, slug, is_private").Where("id IN ?", ids).Scan(&infos).Error; err != nil {
		return nil, err
	}
	for _, info := range infos {
		result[info.ID] = info
	}
	return result, nil
}

// CommentBrief 互动记录展示用的评论摘要
type CommentBrief struct {
	ID         uint
	Content    string
	TargetType string
	TargetID   uint
}

// GetCommentBriefs 批量查询评论内容及所在的文章/页面，已删除的评论不返回
func (v *visitRepo) GetCommentBriefs(ids []uint) (map[uint]CommentBrief, error) {
	result := map[uint]CommentBrief{}
	if len(ids) == 0 {
		return result, nil
	}
	var briefs []CommentBrief
	if err := GetDB().Model(&model.Comment{}).Select("id, content, target_type, target_id").Where("id IN ?", ids).Scan(&briefs).Error; err != nil {
		return nil, err
	}
	for _, brief := range briefs {
		result[brief.ID] = brief
	}
	return result, nil
}

// GetPathNames 按 slug / 用户名批量查询标签、分类、用户的显示名称，用于访问记录展示
// kind 为 label / category / user，返回 key -> 名称
func (v *visitRepo) GetPathNames(kind string, keys []string) (map[string]string, error) {
	result := map[string]string{}
	if len(keys) == 0 {
		return result, nil
	}
	var rows []struct {
		PathKey string
		AltKey  string
		Name    string
	}
	var q *gorm.DB
	switch kind {
	case "label":
		// 首页标签筛选参数可能是 slug，也可能是标签名
		q = GetDB().Model(&model.Label{}).Select("slug AS path_key, name AS alt_key, name").Where("slug IN ? OR name IN ?", keys, keys)
	case "category":
		q = GetDB().Model(&model.Category{}).Select("slug AS path_key, name AS alt_key, name").Where("slug IN ?", keys)
	case "user":
		q = GetDB().Model(&model.User{}).Select("username AS path_key, username AS alt_key, CASE WHEN nickname <> '' THEN nickname ELSE username END AS name").Where("username IN ?", keys)
	default:
		return result, nil
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.PathKey] = row.Name
		result[row.AltKey] = row.Name
	}
	return result, nil
}
