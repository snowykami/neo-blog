package repo

import (
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

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
	if page > 0 {
		offset := (page - 1) * limit
		queryDB = queryDB.Offset(int(offset))
	}
	orderStr := orderBy
	if orderStr == "" {
		orderStr = "id"
	}
	if desc {
		orderStr += " DESC"
	} else {
		orderStr += " ASC"
	}
	err = queryDB.Limit(int(limit)).Order(orderStr).Find(&items).Error
	return
}
