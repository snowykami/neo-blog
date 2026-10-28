package service

import (
	"context"
	"strconv"
	"sync"
	"time"
)

// 刷新歌词来源（见 docs/music-player-spec.md 7.2h）：读者在播放器里「重新获取歌词」时，各来源接口带 refresh=1，
// 这次请求跳过缓存中「没有歌词」的记录、重新向上游获取（命中的歌词照常使用缓存，不增加上游压力）；
// 同一首歌的同一来源 lyricRefreshInterval 内只绕过一次缓存，避免接口被用来频繁请求上游

const lyricRefreshInterval = 30 * time.Second

type lyricRefreshKey struct{}

var lyricRefreshAt sync.Map // 来源:歌曲 id → 上次绕过缓存的时间

// WithLyricRefresh 标记这次请求要跳过缓存中「没有歌词」的记录（受节流限制，超出频率时原样返回）
func WithLyricRefresh(ctx context.Context, source string, id int64) context.Context {
	key := source + ":" + strconv.FormatInt(id, 10)
	now := time.Now()
	if last, ok := lyricRefreshAt.Load(key); ok && now.Sub(last.(time.Time)) < lyricRefreshInterval {
		return ctx
	}
	lyricRefreshAt.Store(key, now)
	return context.WithValue(ctx, lyricRefreshKey{}, true)
}

// lyricRefreshing 这次请求是否跳过缓存中「没有歌词」的记录
func lyricRefreshing(ctx context.Context) bool {
	refresh, _ := ctx.Value(lyricRefreshKey{}).(bool)
	return refresh
}
