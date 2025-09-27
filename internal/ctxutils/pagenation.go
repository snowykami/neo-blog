package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
)

type PaginationParams struct {
	Page    uint64 `query:"page" default:"1"`
	Size    uint64 `query:"size" default:"10"`
	OrderBy string `query:"order_by" default:"created_at"`
	Desc    bool   `query:"desc" default:"false"` // 默认是从大值到小值
}

func GetPaginationParams(c *app.RequestContext) *PaginationParams {
	paginationParams := &PaginationParams{}
	err := c.BindQuery(paginationParams)
	if err != nil {
		return nil
	}
	return paginationParams
}
