// Package llmclient 提供全站共用的 OpenAI 兼容模型客户端、识图与思考参数降级辅助、流式解析及跨实例并发限制器。
package llmclient

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const (
	slotTTL        = 45 * time.Second // 名额租约，持有期间自动续期
	slotPoll       = time.Second      // 等待名额时的轮询间隔（其他实例释放名额时也会通知）
	limiterChannel = "ai_limiter_release:"
)

// Limiter 限制同时调用模型的请求数（AI 摘要、AI 写作、评论翻译、歌词标注共用），上限每次获取时读取，修改配置后立即生效。
// 名额是共享状态中的租约（多副本时在 Redis），所有实例合计不超过上限；持有名额的实例退出后，名额最多 slotTTL 后自动释放。
// 交互式请求（AI 写作、评论翻译）以优先级获取：上限大于 1 时第 0 个名额只留给它们；本实例有优先请求在等待时，后台任务让出名额。
type Limiter struct {
	Name string // 名额的键前缀；为空时使用随机前缀（测试中各个限制器互不影响）

	initOnce        sync.Once
	bgTurn          chan struct{} // 同一实例的后台任务依次等待名额，避免同时轮询共享状态
	mu              sync.Mutex
	priorityWaiting int                  // 本实例正在等待的优先请求数
	wake            chan struct{}        // 有名额释放时关闭，唤醒所有等待者重新竞争
	held            []*sharedstate.Lease // 本实例持有的名额（获取失败而放行时为 nil 占位）
}

// DefaultLimiter 全局共用的模型调用限制器
var DefaultLimiter = &Limiter{Name: "ai_call"}

func (l *Limiter) init() {
	l.initOnce.Do(func() {
		if l.Name == "" {
			l.Name = "ai_limiter_" + utils.Strings.GenerateRandomString(8)
		}
		l.bgTurn = make(chan struct{}, 1)
		sharedstate.OnNotify(limiterChannel+l.Name, func(string) {
			l.mu.Lock()
			l.broadcastLocked()
			l.mu.Unlock()
		})
	})
}

// Acquire 获取名额；首次需要等待时调用 onWait（可为 nil），ctx 取消时放弃等待并返回错误
func (l *Limiter) Acquire(ctx context.Context, limit func() int, priority bool, onWait func()) error {
	l.init()
	if !priority {
		select {
		case l.bgTurn <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
		defer func() { <-l.bgTurn }()
	}
	waiting := false
	defer func() {
		if waiting && priority {
			l.mu.Lock()
			l.priorityWaiting--
			l.broadcastLocked()
			l.mu.Unlock()
		}
	}()
	for {
		// 先取唤醒通道再尝试，尝试期间发生的释放也能唤醒本轮等待
		l.mu.Lock()
		if l.wake == nil {
			l.wake = make(chan struct{})
		}
		wake := l.wake
		yield := !priority && l.priorityWaiting > 0
		l.mu.Unlock()
		if !yield {
			lease, err := l.trySlot(limit(), priority)
			if err != nil || lease != nil {
				if err != nil {
					// 共享状态不可用时放行，不让调用方无限等待
					logrus.Warnf("ai limiter unavailable, allowing call: %v", err)
				}
				l.mu.Lock()
				l.held = append(l.held, lease)
				l.mu.Unlock()
				return nil
			}
		}
		if !waiting {
			waiting = true
			if priority {
				l.mu.Lock()
				l.priorityWaiting++
				l.mu.Unlock()
			}
			if onWait != nil {
				onWait()
			}
		}
		select {
		case <-wake:
		case <-time.After(slotPoll):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (l *Limiter) trySlot(limit int, priority bool) (*sharedstate.Lease, error) {
	limit = max(limit, 1)
	first := 0
	if !priority && limit > 1 {
		first = 1 // 第 0 个名额留给交互式请求
	}
	for i := first; i < limit; i++ {
		lease, err := sharedstate.AcquireLease(fmt.Sprintf("%s:slot:%d", l.Name, i), slotTTL)
		if err != nil || lease != nil {
			return lease, err
		}
	}
	return nil, nil
}

// Release 归还本实例持有的一个名额，并唤醒本实例与其他实例的等待者
func (l *Limiter) Release() {
	l.mu.Lock()
	var lease *sharedstate.Lease
	if n := len(l.held); n > 0 {
		lease, l.held = l.held[n-1], l.held[:n-1]
	}
	l.mu.Unlock()
	if lease != nil {
		lease.Release()
		sharedstate.Notify(limiterChannel+l.Name, "")
	}
	l.mu.Lock()
	l.broadcastLocked()
	l.mu.Unlock()
}

func (l *Limiter) broadcastLocked() {
	if l.wake != nil {
		close(l.wake)
		l.wake = nil
	}
}
