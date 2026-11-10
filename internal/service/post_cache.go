package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 前台读取的文章详情、列表、置顶文章与引用卡片先读短时缓存（见 repo.PostGuestCache）：
// 前台接口只返回公开文章、不看当前用户是谁（点赞状态由浏览器另取），内容对所有人一致，登录用户与访客共用；查询出错不缓存

// publicCached 先读缓存，未命中时查询并写入
func publicCached[T any](key string, load func() (T, *errs.ServiceError)) (T, *errs.ServiceError) {
	if value, ok := cache.GetJSON[T](repo.PostGuestCache, key); ok {
		return value, nil
	}
	value, svcerr := load()
	if svcerr == nil {
		cache.SetJSON(repo.PostGuestCache, key, value, repo.PostGuestCacheTTL)
	}
	return value, svcerr
}

// postCardCacheKey 文章引用卡片批量查询的缓存键：按 id 列表区分
func postCardCacheKey(ids []uint) string {
	builder := strings.Builder{}
	builder.WriteString("cards:")
	for i, id := range ids {
		if i > 0 {
			builder.WriteString(",")
		}
		builder.WriteString(strconv.FormatUint(uint64(id), 10))
	}
	return builder.String()
}

// guestPostList 缓存中的一页文章
type guestPostList struct {
	Posts []*dto.PostDto `json:"posts"`
	Total int64          `json:"total"`
}

// postListCacheKey 列表请求的缓存键：按全部查询参数区分
func postListCacheKey(req *dto.ListPostReq) string {
	data, _ := json.Marshal(req)
	sum := sha256.Sum256(data)
	return "list:" + hex.EncodeToString(sum[:12])
}
