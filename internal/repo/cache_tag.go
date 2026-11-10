package repo

import (
	"strconv"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 前端（Next.js）服务端缓存的失效标签：前端按标签缓存取数结果与 ISR 页面（见 web/src/lib/cache-tags.ts），
// 每个前端实例每隔几秒读一次各标签的版本号（GET /misc/cache-tags，见 web/cache-handler.mjs），版本变了就让带这个标签的缓存失效。
// 粒度只到数据种类：哪一篇文章变了不重要，前台页面在下次访问时才重新生成，一次修改最多让每个页面多渲染一次；
// 接口只暴露「某类数据在什么时候变过」，不会透露私密文章的 id 或 slug
const (
	// CacheTagPosts 文章、分类、标签（与访客缓存同步作废，见 InvalidatePostCache）
	CacheTagPosts = "posts"
	// CacheTagPages 自定义页面
	CacheTagPages = "pages"
	// CacheTagUsers 用户资料（用户主页；文章页的作者信息跟随文章的访客缓存，不挂这个标签）
	CacheTagUsers = "users"
	// CacheTagSite 站点配置（配置项写入，见 kvRepo.changed）
	CacheTagSite = "site"
)

// CacheTags 全部失效标签
var CacheTags = []string{CacheTagPosts, CacheTagPages, CacheTagUsers, CacheTagSite}

// cacheTagKeyPrefix 版本号在共享状态中的键前缀：多副本时任何一个后端实例的修改，前端都能从任意实例读到
const cacheTagKeyPrefix = "cache_tag:"

// TouchCacheTags 标记这些标签的数据已变化：写入新的版本号（当前时间，只用于比较是否变化，不参与时间计算）。
// 写入失败只记日志：前端缓存最多按各页面的 revalidate 过期
func TouchCacheTags(tags ...string) {
	version := strconv.FormatInt(time.Now().UnixNano(), 36)
	for _, tag := range tags {
		if err := sharedstate.Current().Set(cacheTagKeyPrefix+tag, version, 0); err != nil {
			logrus.Warnf("touch cache tag %s failed: %v", tag, err)
		}
	}
}

// CacheTagVersions 各标签的当前版本号；从未变化过的标签不出现在结果里
func CacheTagVersions() (map[string]string, error) {
	keys := make([]string, len(CacheTags))
	for i, tag := range CacheTags {
		keys[i] = cacheTagKeyPrefix + tag
	}
	values, err := sharedstate.Current().GetMany(keys...)
	if err != nil {
		return nil, err
	}
	versions := make(map[string]string, len(values))
	for _, tag := range CacheTags {
		if v, ok := values[cacheTagKeyPrefix+tag]; ok {
			versions[tag] = v
		}
	}
	return versions, nil
}
