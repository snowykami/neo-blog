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
	// 只统计访问，不含点赞、评论等互动记录
	visits := func() *gorm.DB {
		return db.Model(&model.VisitLog{}).Where("action = ?", constant.VisitActionVisit)
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

// DeleteVisitLogsBefore 删除指定时间之前的访问记录，返回删除条数
func (v *visitRepo) DeleteVisitLogsBefore(before time.Time) (int64, error) {
	result := GetDB().Where("created_at < ?", before).Delete(&model.VisitLog{})
	return result.RowsAffected, result.Error
}

// TargetInfo 访问目标（文章/页面）的当前标题与 slug
type TargetInfo struct {
	ID    uint
	Title string
	Slug  *string
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
	if err := GetDB().Model(target).Select("id, title, slug").Where("id IN ?", ids).Scan(&infos).Error; err != nil {
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
