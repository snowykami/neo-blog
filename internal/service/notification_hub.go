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
}

// NotificationHub 站内通知的实时推送入口
var NotificationHub = &notificationHub{subscribers: map[uint]map[chan struct{}]struct{}{}}

const notificationChannel = "notification"

// Subscribe 订阅某个用户的通知；返回的通道在每次有新通知时收到一个信号，取消订阅函数必须调用
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
		close(ch)
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

// Notify 通知某个用户有新通知：本实例立即唤醒，其他实例通过共享状态广播
func (h *notificationHub) Notify(userID uint) {
	h.publish(userID)
	sharedstate.Notify(notificationChannel, strconv.FormatUint(uint64(userID), 10))
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
