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
	"golang.org/x/sync/singleflight"
)

// 前台读取的文章详情、列表、置顶文章、标签列表与引用卡片先读短时缓存（见 repo.PostGuestCache）：
// 前台接口只返回公开文章、不看当前用户是谁（点赞状态由浏览器另取），内容对所有人一致，登录用户与访客共用；查询出错不缓存

var postGuestFlight singleflight.Group

type cachedResult[T any] struct {
	val    T
	svcerr *errs.ServiceError
}

// publicCached 先读缓存，未命中时按 key 合并并发查询并写入，防止整组缓存失效瞬间惊群击穿数据库
func publicCached[T any](key string, load func() (T, *errs.ServiceError)) (T, *errs.ServiceError) {
	if value, ok := cache.GetJSON[T](repo.PostGuestCache, key); ok {
		return value, nil
	}
	raw, _, _ := postGuestFlight.Do(key, func() (any, error) {
		if value, ok := cache.GetJSON[T](repo.PostGuestCache, key); ok {
			return cachedResult[T]{val: value}, nil
		}
		value, svcerr := load()
		if svcerr == nil {
			cache.SetJSON(repo.PostGuestCache, key, value, repo.PostGuestCacheTTL)
		}
		return cachedResult[T]{val: value, svcerr: svcerr}, nil
	})
	res := raw.(cachedResult[T])
	return res.val, res.svcerr
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

var pageGuestFlight singleflight.Group

// pageCached 前台独立页面详情与列表的短时缓存（见 repo.PageGuestCache）
func pageCached[T any](key string, load func() (T, *errs.ServiceError)) (T, *errs.ServiceError) {
	if value, ok := cache.GetJSON[T](repo.PageGuestCache, key); ok {
		return value, nil
	}
	raw, _, _ := pageGuestFlight.Do(key, func() (any, error) {
		if value, ok := cache.GetJSON[T](repo.PageGuestCache, key); ok {
			return cachedResult[T]{val: value}, nil
		}
		value, svcerr := load()
		if svcerr == nil {
			cache.SetJSON(repo.PageGuestCache, key, value, repo.PostGuestCacheTTL)
		}
		return cachedResult[T]{val: value, svcerr: svcerr}, nil
	})
	res := raw.(cachedResult[T])
	return res.val, res.svcerr
}

type guestPageList struct {
	Pages []*dto.PageDto `json:"pages"`
	Total int64          `json:"total"`
}

func pageListCacheKey(req *dto.ListPageReq) string {
	data, _ := json.Marshal(req)
	sum := sha256.Sum256(data)
	return "list:" + hex.EncodeToString(sum[:12])
}
