package v1

// import (
// 	"context"

// 	"github.com/cloudwego/hertz/pkg/app"
// 	"github.com/cloudwego/hertz/pkg/common/utils"
// 	"github.com/snowykami/neo-blog/internal/ctxutils"
// 	"github.com/snowykami/neo-blog/internal/repo"
// 	"github.com/snowykami/neo-blog/pkg/resps"
// )

// func (cc *AdminController) ListComments(ctx context.Context, c *app.RequestContext) {
// 	paginationParams := ctxutils.GetPaginationParams(c)
// 	comments, total, err := repo.Comment.ListComments(paginationParams)
// 	if err != nil {
// 		resps.InternalServerError(c, err.Error())
// 		return
// 	}
// 	resps.Ok(
// 		c,
// 		resps.Success,
// 		utils.H{
// 			"comments": models.ToCommentDtos(comments),
// 			"total":    total,
// 		},
// 	)
// }
