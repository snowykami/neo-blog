package cache

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 设置 NEO_TEST_REDIS_URL（如 redis://127.0.0.1:6379/15）时同时在 Redis 上跑一遍（两级缓存）
func tieredStores(t *testing.T) map[string]func() {
	t.Helper()
	list := map[string]func(){"memory": sharedstate.UseMemory}
	if url := os.Getenv("NEO_TEST_REDIS_URL"); url != "" {
		list["redis"] = func() {
			prefix := fmt.Sprintf("neo-blog-test:%d:", time.Now().UnixNano())
			if err := sharedstate.Init(url, prefix); err != nil {
				t.Fatalf("init redis: %v", err)
			}
		}
	}
	t.Cleanup(sharedstate.UseMemory)
	return list
}

func TestTieredGetSetDelete(t *testing.T) {
	for name, use := range tieredStores(t) {
		t.Run(name, func(t *testing.T) {
			use()
			c := NewTiered("test-basic-"+name, 10, 1<<20)
			if _, ok := c.Get("a"); ok {
				t.Fatal("empty cache hit")
			}
			c.Set("a", []byte("1"), time.Minute)
			if v, ok := c.Get("a"); !ok || string(v) != "1" {
				t.Fatalf("get a = %q %v", v, ok)
			}
			c.Set("zero", []byte("x"), 0)
			if _, ok := c.Get("zero"); ok {
				t.Fatal("ttl 0 should not be stored")
			}
			c.Delete("a")
			if _, ok := c.Get("a"); ok {
				t.Fatal("deleted key still present")
			}
		})
	}
}

func TestTieredExpires(t *testing.T) {
	for name, use := range tieredStores(t) {
		t.Run(name, func(t *testing.T) {
			use()
			c := NewTiered("test-expire-"+name, 10, 1<<20)
			c.Set("a", []byte("1"), 50*time.Millisecond)
			time.Sleep(80 * time.Millisecond)
			if _, ok := c.Get("a"); ok {
				t.Fatal("expired key still present")
			}
		})
	}
}

func TestTieredClearInvalidatesNamespace(t *testing.T) {
	for name, use := range tieredStores(t) {
		t.Run(name, func(t *testing.T) {
			use()
			c := NewTiered("test-clear-"+name, 10, 1<<20)
			c.Set("a", []byte("1"), time.Minute)
			c.Clear()
			if _, ok := c.Get("a"); ok {
				t.Fatal("key survived Clear")
			}
			c.Set("a", []byte("2"), time.Minute)
			if v, ok := c.Get("a"); !ok || string(v) != "2" {
				t.Fatalf("get after clear = %q %v", v, ok)
			}
		})
	}
}

func TestTieredL1Limits(t *testing.T) {
	sharedstate.UseMemory()
	c := NewTiered("test-limits", 2, 10)
	c.Set("a", []byte("1234"), time.Minute)
	c.Set("b", []byte("1234"), time.Minute)
	c.Get("a") // a 最近使用，b 先被淘汰
	c.Set("c", []byte("1234"), time.Minute)
	if _, ok := c.Get("b"); ok {
		t.Fatal("least recently used entry not evicted")
	}
	if _, ok := c.Get("a"); !ok {
		t.Fatal("recently used entry evicted")
	}
	c.Set("big", make([]byte, 11), time.Minute)
	if _, ok := c.Get("big"); ok {
		t.Fatal("entry larger than the byte limit should not be cached")
	}
}

// 共享时 L1 丢失后从 L2 读回（模拟另一个实例或本实例重启后）
func TestTieredReadsBackFromL2(t *testing.T) {
	url := os.Getenv("NEO_TEST_REDIS_URL")
	if url == "" {
		t.Skip("NEO_TEST_REDIS_URL not set")
	}
	tieredStores(t)["redis"]()
	c := NewTiered("test-l2", 10, 1<<20)
	SetJSON(c, "song", map[string]int{"id": 1}, time.Minute)
	c.dropLocal("", false)
	got, ok := GetJSON[map[string]int](c, "song")
	if !ok || got["id"] != 1 {
		t.Fatalf("read back from L2 = %v %v", got, ok)
	}
	// 另一个实例清空命名空间：本实例在版本号检查时发现变化
	if _, err := sharedstate.Current().Incr(c.versionKey(), 0); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	c.checkedAt = time.Time{}
	c.mu.Unlock()
	if _, ok := c.Get("song"); ok {
		t.Fatal("stale entry served after another instance cleared the namespace")
	}
}
