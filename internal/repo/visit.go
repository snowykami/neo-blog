package repo

import (
	"time"

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

func (v *visitRepo) ListVisitLogs(req *dto.ListVisitLogReq) ([]model.VisitLog, int64, error) {
	q := GetDB().Model(&model.VisitLog{}).Preload("User").Preload("Visitor")
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
	if err := db.Model(&model.VisitLog{}).Where("created_at >= ?", since).Count(&stats.TodayPV).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.VisitLog{}).Where("created_at >= ? AND visitor_id IS NOT NULL", since).
		Distinct("visitor_id").Count(&stats.TodayUV).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.VisitLog{}).Where("created_at >= ? AND user_id IS NOT NULL", since).
		Count(&stats.TodayUserVisits).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.Visitor{}).Count(&stats.TotalVisitors).Error; err != nil {
		return nil, err
	}
	// 来源排行：常见来源按分类汇总，其他网站按域名区分；不统计站内跳转
	stats.TodaySources = []dto.VisitSourceCount{}
	if err := db.Model(&model.VisitLog{}).
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
