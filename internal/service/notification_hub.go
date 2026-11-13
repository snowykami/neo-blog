package service

import (
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// notificationHub 本实例内的通知订阅者：新通知写入后立刻唤醒该用户的 SSE 连接。
// 跨实例靠 sharedstate 的通知通道：任一实例写入都会广播 userID，再各自唤醒本地连接
type notificationHub struct {
	mu          sync.Mutex
	subscribers map[uint]map[chan struct{}]struct{}
	shutdown    chan struct{}
	closeOnce   sync.Once
}

// NotificationHub 站内通知的实时推送入口
var NotificationHub = &notificationHub{
	subscribers: map[uint]map[chan struct{}]struct{}{},
	shutdown:    make(chan struct{}),
}

// Done 实例开始关停时关闭，SSE 通知流据此主动断开重连到新实例
func (h *notificationHub) Done() <-chan struct{} {
	return h.shutdown
}

// CloseNotificationStreams 关停前结束本实例上的所有通知 SSE 长连接
func CloseNotificationStreams() {
	NotificationHub.closeOnce.Do(func() {
		close(NotificationHub.shutdown)
	})
}

const (
	notificationChannel = "notification"
	notificationSeqTTL  = 24 * time.Hour
)

func notifySeqKey(userID uint) string {
	return fmt.Sprintf("notify:seq:%d", userID)
}

// CurrentSeq 读取用户当前的通知事件序号（未写入过时为 0）
func (h *notificationHub) CurrentSeq(userID uint) int64 {
	if userID == 0 {
		return 0
	}
	raw, ok, err := sharedstate.Current().Get(notifySeqKey(userID))
	if err != nil || !ok || raw == "" {
		return 0
	}
	seq, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return seq
}

// Subscribe 订阅某个用户的通知；返回的通道在每次有新通知时收到一个信号，取消订阅函数必须调用。
// 取消订阅只从订阅表里移除、不关闭通道：publish 解锁后才逐个发送，期间关闭的通道会让发送 panic；
// 订阅方靠写入失败、心跳或到期退出，不依赖通道关闭，没人引用的通道由 GC 回收
func (h *notificationHub) Subscribe(userID uint) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	if h.subscribers[userID] == nil {
		h.subscribers[userID] = map[chan struct{}]struct{}{}
	}
	h.subscribers[userID][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		if set, ok := h.subscribers[userID]; ok {
			delete(set, ch)
			if len(set) == 0 {
				delete(h.subscribers, userID)
			}
		}
		h.mu.Unlock()
	}
}

// publish 唤醒本实例上该用户的全部连接；通道满时说明已经待处理，丢掉这次信号即可
func (h *notificationHub) publish(userID uint) {
	h.mu.Lock()
	channels := make([]chan struct{}, 0, len(h.subscribers[userID]))
	for ch := range h.subscribers[userID] {
		channels = append(channels, ch)
	}
	h.mu.Unlock()
	for _, ch := range channels {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// publishAll 唤醒本实例上的全部连接：与 Redis 的订阅中断后可能错过了任意用户的通知，只能全部刷新一次
func (h *notificationHub) publishAll() {
	h.mu.Lock()
	channels := make([]chan struct{}, 0, len(h.subscribers))
	for _, set := range h.subscribers {
		for ch := range set {
			channels = append(channels, ch)
		}
	}
	h.mu.Unlock()
	for _, ch := range channels {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// Notify 通知某个用户有新通知：递增单调序号，本实例立即唤醒，其他实例通过共享状态广播
func (h *notificationHub) Notify(userID uint) {
	if userID > 0 {
		_, _ = sharedstate.Current().Incr(notifySeqKey(userID), notificationSeqTTL)
	}
	h.publish(userID)
	sharedstate.Notify(notificationChannel, strconv.FormatUint(uint64(userID), 10))
}

// notifyNotificationUsers 通知变化（新增、删除、已读）后唤醒这些用户的实时连接：每人推一次最新的未读状态，
// 徽标与其他标签页随之同步。必须在事务提交后调用
func notifyNotificationUsers(userIDs []uint) {
	seen := make(map[uint]bool, len(userIDs))
	for _, userID := range userIDs {
		if userID == 0 || seen[userID] {
			continue
		}
		seen[userID] = true
		NotificationHub.Notify(userID)
	}
}

// NotificationStreamMaxPerUser 每个用户同时保持的 SSE 连接上限（跨实例合计）：多开几个标签页够用，
// 又不至于让一个账号占满服务端的长连接
const NotificationStreamMaxPerUser = 5

// notificationStreamSlotTTL 连接名额的租约有效期：连接存活期间自动续期，实例崩溃后最多这么久自动释放
const notificationStreamSlotTTL = time.Minute

// AcquireStreamSlot 为一条 SSE 连接占一个名额：名额是共享状态里的 N 个租约键，跨实例可见；
// 连接结束时必须调用返回的释放函数。名额已满时 ok 为 false
func (h *notificationHub) AcquireStreamSlot(userID uint) (release func(), ok bool, err error) {
	for slot := 0; slot < NotificationStreamMaxPerUser; slot++ {
		lease, err := sharedstate.AcquireLease(fmt.Sprintf("notification_stream:%d:%d", userID, slot), notificationStreamSlotTTL)
		if err != nil {
			return func() {}, false, err
		}
		if lease != nil {
			return lease.Release, true, nil
		}
	}
	return func() {}, false, nil
}

// StartNotificationHub 订阅其他实例的通知广播。连接重建时会收到空消息，表示期间可能错过了通知：
// 唤醒本实例的全部连接各自重新推一次当前状态（AGENTS.md：收到空消息需全量刷新）
func StartNotificationHub() {
	sharedstate.OnNotify(notificationChannel, func(message string) {
		if message == "" {
			NotificationHub.publishAll()
			return
		}
		userID, err := strconv.ParseUint(message, 10, 64)
		if err != nil {
			logrus.Warnf("notification hub: bad message %q", message)
			return
		}
		NotificationHub.publish(uint(userID))
	})
}
