package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func (cc *AdminController) ListUsers(ctx context.Context, c *app.RequestContext) {
	paginationParams := ctxutils.GetPaginationParams(c)
	users, total, err := repo.User.ListUsers(paginationParams)
	if err != nil {
		resps.InternalServerError(c, err.Error())
	}
	resps.Ok(
		c,
		resps.Success,
		utils.H{
			"users": model.ToUserDtos(users),
			"total": total,
		},
	)
}
