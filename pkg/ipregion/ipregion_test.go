package ipregion

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLookup(t *testing.T) {
	cases := map[string]string{
		"222.178.10.1":  "重庆市 电信",
		"113.92.157.29": "广东省 深圳市 电信",
		"1.1.1.1":       "Australia Queensland Brisbane",
		"192.168.1.1":   "局域网",
		"127.0.0.1":     "局域网",
		"::1":           "局域网",
		"fe80::1":       "局域网",
		"not-an-ip":     "",
	}
	for ip, want := range cases {
		if got := Lookup(ip).String(); got != want {
			t.Errorf("Lookup(%q) = %q, want %q", ip, got, want)
		}
	}
}

func TestIPv6OnlineFallbackSingleflightCacheAndShortTimeout(t *testing.T) {
	if v6OnlineHTTPClient.Timeout != 2500*time.Millisecond {
		t.Fatalf("expected v6OnlineHTTPClient timeout 2500ms, got %v", v6OnlineHTTPClient.Timeout)
	}

	origEndpoint := v6OnlineEndpoint
	origClient := v6OnlineHTTPClient
	origNow := v6Now
	origSearcher := v6Searcher
	defer func() {
		v6OnlineEndpoint = origEndpoint
		v6OnlineHTTPClient = origClient
		v6Now = origNow
		v6Searcher = origSearcher
		v6CacheMu.Lock()
		v6Cache = make(map[string]v6CacheEntry)
		v6CacheMu.Unlock()
	}()
	v6Searcher = nil
	v6CacheMu.Lock()
	v6Cache = make(map[string]v6CacheEntry)
	v6CacheMu.Unlock()

	nowMu := sync.Mutex{}
	fakeNow := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	v6Now = func() time.Time {
		nowMu.Lock()
		defer nowMu.Unlock()
		return fakeNow
	}
	advanceTime := func(d time.Duration) {
		nowMu.Lock()
		fakeNow = fakeNow.Add(d)
		nowMu.Unlock()
	}

	var calls atomic.Int32
	var shouldFail atomic.Bool
	var slowDelay atomic.Int64

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if d := time.Duration(slowDelay.Load()); d > 0 {
			time.Sleep(d)
		}
		if shouldFail.Load() {
			http.Error(w, "upstream down", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 200,
			"data": map[string]any{
				"country":     "中国",
				"province":    "北京市",
				"city":        "北京市",
				"isp":         "联通",
				"countryCode": "CN",
			},
		})
	}))
	defer srv.Close()

	v6OnlineEndpoint = srv.URL
	v6OnlineHTTPClient = &http.Client{Timeout: 80 * time.Millisecond}

	// 1. 并发查询同一 IPv6（含不同缩写形式）：singleflight 合并为 1 次请求，且正缓存 1 小时内复用
	slowDelay.Store(int64(25 * time.Millisecond))
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		ip := "2408:8000::1"
		if i%2 == 1 {
			ip = "2408:8000:0:0:0:0:0:1"
		}
		go func(addr string) {
			defer wg.Done()
			if got := Lookup(addr).String(); got != "北京市 联通" {
				t.Errorf("Lookup(%s) = %q, want 北京市 联通", addr, got)
			}
		}(ip)
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("expected singleflight to coalesce 24 concurrent lookups into 1 HTTP call, got %d", calls.Load())
	}

	slowDelay.Store(0)
	advanceTime(30 * time.Minute)
	if got := Lookup("2408:8000::1").String(); got != "北京市 联通" || calls.Load() != 1 {
		t.Fatalf("expected 1h positive cache hit at +30m, got %q calls=%d", got, calls.Load())
	}

	// 2. 失败与超时进入 2 分钟负缓存，期间重复请求不继续阻塞外网
	shouldFail.Store(true)
	if got := Lookup("2409:8000::2").String(); got != "" {
		t.Fatalf("expected empty region on failure, got %q", got)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 total calls, got %d", calls.Load())
	}
	shouldFail.Store(false)
	advanceTime(time.Minute) // 仍在 2m 负缓存有效期内
	if got := Lookup("2409:8000::2").String(); got != "" || calls.Load() != 2 {
		t.Fatalf("expected negative cache hit at +1m, got %q calls=%d", got, calls.Load())
	}
	advanceTime(2 * time.Minute) // 超过 2m 负缓存后恢复查询成功
	if got := Lookup("2409:8000::2").String(); got != "北京市 联通" || calls.Load() != 3 {
		t.Fatalf("expected recovery after negative TTL expiry, got %q calls=%d", got, calls.Load())
	}

	// 3. 慢外网超过客户端短超时立即中断并写入负缓存
	slowDelay.Store(int64(200 * time.Millisecond))
	start := time.Now()
	if got := Lookup("240e:8000::3").String(); got != "" {
		t.Fatalf("expected timeout to return empty region, got %q", got)
	}
	if elapsed := time.Since(start); elapsed > 180*time.Millisecond {
		t.Fatalf("expected short timeout to abort quickly, took %v", elapsed)
	}
}
