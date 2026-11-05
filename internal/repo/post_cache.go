package repo

import (
	"time"

	"github.com/snowykami/neo-blog/pkg/cache"
)

// PostGuestCache 访客（未登录）读取的文章详情与列表的短时缓存（两级：配置 Redis 时各实例共用），由 service 读写：
// 访问量大时同一篇文章、同一页列表在 PostGuestCacheTTL 内只查一次库。
// 文章的发布、修改、删除、置顶，标签与分类的增删改，都会让整组缓存作废（InvalidatePostCache）；
// 点赞数、评论数、浏览量、热度等计数，以及作者资料的变化不触发作废，访客最多延迟 PostGuestCacheTTL 看到
var PostGuestCache = cache.NewTiered("post:guest", 2000, 32<<20).WithLocalTTL(10 * time.Second)

// PostGuestCacheTTL 访客缓存的有效期
const PostGuestCacheTTL = 30 * time.Second

// InvalidatePostCache 文章或其分类、标签变化后调用
func InvalidatePostCache() {
	PostGuestCache.Clear()
}
