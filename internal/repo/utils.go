package repo

import (
	"regexp"
	"slices"

	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 排序字段只允许形如 column 或 table.column 的标识符
var orderColumnPattern = regexp.MustCompile(`^[a-z_]+(\.[a-z_]+)?$`)

// AllowedOrderBy 排序字段不在允许列表内时回退到 fallback，防止任意字符串进入 ORDER BY
func AllowedOrderBy(orderBy string, allowed []string, fallback string) string {
	if slices.Contains(allowed, orderBy) {
		return orderBy
	}
	return fallback
}

// orderColumn 构造带引号的排序子句；非法字段回退到 id
func orderColumn(orderBy string, desc bool) clause.OrderByColumn {
	if !orderColumnPattern.MatchString(orderBy) {
		orderBy = "id"
	}
	return clause.OrderByColumn{Column: clause.Column{Name: orderBy}, Desc: desc}
}

func PaginateQuery[T any](db *gorm.DB, page, limit uint64, orderBy string, desc bool, conditions ...any) (items []T, total int64, err error) {
	countDB := db
	if len(conditions) > 0 {
		countDB = countDB.Where(conditions[0], conditions[1:]...)
	}
	err = countDB.Model(new(T)).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = constant.PageLimitDefault
	}
	queryDB := db
	if len(conditions) > 0 {
		queryDB = queryDB.Where(conditions[0], conditions[1:]...)
	}
	items, err = paginate[T](queryDB, page, limit, orderBy, desc)
	return
}

// paginate 只做分页查询不统计总数，供已自行统计总数的查询使用
func paginate[T any](db *gorm.DB, page, limit uint64, orderBy string, desc bool) (items []T, err error) {
	if limit <= 0 {
		limit = constant.PageLimitDefault
	}
	if page > 0 {
		db = db.Offset(int((page - 1) * limit))
	}
	err = db.Limit(int(limit)).Order(orderColumn(orderBy, desc)).Find(&items).Error
	return
}
