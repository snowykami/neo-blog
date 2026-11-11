package utils

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func TestAllowRequest(t *testing.T) {
	key := "test_allow_request"
	for i := 0; i < 3; i++ {
		if !AllowRequest(key, 3, time.Minute) {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if AllowRequest(key, 3, time.Minute) {
		t.Fatalf("4th request should be limited")
	}
}

func TestVerifyEmailCodeAttemptsLimit(t *testing.T) {
	email := "Limit@Test.local"
	code := RequestEmailVerify(email)
	for i := 0; i < emailVerifyMaxAttempts; i++ {
		if VerifyEmailCode(email, "zzzzzz") {
			t.Fatalf("wrong code should fail")
		}
	}
	// 失败次数达到上限后，正确的验证码也已作废
	if VerifyEmailCode(email, code) {
		t.Fatalf("code should be invalidated after too many failures")
	}
	code = RequestEmailVerify(email)
	if !VerifyEmailCode("limit@test.local", code) {
		t.Fatalf("new code should verify (case-insensitive email)")
	}
	if VerifyEmailCode(email, code) {
		t.Fatalf("code should be single-use")
	}
}

// flakyStore 模拟 Redis 故障：fail 为 true 时所有读写都出错，否则交给内层存储
type flakyStore struct {
	sharedstate.Store
	fail atomic.Bool
}

var errStoreDown = errors.New("redis: connection refused")

func (s *flakyStore) Get(key string) (string, bool, error) {
	if s.fail.Load() {
		return "", false, errStoreDown
	}
	return s.Store.Get(key)
}

func (s *flakyStore) Incr(key string, ttl time.Duration) (int64, error) {
	if s.fail.Load() {
		return 0, errStoreDown
	}
	return s.Store.Incr(key, ttl)
}

func (s *flakyStore) Delete(keys ...string) error {
	if s.fail.Load() {
		return errStoreDown
	}
	return s.Store.Delete(keys...)
}

func useFlakyStore(t *testing.T) *flakyStore {
	t.Helper()
	sharedstate.UseMemory()
	store := &flakyStore{Store: sharedstate.Current()}
	sharedstate.UseStore(store)
	t.Cleanup(sharedstate.UseMemory)
	return store
}

// 共享状态出错时按本机计数照样拦截；恢复后回到共享计数
func TestAllowRequestFallsBackToLocalCounter(t *testing.T) {
	store := useFlakyStore(t)
	key := "test_fallback_allow"

	// 正常时用共享计数
	if !AllowRequest(key, 3, time.Minute) {
		t.Fatal("first request should be allowed")
	}
	store.fail.Store(true)
	for i := 0; i < 3; i++ {
		if !AllowRequest(key, 3, time.Minute) {
			t.Fatalf("local request %d should be allowed", i+1)
		}
	}
	if AllowRequest(key, 3, time.Minute) {
		t.Fatal("4th request during outage should be limited by local counter")
	}

	// 恢复后回到共享计数：共享状态里此前只记了 1 次
	store.fail.Store(false)
	if !AllowRequest(key, 3, time.Minute) || !AllowRequest(key, 3, time.Minute) {
		t.Fatal("requests after recovery should use shared counter")
	}
	if AllowRequest(key, 3, time.Minute) {
		t.Fatal("4th request on shared counter should be limited")
	}
	if v, _, _ := sharedstate.Current().Get(rateLimitKeyPrefix + key); v != "4" {
		t.Fatalf("shared count = %q, want 4", v)
	}
}

// 登录失败计数在共享状态出错时同样按本机计数判断，成功后一并清空
func TestFailuresFallBackToLocalCounter(t *testing.T) {
	store := useFlakyStore(t)
	key := "test_fallback_failures"
	store.fail.Store(true)
	for i := 0; i < 3; i++ {
		RecordFailure(key, time.Minute)
	}
	if !TooManyFailures(key, 3) {
		t.Fatal("failures during outage should be counted locally")
	}
	ResetFailures(key)
	if TooManyFailures(key, 3) {
		t.Fatal("reset should clear local counter")
	}
	store.fail.Store(false)
	if TooManyFailures(key, 1) {
		t.Fatal("shared counter should be untouched by outage")
	}
}

// 本机计数按窗口过期，并在清理时删除过期的键
func TestLocalCounterExpiry(t *testing.T) {
	set := &localCounterSet{items: map[string]localCounter{}}
	now := time.Now()
	if set.incr("a", time.Second, now) != 1 || set.incr("a", time.Second, now) != 2 {
		t.Fatal("counter should increase within window")
	}
	later := now.Add(2 * time.Second)
	if set.get("a", later) != 0 || set.incr("a", time.Second, later) != 1 {
		t.Fatal("counter should restart after window")
	}
	set.incr("b", time.Second, later)
	set.incr("c", time.Second, later.Add(localCounterSweepInterval+time.Second))
	if len(set.items) != 1 {
		t.Fatalf("expired keys should be swept, got %d", len(set.items))
	}
}
