package repo

import (
	"time"

	"github.com/snowykami/neo-blog/pkg/cache"
)

// PostGuestCache 前台读取的文章详情与列表的短时缓存（两级：配置 Redis 时各实例共用），由 service 读写；
// 前台接口不看当前用户是谁，登录用户与访客共用（名字沿用早先「只缓存访客」时的叫法）：
// 访问量大时同一篇文章、同一页列表在 PostGuestCacheTTL 内只查一次库。
// 文章的发布、修改、删除、置顶，标签与分类的增删改，都会让整组缓存作废（InvalidatePostCache）；
// 点赞数、评论数、浏览量、热度等计数，以及作者资料的变化不触发作废，最多延迟 PostGuestCacheTTL 看到
var PostGuestCache = cache.NewTiered("post:guest", 2000, 32<<20).WithLocalTTL(10 * time.Second)

// PostGuestCacheTTL 缓存的有效期
const PostGuestCacheTTL = 30 * time.Second

// InvalidatePostCache 文章或其分类、标签变化后调用；同时让前端带 posts 标签的缓存失效（见 cache_tag.go）
func InvalidatePostCache() {
	PostGuestCache.Clear()
	TouchCacheTags(CacheTagPosts)
}
