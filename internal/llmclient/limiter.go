// Package llmclient 提供全站共用的 OpenAI 兼容模型客户端、识图与思考参数降级辅助、流式解析及跨实例并发限制器。
package llmclient

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
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
// PriorityTier 定义请求在全局并发名额池中的抢占优先级。
type PriorityTier int

const (
	TierBackground  PriorityTier = iota // 后台批量任务（分段标注/翻译、精灵图、摘要）
	TierFirstScreen                     // 首屏优先任务（歌词标注 plan、歌词翻译首屏段）
	TierInteractive                     // 交互式高优请求（写作、评论翻译；多并发时独占 0 号位）
)

type heldSlot struct {
	lease    *sharedstate.Lease
	reserved bool // 是否为 limit > 1 时专留给交互式请求的 0 号名额
}

type Limiter struct {
	Name string // 名额的键前缀；为空时使用随机前缀（测试中各个限制器互不影响）

	initOnce           sync.Once
	nextSlot           atomic.Uint64 // 轮询游标，避免高并发上限（如 100）时每次从头顺序扫描共享状态
	bgTurn             chan struct{} // 同一实例的后台任务依次等待名额，避免同时轮询共享状态
	mu                 sync.Mutex
	priorityWaiting    int           // 本实例正在等待的交互式请求数
	firstScreenWaiting int           // 本实例正在等待的首屏优先请求数
	wake               chan struct{} // 有名额释放时关闭，唤醒所有等待者重新竞争
	held               []heldSlot    // 本实例持有的名额（获取失败而放行时 lease 为 nil 占位）
}

// DefaultLimiter 全局共用的模型调用限制器
var DefaultLimiter = &Limiter{Name: "ai_call"}

var totalQueued atomic.Int64

// QueuedTasks 本实例当前正在排队等待并发名额的 AI 任务数
func QueuedTasks() int64 {
	return totalQueued.Load()
}

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

// Acquire 获取名额；priority 为 true 映射为 TierInteractive，false 映射为 TierBackground。
// 首次需要等待时调用 onWait（可为 nil），ctx 取消时放弃等待并返回错误。
func (l *Limiter) Acquire(ctx context.Context, limit func() int, priority bool, onWait func()) error {
	tier := TierBackground
	if priority {
		tier = TierInteractive
	}
	return l.AcquireTier(ctx, limit, tier, onWait)
}

// AcquireTier 按三级优先级获取全局名额：TierInteractive > TierFirstScreen > TierBackground。
func (l *Limiter) AcquireTier(ctx context.Context, limit func() int, tier PriorityTier, onWait func()) error {
	l.init()
	queued := false
	markQueued := func() {
		if !queued {
			queued = true
			totalQueued.Add(1)
		}
	}
	defer func() {
		if queued {
			totalQueued.Add(-1)
		}
	}()
	if tier == TierBackground {
		select {
		case l.bgTurn <- struct{}{}:
		default:
			markQueued()
			select {
			case l.bgTurn <- struct{}{}:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		defer func() { <-l.bgTurn }()
	}
	waiting := false
	defer func() {
		if waiting && (tier == TierInteractive || tier == TierFirstScreen) {
			l.mu.Lock()
			if tier == TierInteractive {
				l.priorityWaiting--
			} else {
				l.firstScreenWaiting--
			}
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
		yield := (tier == TierBackground && (l.priorityWaiting > 0 || l.firstScreenWaiting > 0)) ||
			(tier == TierFirstScreen && l.priorityWaiting > 0)
		l.mu.Unlock()
		if !yield {
			lease, reserved, err := l.trySlot(limit(), tier)
			if err != nil || lease != nil {
				if err != nil {
					// 共享状态不可用时放行，不让调用方无限等待
					logrus.Warnf("ai limiter unavailable, allowing call: %v", err)
				}
				l.mu.Lock()
				l.held = append(l.held, heldSlot{lease: lease, reserved: reserved})
				l.mu.Unlock()
				return nil
			}
		}
		if !waiting {
			waiting = true
			markQueued()
			if tier == TierInteractive || tier == TierFirstScreen {
				l.mu.Lock()
				if tier == TierInteractive {
					l.priorityWaiting++
				} else {
					l.firstScreenWaiting++
				}
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

func (l *Limiter) trySlot(limit int, tier PriorityTier) (*sharedstate.Lease, bool, error) {
	limit = max(limit, 1)
	if limit == 1 {
		lease, err := sharedstate.AcquireLease(fmt.Sprintf("%s:slot:0", l.Name), slotTTL)
		return lease, false, err
	}
	// 上限大于 1 时先按轮询游标探测公共名额 [1, limit)，避免高并发上限下每次从 1 顺序扫描；
	// 第 0 个名额专留给交互式请求，公共名额全满时再由交互式请求使用
	generalCount := limit - 1
	start := int((l.nextSlot.Add(1) - 1) % uint64(generalCount))
	for step := range generalCount {
		slot := 1 + (start+step)%generalCount
		lease, err := sharedstate.AcquireLease(fmt.Sprintf("%s:slot:%d", l.Name, slot), slotTTL)
		if err != nil || lease != nil {
			return lease, false, err
		}
	}
	if tier == TierInteractive {
		lease, err := sharedstate.AcquireLease(fmt.Sprintf("%s:slot:0", l.Name), slotTTL)
		return lease, lease != nil, err
	}
	return nil, false, nil
}

// Release 归还本实例持有的一个名额，并唤醒本实例与其他实例的等待者
func (l *Limiter) Release() {
	l.mu.Lock()
	var lease *sharedstate.Lease
	if n := len(l.held); n > 0 {
		idx := n - 1
		// 同时持有公共名额与 0 号预留名额时优先归还公共名额，避免预留位先释放导致等待中的首屏/后台任务无法唤醒复用
		for i := n - 1; i >= 0; i-- {
			if !l.held[i].reserved {
				idx = i
				break
			}
		}
		lease = l.held[idx].lease
		l.held = append(l.held[:idx], l.held[idx+1:]...)
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
