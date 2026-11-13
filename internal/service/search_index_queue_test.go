package service

import (
	"context"
	"runtime"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSearchSyncQueuePostCoalescingAndDrain(t *testing.T) {
	q := newSearchSyncQueue(16, 1)

	blockFirst := make(chan struct{})
	firstStarted := make(chan struct{})

	var mu sync.Mutex
	type callRecord struct {
		postID       uint
		syncComments bool
		authorIDs    []uint
	}
	var calls []callRecord

	q.execPost = func(postID uint, syncComments bool, authorIDs []uint) {
		if postID == 1 {
			close(firstStarted)
			<-blockFirst
		}
		mu.Lock()
		calls = append(calls, callRecord{
			postID:       postID,
			syncComments: syncComments,
			authorIDs:    slices.Clone(authorIDs),
		})
		mu.Unlock()
	}

	// post 1 先占住唯一的 worker
	q.enqueuePost(1, 0, false)
	<-firstStarted

	// 同一篇 post 42 连续触发多次编辑、评论与作者变更，应合并为队列中的唯一一条待执行任务
	for i := 0; i < 20; i++ {
		q.enqueuePost(42, 0, false)
	}
	q.enqueuePost(42, 7, false)
	q.enqueuePost(42, 9, true)
	q.enqueuePost(42, 7, false)

	close(blockFirst)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := q.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown queue failed: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 2 {
		t.Fatalf("expected 2 post sync executions (post 1 + coalesced post 42), got %d: %+v", len(calls), calls)
	}
	got := calls[1]
	if got.postID != 42 || !got.syncComments || !slices.Equal(got.authorIDs, []uint{7, 9}) {
		t.Fatalf("unexpected coalesced execution: %+v", got)
	}
}

func TestSearchSyncQueueFullNonBlockingAndRestartable(t *testing.T) {
	before := runtime.NumGoroutine()
	q := newSearchSyncQueue(2, 1)

	block := make(chan struct{})
	started := make(chan struct{})
	var executed atomic.Int32

	q.execPost = func(postID uint, _ bool, _ []uint) {
		if postID == 1 {
			close(started)
			<-block
		}
		executed.Add(1)
	}

	// post 1 进入 worker 阻塞，随后填满容量为 2 的缓冲通道（post 2、post 3）
	q.enqueuePost(1, 0, false)
	<-started
	q.enqueuePost(2, 0, false)
	q.enqueuePost(3, 0, false)

	// 超出容量时不应阻塞主调用链路
	done := make(chan struct{})
	go func() {
		for id := uint(4); id <= 20; id++ {
			q.enqueuePost(id, 0, false)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("enqueuePost blocked when queue was full")
	}

	close(block)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := q.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown failed: %v", err)
	}
	if executed.Load() != 3 {
		t.Fatalf("expected 3 executed tasks (1 running + 2 buffered), got %d", executed.Load())
	}

	// Shutdown 后再次入队可正常拉起并再次排空，无协程泄漏
	q.enqueuePost(99, 0, false)
	if err := q.Shutdown(ctx); err != nil {
		t.Fatalf("second shutdown failed: %v", err)
	}
	if executed.Load() != 4 {
		t.Fatalf("expected 4 executed tasks after restart, got %d", executed.Load())
	}

	time.Sleep(30 * time.Millisecond)
	if after := runtime.NumGoroutine(); after > before+2 {
		t.Fatalf("unexpected goroutine growth: before=%d after=%d", before, after)
	}
}
