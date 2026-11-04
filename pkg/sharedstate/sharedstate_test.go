package sharedstate

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// 设置 NEO_TEST_REDIS_URL（如 redis://127.0.0.1:6379/15）时同时在 Redis 上跑一遍；测试会清空所用前缀下的键
func stores(t *testing.T) map[string]func() {
	t.Helper()
	list := map[string]func(){"memory": UseMemory}
	if url := os.Getenv("NEO_TEST_REDIS_URL"); url != "" {
		list["redis"] = func() {
			prefix := "neo-blog-test:" + randomToken()[:8] + ":"
			if err := Init(url, prefix); err != nil {
				t.Fatalf("init redis: %v", err)
			}
		}
	}
	t.Cleanup(UseMemory)
	return list
}

func TestStoreContract(t *testing.T) {
	for name, use := range stores(t) {
		t.Run(name, func(t *testing.T) {
			use()
			s := Current()

			if _, ok, err := s.Get("missing"); ok || err != nil {
				t.Fatalf("missing key: ok=%v err=%v", ok, err)
			}
			if err := s.Set("a", "1", 0); err != nil {
				t.Fatal(err)
			}
			if v, ok, _ := s.Get("a"); !ok || v != "1" {
				t.Fatalf("get a = %q %v", v, ok)
			}
			many, err := s.GetMany("a", "missing")
			if err != nil || len(many) != 1 || many["a"] != "1" {
				t.Fatalf("get many = %v %v", many, err)
			}

			// 过期
			if err := s.Set("short", "x", 50*time.Millisecond); err != nil {
				t.Fatal(err)
			}
			time.Sleep(120 * time.Millisecond)
			if _, ok, _ := s.Get("short"); ok {
				t.Fatalf("short should expire")
			}

			// SetNX
			if ok, _ := s.SetNX("nx", "first", time.Minute); !ok {
				t.Fatalf("first SetNX should succeed")
			}
			if ok, _ := s.SetNX("nx", "second", time.Minute); ok {
				t.Fatalf("second SetNX should fail")
			}

			// Take 只能取一次
			if v, ok, _ := s.Take("nx"); !ok || v != "first" {
				t.Fatalf("take = %q %v", v, ok)
			}
			if _, ok, _ := s.Take("nx"); ok {
				t.Fatalf("second take should miss")
			}

			// CompareAndDelete
			_ = s.Set("cad", "mine", time.Minute)
			if ok, _ := s.CompareAndDelete("cad", "other"); ok {
				t.Fatalf("compare with wrong value should not delete")
			}
			if ok, _ := s.CompareAndDelete("cad", "mine"); !ok {
				t.Fatalf("compare with right value should delete")
			}

			// Incr 固定窗口
			for i := int64(1); i <= 3; i++ {
				if n, err := s.Incr("counter", 80*time.Millisecond); err != nil || n != i {
					t.Fatalf("incr #%d = %d %v", i, n, err)
				}
			}
			time.Sleep(150 * time.Millisecond)
			if n, _ := s.Incr("counter", time.Minute); n != 1 {
				t.Fatalf("counter should restart after window, got %d", n)
			}

			_ = s.Delete("a", "counter")
			if _, ok, _ := s.Get("a"); ok {
				t.Fatalf("a should be deleted")
			}

			// GetByPrefix：只返回该前缀下未过期的键，前缀中的通配符按字面匹配
			_ = s.Set("snap:a", "1", time.Minute)
			_ = s.Set("snap:b", "2", 0)
			_ = s.Set("snap:gone", "x", 50*time.Millisecond)
			_ = s.Set("snapshot", "no", time.Minute)
			_ = s.Set("glob*:x", "literal", time.Minute)
			_ = s.Set("globber:x", "other", time.Minute)
			time.Sleep(120 * time.Millisecond)
			if got, err := s.GetByPrefix("snap:"); err != nil || len(got) != 2 || got["snap:a"] != "1" || got["snap:b"] != "2" {
				t.Fatalf("get by prefix = %v %v", got, err)
			}
			if got, err := s.GetByPrefix("glob*:"); err != nil || len(got) != 1 || got["glob*:x"] != "literal" {
				t.Fatalf("glob prefix = %v %v", got, err)
			}
			if got, err := s.GetByPrefix("nothing:"); err != nil || len(got) != 0 {
				t.Fatalf("empty prefix = %v %v", got, err)
			}

			// JSON
			type payload struct{ Name string }
			if err := SetJSON("json", payload{Name: "neo"}, time.Minute); err != nil {
				t.Fatal(err)
			}
			var got payload
			if ok, err := TakeJSON("json", &got); !ok || err != nil || got.Name != "neo" {
				t.Fatalf("take json = %+v %v %v", got, ok, err)
			}
		})
	}
}

func TestLocksAndRounds(t *testing.T) {
	for name, use := range stores(t) {
		t.Run(name, func(t *testing.T) {
			use()
			release, ok, err := TryLock("job", time.Minute)
			if !ok || err != nil {
				t.Fatalf("first lock: %v %v", ok, err)
			}
			if _, ok, _ := TryLock("job", time.Minute); ok {
				t.Fatalf("lock should be held")
			}
			// 等待锁：持有者释放后获取成功
			go func() {
				time.Sleep(100 * time.Millisecond)
				release()
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			release2, err := Lock(ctx, "job", time.Minute)
			if err != nil {
				t.Fatalf("lock should be acquired after release: %v", err)
			}
			release2()

			// 等待超时
			hold, _, _ := TryLock("busy", time.Minute)
			defer hold()
			short, cancelShort := context.WithTimeout(context.Background(), 120*time.Millisecond)
			defer cancelShort()
			if _, err := Lock(short, "busy", time.Minute); err == nil {
				t.Fatalf("lock on busy key should time out")
			}

			if !ClaimRound("heat", time.Minute) || ClaimRound("heat", time.Minute) {
				t.Fatalf("a round should be claimed exactly once")
			}
		})
	}
}

func TestNotifyAcrossInstances(t *testing.T) {
	url := os.Getenv("NEO_TEST_REDIS_URL")
	if url == "" {
		t.Skip("NEO_TEST_REDIS_URL not set")
	}
	prefix := "neo-blog-test:" + randomToken()[:8] + ":"
	if err := Init(url, prefix); err != nil {
		t.Fatalf("init redis: %v", err)
	}
	t.Cleanup(UseMemory)

	got := make(chan string, 4)
	OnNotify("test_channel", func(message string) { got <- message })
	time.Sleep(100 * time.Millisecond) // 等订阅生效

	// 本实例发出的消息不回传给自己
	Notify("test_channel", "self")
	// 模拟其他实例发出的消息
	if err := Current().Publish("test_channel", "other-instance|hello"); err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-got:
		if message != "hello" {
			t.Fatalf("got %q, want message from the other instance only", message)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("notification not received")
	}
}

// TestInitInvalidRedisURL 地址格式错误时直接报错，且错误信息不带出密码
func TestInitInvalidRedisURL(t *testing.T) {
	t.Cleanup(UseMemory)
	for _, url := range []string{
		"redis://:s3cret@127.0.0.1:abc/0",
		"http://:s3cret@127.0.0.1:6379/0",
	} {
		err := Init(url, "")
		if err == nil {
			t.Fatalf("Init(%q) succeeded, want error", url)
		}
		if strings.Contains(err.Error(), "s3cret") {
			t.Errorf("Init(%q) error leaks password: %v", url, err)
		}
		if Shared() {
			t.Errorf("Init(%q) failed but switched to redis", url)
		}
	}
}
