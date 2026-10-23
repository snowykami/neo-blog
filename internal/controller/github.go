package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type githubType struct {
	service *service.GithubService
}

// Github 文章内 GitHub 仓库卡的数据
var Github = &githubType{service: service.NewGithubService()}

// Repo 仓库公开信息
func (g *githubType) Repo(ctx context.Context, c *app.RequestContext) {
	repo, svcerr := g.service.GetRepo(ctx, c.Param("owner"), c.Param("repo"))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	// 后端已按仓库缓存，浏览器也可短暂缓存
	c.Response.Header.Set("Cache-Control", "public, max-age=600")
	resps.Ok(c, resps.Success, repo)
}
