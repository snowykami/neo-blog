package repo

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

type errorReportRepo struct{}

var ErrorReport = &errorReportRepo{}

// UpsertIssue 按指纹新建问题或累计一次：已解决的问题再次出现时回到未处理；返回最新的问题
func (r *errorReportRepo) UpsertIssue(issue *model.ErrorIssue) (*model.ErrorIssue, error) {
	issue.Count = 1
	if issue.Status == "" {
		issue.Status = constant.ErrorStatusUnresolved
	}
	// 同一条语句中各列读到的都是更新前的值，状态与解决时间按原状态一起判断
	err := GetDB().Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "fingerprint"}},
		DoUpdates: clause.Assignments(map[string]any{
			"count":        gorm.Expr("error_issues.count + 1"),
			"last_seen_at": issue.LastSeenAt,
			"last_release": gorm.Expr("CASE WHEN ? <> '' THEN ? ELSE error_issues.last_release END", issue.LastRelease, issue.LastRelease),
			"status":       gorm.Expr("CASE WHEN error_issues.status = ? THEN ? ELSE error_issues.status END", constant.ErrorStatusResolved, constant.ErrorStatusUnresolved),
			"resolved_at":  gorm.Expr("CASE WHEN error_issues.status = ? THEN NULL ELSE error_issues.resolved_at END", constant.ErrorStatusResolved),
		}),
	}).Create(issue).Error
	if err != nil {
		return nil, err
	}
	var saved model.ErrorIssue
	if err := GetDB().Where("fingerprint = ?", issue.Fingerprint).First(&saved).Error; err != nil {
		return nil, err
	}
	return &saved, nil
}

func (r *errorReportRepo) CreateEvent(event *model.ErrorEvent) error {
	return GetDB().Omit("User").Create(event).Error
}

func (r *errorReportRepo) ListIssues(req *dto.ListErrorIssuesReq) ([]model.ErrorIssue, int64, error) {
	q := GetDB().Model(&model.ErrorIssue{})
	if req.Status != "" {
		q = q.Where("status = ?", req.Status)
	}
	if req.Source != "" {
		q = q.Where("source = ?", req.Source)
	}
	if req.Kind != "" {
		q = q.Where("kind = ?", req.Kind)
	}
	if query := strings.TrimSpace(req.Query); query != "" {
		like := "%" + strings.ToLower(query) + "%"
		q = q.Where("LOWER(title) LIKE ? OR LOWER(culprit) LIKE ? OR id IN (?)", like, like,
			GetDB().Model(&model.ErrorEvent{}).Select("issue_id").Where("event_id = ?", strings.ToLower(query)))
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size, page := pageOf(req.Page, req.Size)
	var issues []model.ErrorIssue
	err := q.Order("last_seen_at DESC, id DESC").Offset(int((page - 1) * size)).Limit(int(size)).Find(&issues).Error
	return issues, total, err
}

func (r *errorReportRepo) GetIssue(id uint) (*model.ErrorIssue, error) {
	var issue model.ErrorIssue
	if err := GetDB().First(&issue, id).Error; err != nil {
		return nil, err
	}
	return &issue, nil
}

// IssueBreakdown 问题下保存的事件数、涉及的访客数，以及浏览器、系统与页面的分布（各取前几名）
func (r *errorReportRepo) IssueBreakdown(issueID uint, top int) (*dto.ErrorIssueDetailDto, error) {
	result := &dto.ErrorIssueDetailDto{}
	events := func() *gorm.DB { return GetDB().Model(&model.ErrorEvent{}).Where("issue_id = ?", issueID) }
	if err := events().Count(&result.StoredEvents).Error; err != nil {
		return nil, err
	}
	if err := events().Where("visitor_id IS NOT NULL").Distinct("visitor_id").Count(&result.Visitors).Error; err != nil {
		return nil, err
	}
	group := func(column string) ([]dto.NamedCount, error) {
		var rows []dto.NamedCount
		err := events().Select(column + " AS name, COUNT(*) AS count").Where(column + " <> ''").
			Group(column).Order("count DESC").Limit(top).Scan(&rows).Error
		return rows, err
	}
	var err error
	if result.Browsers, err = group("browser"); err != nil {
		return nil, err
	}
	if result.OS, err = group("os"); err != nil {
		return nil, err
	}
	if result.Paths, err = group("path"); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *errorReportRepo) ListEvents(issueID uint, req *dto.ListErrorEventsReq) ([]model.ErrorEvent, int64, error) {
	q := GetDB().Model(&model.ErrorEvent{}).Where("issue_id = ?", issueID)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size, page := pageOf(req.Page, req.Size)
	var events []model.ErrorEvent
	err := q.Omit("detail").Order("created_at DESC, id DESC").Offset(int((page - 1) * size)).Limit(int(size)).Find(&events).Error
	return events, total, err
}

func (r *errorReportRepo) GetEvent(id uint) (*model.ErrorEvent, error) {
	var event model.ErrorEvent
	if err := GetDB().Preload("User").First(&event, id).Error; err != nil {
		return nil, err
	}
	return &event, nil
}

func (r *errorReportRepo) UpdateIssueStatus(id uint, status string, at time.Time) error {
	var resolvedAt *time.Time
	if status == constant.ErrorStatusResolved {
		resolvedAt = &at
	}
	return GetDB().Model(&model.ErrorIssue{}).Where("id = ?", id).
		Updates(map[string]any{"status": status, "resolved_at": resolvedAt}).Error
}

// DeleteIssue 删除问题及其全部事件
func (r *errorReportRepo) DeleteIssue(id uint) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("issue_id = ?", id).Delete(&model.ErrorEvent{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.ErrorIssue{}, id).Error
	})
}

func (r *errorReportRepo) Stats(since time.Time) (*dto.ErrorReportStats, error) {
	stats := &dto.ErrorReportStats{}
	if err := GetDB().Model(&model.ErrorIssue{}).Where("status = ?", constant.ErrorStatusUnresolved).Count(&stats.Unresolved).Error; err != nil {
		return nil, err
	}
	if err := GetDB().Model(&model.ErrorIssue{}).Where("last_seen_at >= ?", since).Count(&stats.Active24h).Error; err != nil {
		return nil, err
	}
	return stats, nil
}

// DeleteBefore 清理超过保留期的事件，以及之后再没出现过的问题；返回删除的事件数与问题数
func (r *errorReportRepo) DeleteBefore(before time.Time) (events int64, issues int64, err error) {
	err = GetDB().Transaction(func(tx *gorm.DB) error {
		result := tx.Where("created_at < ?", before).Delete(&model.ErrorEvent{})
		if result.Error != nil {
			return result.Error
		}
		events = result.RowsAffected
		stale := tx.Model(&model.ErrorIssue{}).Select("id").Where("last_seen_at < ?", before)
		if err := tx.Where("issue_id IN (?)", stale).Delete(&model.ErrorEvent{}).Error; err != nil {
			return err
		}
		result = tx.Where("last_seen_at < ?", before).Delete(&model.ErrorIssue{})
		issues = result.RowsAffected
		return result.Error
	})
	return events, issues, err
}

// pageOf 分页参数：每页默认 constant.PageLimitDefault 条、最多 100 条，页码从 1 开始
func pageOf(page, size uint64) (uint64, uint64) {
	if size == 0 || size > 100 {
		size = constant.PageLimitDefault
	}
	if page == 0 {
		page = 1
	}
	return size, page
}
