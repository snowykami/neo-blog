package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
)

func GetPaginationParams(c *app.RequestContext) *dto.PaginationParams {
	paginationParams := &dto.PaginationParams{}
	err := c.BindQuery(paginationParams)
	if err != nil {
		return nil
	}
	return paginationParams
}
