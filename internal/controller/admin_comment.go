package v1

// func (cc *AdminController) ListComments(ctx context.Context, c *app.RequestContext) {
// 	paginationParams := ctxutils.GetPaginationParams(c)
// 	comments, total, err := repo.Comment.ListCommentsAdmin(paginationParams.Page, paginationParams.Size, paginationParams.OrderBy, paginationParams.Desc)
// 	if err != nil {
// 		resps.InternalServerError(c, err.Error())
// 		return
// 	}
// 	resps.Ok(
// 		c,
// 		resps.Success,
// 		utils.H{
// 			"comments": model.Comment,
// 			"total":    total,
// 		},
// 	)
// }
