package service

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 订阅后能收到本实例的广播；取消订阅后关闭通道、不再收到
func TestNotificationHubPublish(t *testing.T) {
	sharedstate.UseMemory()
	ch, unsubscribe := NotificationHub.Subscribe(7)
	NotificationHub.publish(7)
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("subscriber should receive the signal")
	}
	// 另一个用户不会被唤醒
	other, unsubscribeOther := NotificationHub.Subscribe(8)
	NotificationHub.publish(7)
	select {
	case <-other:
		t.Fatal("other user should not be woken up")
	case <-time.After(50 * time.Millisecond):
	}
	unsubscribeOther()
	unsubscribe()
	// 取消订阅后通道被关闭；之前没取走的信号会先被读出（缓冲为 1）
	for range 2 {
		if _, ok := <-ch; !ok {
			return
		}
	}
	t.Fatal("channel should be closed after unsubscribe")
}

// 通道满时不阻塞（多次广播只保留一个待处理信号）
func TestNotificationHubNonBlocking(t *testing.T) {
	sharedstate.UseMemory()
	_, unsubscribe := NotificationHub.Subscribe(9)
	defer unsubscribe()
	for i := 0; i < 5; i++ {
		NotificationHub.publish(9)
	}
}
