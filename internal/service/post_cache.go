package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 访客（未登录）读取的文章详情、列表与置顶文章先读短时缓存（见 repo.PostGuestCache）：
// 前台接口只返回公开文章，内容对所有人一致；登录用户的详情带点赞状态，暂不缓存；查询出错不缓存

// isGuest 当前请求没有登录用户
func isGuest(ctx context.Context) bool {
	_, ok := ctxutils.GetCurrentUser(ctx)
	return !ok
}

// guestCached 访客的请求先读缓存，未命中时查询并写入
func guestCached[T any](ctx context.Context, key string, load func() (T, *errs.ServiceError)) (T, *errs.ServiceError) {
	if !isGuest(ctx) {
		return load()
	}
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
