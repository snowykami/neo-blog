package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
)

// 刷新歌词来源（见 docs/music-player-spec.md 7.2h）：读者在播放器里「重新获取歌词」时，各来源接口带 refresh=1，
// 这次请求跳过缓存里已有的记录、重新向上游获取；同一首歌的同一来源 lyricRefreshInterval 内只绕过一次缓存，
// 避免接口被用来频繁请求上游。TTML 与各平台歌词的缓存命中记录也按 lyricRevalidateInterval 与上游复核（见下），
// 复核时比较整个歌词内容的摘要，上游只改了某个字的时间轴也能发现。
//
// 管理员触发时是「强制复核」：不受上面的节流与缓存有效期限制，每次都真的问一次上游，再比较内容摘要——
// 上游改了就更新缓存与全站版本，没改就什么都不动（全站版本只在歌词内容变化时保存，见 saveLyricVersion）

const lyricRefreshInterval = 30 * time.Second

// lyricRevalidateInterval 命中的歌词缓存隔多久与上游复核一次（TTML、网易云、QQ 音乐、酷狗音乐一致）：
// 平台歌词变化慢，但改了就要更新，所以命中也按天数复核一次而不是一直用到过期
const lyricRevalidateInterval = 24 * time.Hour

type lyricRefreshKey struct{}

// lyricForceKey 管理员「重新获取歌词」：连缓存的有效期也不信（见 lyricForced）
type lyricForceKey struct{}

var lyricRefreshAt sync.Map // 来源:歌曲 id → 上次绕过缓存的时间

// WithLyricRefresh 标记这次请求要跳过缓存里已有的记录重新向上游获取：
// 普通用户与访客按 lyricRefreshInterval 节流，管理员则强制复核
func WithLyricRefresh(ctx context.Context, source string, id int64) context.Context {
	return withLyricRefresh(ctx, source, id, ctxutils.IsAdmin(ctx))
}

// withLyricRefresh force 由调用方给出：歌词选择在后台协程里进行，那里拿不到请求上下文里的身份
func withLyricRefresh(ctx context.Context, source string, id int64, force bool) context.Context {
	if force {
		return context.WithValue(context.WithValue(ctx, lyricRefreshKey{}, true), lyricForceKey{}, true)
	}
	key := source + ":" + strconv.FormatInt(id, 10)
	now := time.Now()
	if last, ok := lyricRefreshAt.Load(key); ok && now.Sub(last.(time.Time)) < lyricRefreshInterval {
		return ctx
	}
	lyricRefreshAt.Store(key, now)
	return context.WithValue(ctx, lyricRefreshKey{}, true)
}

// lyricRefreshing 这次请求是否跳过缓存里已有的记录（命中的缓存也立即复核）
func lyricRefreshing(ctx context.Context) bool {
	refresh, _ := ctx.Value(lyricRefreshKey{}).(bool)
	return refresh
}

// lyricForced 这次请求是否连缓存的有效期也不信（管理员「重新获取歌词」：必须问一次上游再比较内容有没有变）
func lyricForced(ctx context.Context) bool {
	force, _ := ctx.Value(lyricForceKey{}).(bool)
	return force
}

// lyricCacheNeedsRevalidate 命中的缓存是否需要与上游复核：刷新歌词时立即复核，
// 否则隔 lyricRevalidateInterval 复核一次；旧条目没有摘要时也复核一次
func lyricCacheNeedsRevalidate(ctx context.Context, checkedAt int64, hasDigest bool) bool {
	if lyricRefreshing(ctx) || !hasDigest {
		return true
	}
	return time.Since(time.Unix(checkedAt, 0)) > lyricRevalidateInterval
}

// lyricContentDigest 整个歌词内容的摘要（sha256）：与缓存里的摘要不同表示上游改过文件，
// 只改了时间轴（歌词文本没变）也算改动
func lyricContentDigest(content any) string {
	data, err := json.Marshal(content)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
