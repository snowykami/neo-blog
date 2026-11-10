package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 刷新歌词来源（见 docs/music-player-spec.md 7.2h）：读者在「暂无歌词」下方点「重新获取歌词」时，各来源接口带 refresh=1，
// 这次请求不信任缓存里「没有歌词」的记录、重新向上游探测；同一首歌的同一来源 lyricRefreshInterval 内只绕过一次
// （节流记在 pkg/sharedstate，多副本共用），避免接口被用来频繁请求上游。读者的刷新不会让命中的歌词提前复核。
//
// 管理员触发时是「强制复核」：不受上面的节流与缓存有效期限制，每次都真的问一次上游，再比较内容摘要——
// 上游改了就更新缓存与全站版本，没改就什么都不动（全站版本只在歌词内容变化时保存，见 saveLyricVersion）。
//
// 平时命中的歌词缓存按 lyricRevalidateInterval 与上游复核（TTML 与各平台歌词一致），复核时比较整个歌词内容的摘要，
// 上游只改了某个字的时间轴也能发现。复核在后台进行（stale-while-revalidate，见 revalidateLyricInBackground）：
// 请求立即拿到缓存里的歌词，不等上游；上游出错时按 lyricRevalidateBackoff 退避，故障期间不会每次请求都去问一次

const lyricRefreshInterval = 30 * time.Second

// lyricRevalidateInterval 命中的歌词缓存隔多久与上游复核一次（TTML、网易云、QQ 音乐、酷狗音乐一致）：
// 平台歌词变化慢，但改了就要更新，所以命中也按天数复核一次而不是一直用到过期
const lyricRevalidateInterval = 24 * time.Hour

const (
	// lyricRevalidateTimeout 一次后台复核的时限（上游各请求另有自己的超时）
	lyricRevalidateTimeout = 30 * time.Second
	// lyricRevalidateBackoff 后台复核失败（出错、超时或 panic）后，这首歌的这个来源多久内不再复核
	lyricRevalidateBackoff = 15 * time.Minute
)

// lyricRefreshKeyPrefix / lyricRevalidateKeyPrefix sharedstate 中的键：读者刷新的节流、后台复核的占用与退避
const (
	lyricRefreshKeyPrefix    = "music:lyric:refresh:"
	lyricRevalidateKeyPrefix = "music:lyric:revalidate:"
)

// lyricRevalidateRunning 本实例正在进行的后台复核数（只用于观测，测试中等待后台复核结束）
var lyricRevalidateRunning atomic.Int32

type lyricRefreshKey struct{}

// lyricForceKey 管理员「重新获取歌词」：连缓存的有效期也不信（见 lyricForced）
type lyricForceKey struct{}

// WithLyricRefresh 标记这次请求要重新探测缓存里「没有歌词」的记录：
// 普通用户与访客按 lyricRefreshInterval 节流，管理员则强制复核
func WithLyricRefresh(ctx context.Context, source string, id int64) context.Context {
	return withLyricRefresh(ctx, source, id, ctxutils.IsAdmin(ctx))
}

// withLyricRefresh force 由调用方给出：歌词选择在后台协程里进行，那里拿不到请求上下文里的身份
func withLyricRefresh(ctx context.Context, source string, id int64, force bool) context.Context {
	if force {
		return context.WithValue(context.WithValue(ctx, lyricRefreshKey{}, true), lyricForceKey{}, true)
	}
	key := lyricRefreshKeyPrefix + source + ":" + strconv.FormatInt(id, 10)
	ok, err := sharedstate.Current().SetNX(key, "1", lyricRefreshInterval)
	if err != nil {
		// 共享状态不可用时按节流处理（保守：不放开绕过缓存）
		logrus.Warnf("lyric refresh throttle failed: %v", err)
		return ctx
	}
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, lyricRefreshKey{}, true)
}

// lyricRefreshing 这次请求是否重新探测缓存里「没有歌词」的记录
func lyricRefreshing(ctx context.Context) bool {
	refresh, _ := ctx.Value(lyricRefreshKey{}).(bool)
	return refresh
}

// lyricForced 这次请求是否连缓存的有效期也不信（管理员「重新获取歌词」：必须问一次上游再比较内容有没有变）
func lyricForced(ctx context.Context) bool {
	force, _ := ctx.Value(lyricForceKey{}).(bool)
	return force
}

// lyricCacheStale 命中的缓存是否该与上游复核：隔 lyricRevalidateInterval 复核一次；旧条目没有摘要时也复核一次。
// 复核在后台进行（见 revalidateLyricInBackground），请求照常返回缓存
func lyricCacheStale(checkedAt int64, hasDigest bool) bool {
	if !hasDigest {
		return true
	}
	return time.Since(time.Unix(checkedAt, 0)) > lyricRevalidateInterval
}

// revalidateLyricInBackground 在后台复核一条命中的歌词缓存，调用方立即返回缓存里的歌词。
// key 区分来源与歌曲；同一个 key 同一时间只有一个复核（sharedstate.SetNX 占用，跨实例生效），
// 复核失败（返回错误、超时或 panic）时占用改为退避，lyricRevalidateBackoff 内不再复核；成功时释放。
// run 负责请求上游并写回缓存（摘要相同只是把核对时间往后推），ctx 带 lyricRevalidateTimeout 时限
func revalidateLyricInBackground(key string, run func(ctx context.Context) error) {
	lockKey := lyricRevalidateKeyPrefix + key
	token := sharedstate.InstanceID() + ":" + strconv.FormatInt(time.Now().UnixNano(), 36)
	// 占用的有效期比时限稍长：实例在复核中途退出时自动过期
	ok, err := sharedstate.Current().SetNX(lockKey, token, lyricRevalidateTimeout+10*time.Second)
	if err != nil {
		logrus.Warnf("lyric revalidate claim failed: %s: %v", key, err)
		return
	}
	if !ok {
		// 正在复核或在退避中
		return
	}
	lyricRevalidateRunning.Add(1)
	go func() {
		defer lyricRevalidateRunning.Add(-1)
		failed := true
		defer func() {
			if r := recover(); r != nil {
				logrus.Errorf("lyric revalidate panic: %s: %v", key, r)
			}
			store := sharedstate.Current()
			if failed {
				if _, err := store.Extend(lockKey, token, lyricRevalidateBackoff); err != nil {
					logrus.Warnf("lyric revalidate backoff failed: %s: %v", key, err)
				}
				return
			}
			if _, err := store.CompareAndDelete(lockKey, token); err != nil {
				logrus.Warnf("lyric revalidate release failed: %s: %v", key, err)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), lyricRevalidateTimeout)
		defer cancel()
		if err := run(ctx); err != nil {
			logrus.Warnf("lyric revalidate failed, backing off: %s: %v", key, err)
			return
		}
		failed = false
	}()
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
