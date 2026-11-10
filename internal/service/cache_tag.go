package service

import (
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// CacheTagVersions 前端服务端缓存各失效标签的当前版本号（公开接口，不看当前用户是谁）：
// 前端每个实例每隔几秒读一次，版本变了就让带这个标签的缓存失效（见 repo/cache_tag.go 与 web/cache-handler.mjs）
func CacheTagVersions() (map[string]string, *errs.ServiceError) {
	versions, err := repo.CacheTagVersions()
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	return versions, nil
}
