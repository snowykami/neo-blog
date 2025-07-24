package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
	"strconv"
)

type PaginationParams struct {
	Page      uint64
	Size      uint64
	OrderedBy string
	Reverse   bool // 默认是从大值到小值
}

func GetPaginationParams(c *app.RequestContext) *PaginationParams {
	page := c.Query("page")
	size := c.Query("size")
	orderedBy := c.Query("ordered_by")
	reverse := c.Query("reverse")
	if page == "" {
		page = "1"
	}
	if size == "" {
		size = "10"
	}
	var reverseBool bool
	if reverse == "" || reverse == "false" || reverse == "0" {
		reverseBool = false
	} else {
		reverseBool = true
	}
	pageNum, err := strconv.ParseUint(page, 10, 64)
	if err != nil || pageNum < 1 {
		pageNum = 1
	}
	sizeNum, err := strconv.ParseUint(size, 10, 64)
	if err != nil || sizeNum < 1 {
		sizeNum = 10
	}
	return &PaginationParams{
		Page:      pageNum,
		Size:      sizeNum,
		OrderedBy: orderedBy,
		Reverse:   reverseBool,
	}
}
