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
	// 取消订阅后不再收到信号（通道不关闭：并发的 publish 往已关闭的通道发送会 panic）；之前没取走的信号先读掉（缓冲为 1）
	select {
	case <-ch:
	default:
	}
	NotificationHub.publish(7)
	select {
	case <-ch:
		t.Fatal("unsubscribed channel should not receive signals")
	case <-time.After(50 * time.Millisecond):
	}
}

// 取消订阅与广播并发执行时不能 panic（以前取消订阅会关闭通道，与解锁后才发送的 publish 交错时往已关闭的通道发送）
func TestNotificationHubUnsubscribeDuringPublish(t *testing.T) {
	sharedstate.UseMemory()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 2000; i++ {
			NotificationHub.publish(11)
		}
	}()
	for i := 0; i < 2000; i++ {
		_, unsubscribe := NotificationHub.Subscribe(11)
		unsubscribe()
	}
	<-done
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
