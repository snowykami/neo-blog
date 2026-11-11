package utils

import (
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 计数存放在共享状态中，多实例部署时各实例共用同一个窗口。
// 共享状态出错（如 Redis 故障）时退回本进程内存中的同名计数，按同样的 key、上限与窗口拦截，而不是一律放行；
// 每次都先尝试共享状态，恢复后自动回到共享计数（故障期间的本机计数不并回共享状态，到期后清理）。
// 降级期间多副本各自计数，实际上限相当于放宽到「副本数 × limit」：这是有意接受的取舍，宁可放宽也不完全失效

const rateLimitKeyPrefix = "rate_limit:"

// AllowRequest 固定窗口限流：窗口内同一 key 的第 limit+1 次及之后的请求返回 false；共享状态不可用时按本机计数限流
func AllowRequest(key string, limit int, window time.Duration) bool {
	return IncrCounter(rateLimitKeyPrefix+key, window) <= int64(limit)
}

// IncrCounter 固定窗口计数加一并返回当前值（key 原样使用，不加前缀）：优先使用共享状态，出错时退回本进程内存中的同名计数。
// 用于各种「超过上限就拦截」的计数，不要在共享状态出错时直接放行
func IncrCounter(key string, window time.Duration) int64 {
	count, err := sharedstate.Current().Incr(key, window)
	if err == nil {
		return count
	}
	warnLocalFallback(err)
	return localCounters.incr(key, window, time.Now())
}

// TooManyFailures 窗口内失败次数是否已达到上限（只读，不计数）；共享状态不可用时读本机计数
func TooManyFailures(key string, limit int) bool {
	key = rateLimitKeyPrefix + key
	value, ok, err := sharedstate.Current().Get(key)
	if err != nil {
		warnLocalFallback(err)
		return localCounters.get(key, time.Now()) >= int64(limit)
	}
	if !ok {
		return false
	}
	count, _ := strconv.Atoi(value)
	return count >= limit
}

// RecordFailure 记录一次失败
func RecordFailure(key string, window time.Duration) {
	IncrCounter(rateLimitKeyPrefix+key, window)
}

// ResetFailures 成功后清空失败计数（本机的降级计数一并清空）
func ResetFailures(key string) {
	key = rateLimitKeyPrefix + key
	localCounters.delete(key)
	if err := sharedstate.Current().Delete(key); err != nil {
		logrus.Warnf("reset failures %s: %v", key, err)
	}
}

// ---------- 本机降级计数 ----------

const (
	localCounterMaxKeys       = 100000      // 本机计数的键数上限：满时先清理过期项，仍满则随意淘汰
	localCounterSweepInterval = time.Minute // 过期项的定期清理间隔（在计数时顺带进行）
	localFallbackWarnInterval = time.Minute // 降级告警的日志间隔
)

type localCounter struct {
	count    int64
	expireAt time.Time // 零值表示不过期
}

func (c localCounter) expired(now time.Time) bool {
	return !c.expireAt.IsZero() && !now.Before(c.expireAt)
}

// localCounterSet 共享状态不可用时的进程内计数，语义与 sharedstate.Store.Incr 相同（固定窗口，期间再自增不延长）
type localCounterSet struct {
	mu        sync.Mutex
	items     map[string]localCounter
	lastSweep time.Time
}

var (
	localCounters = &localCounterSet{items: map[string]localCounter{}}
	// lastFallbackWarn 上次输出降级告警的时间（UnixNano），共享状态故障期间每个请求都会走到这里，日志要节流
	lastFallbackWarn atomic.Int64
)

func (s *localCounterSet) incr(key string, window time.Duration, now time.Time) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked(now)
	item, ok := s.items[key]
	if !ok || item.expired(now) {
		if !ok && len(s.items) >= localCounterMaxKeys {
			for k := range s.items {
				delete(s.items, k)
				break
			}
		}
		item = localCounter{}
		if window > 0 {
			item.expireAt = now.Add(window)
		}
	}
	item.count++
	s.items[key] = item
	return item.count
}

func (s *localCounterSet) get(key string, now time.Time) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[key]
	if !ok || item.expired(now) {
		return 0
	}
	return item.count
}

func (s *localCounterSet) delete(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, key)
}

// sweepLocked 每隔一段时间（或键数已满时）删除过期的计数，避免故障期间本机计数无限增长
func (s *localCounterSet) sweepLocked(now time.Time) {
	if now.Sub(s.lastSweep) < localCounterSweepInterval && len(s.items) < localCounterMaxKeys {
		return
	}
	for k, item := range s.items {
		if item.expired(now) {
			delete(s.items, k)
		}
	}
	s.lastSweep = now
}

func warnLocalFallback(err error) {
	now := time.Now().UnixNano()
	last := lastFallbackWarn.Load()
	if now-last < int64(localFallbackWarnInterval) || !lastFallbackWarn.CompareAndSwap(last, now) {
		return
	}
	logrus.Warnf("shared state unavailable, rate limits fall back to per-instance counters: %v", err)
}
