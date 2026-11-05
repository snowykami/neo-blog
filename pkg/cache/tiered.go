package cache

import (
	"container/list"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// Tiered 两级缓存：L1 为本实例内存中的 LRU（按条数与字节数限制，条目带过期时间），
// L2 为共享状态（配置 REDIS_URL 时为 Redis：各实例共用，实例重启、滚动更新后仍在；未配置时只有 L1，与单实例的内存缓存相同）。
//
// 值为字节串，序列化由调用方负责（或用 GetJSON / SetJSON）。写入与删除会通知其他实例丢弃各自 L1 里的旧值；
// Clear 通过版本号让整个命名空间失效（适合「写入相关数据后整组作废」的查询缓存），不需要逐个删除 L2 的键，旧键按过期时间自然淘汰。
// 共享状态出错（Redis 暂时不可用）时按未命中处理，不影响请求
type Tiered struct {
	name     string
	maxItems int
	maxBytes int64
	// localTTL 共享时 L1 条目最多保留的时间（见 WithLocalTTL）
	localTTL time.Duration

	mu      sync.Mutex
	items   map[string]*list.Element
	order   *list.List
	bytes   int64
	version int64
	// checkedAt 上次从 L2 读取版本号的时间：通知丢失时最多 versionCheckEvery 后发现版本变化
	checkedAt time.Time
}

type tieredEntry struct {
	key       string
	value     []byte
	expiresAt time.Time
}

const (
	// tieredEvictChannel 其他实例写入或删除了某个键（消息为「命名空间\x00键」），或整个命名空间失效（消息为「命名空间」）
	tieredEvictChannel = "cache_evict"
	versionCheckEvery  = 5 * time.Second
)

var (
	tieredMu       sync.RWMutex
	tieredRegistry = map[string]*Tiered{}
	listenOnce     sync.Once
)

// NewTiered 创建名为 name 的两级缓存（name 在进程内唯一，作为 L2 键的前缀）；maxItems、maxBytes 为 L1 的上限
func NewTiered(name string, maxItems int, maxBytes int64) *Tiered {
	if maxItems <= 0 {
		maxItems = 1000
	}
	if maxBytes <= 0 {
		maxBytes = 16 << 20
	}
	t := &Tiered{name: name, maxItems: maxItems, maxBytes: maxBytes, localTTL: l1RefillTTL, items: map[string]*list.Element{}, order: list.New()}
	tieredMu.Lock()
	tieredRegistry[name] = t
	tieredMu.Unlock()
	listenOnce.Do(listenTieredEvictions)
	return t
}

// listenTieredEvictions 订阅其他实例的失效通知；空消息表示可能错过了通知，清空所有 L1
func listenTieredEvictions() {
	sharedstate.OnNotify(tieredEvictChannel, func(message string) {
		name, key, single := strings.Cut(message, "\x00")
		tieredMu.RLock()
		defer tieredMu.RUnlock()
		if message == "" {
			for _, t := range tieredRegistry {
				t.dropLocal("", false)
			}
			return
		}
		if t, ok := tieredRegistry[name]; ok {
			t.dropLocal(key, single)
		}
	})
}

func (t *Tiered) l2Key(key string) string {
	return "cache:" + t.name + ":v" + strconv.FormatInt(t.currentVersion(), 10) + ":" + key
}

func (t *Tiered) versionKey() string {
	return "cache:" + t.name + ":version"
}

// currentVersion 命名空间当前的版本号：只在共享时从 L2 读取，并按 versionCheckEvery 节流
func (t *Tiered) currentVersion() int64 {
	t.mu.Lock()
	if !sharedstate.Shared() || time.Since(t.checkedAt) < versionCheckEvery {
		v := t.version
		t.mu.Unlock()
		return v
	}
	t.checkedAt = time.Now()
	t.mu.Unlock()
	raw, ok, err := sharedstate.Current().Get(t.versionKey())
	if err != nil {
		return t.localVersion()
	}
	v := int64(0)
	if ok {
		v, _ = strconv.ParseInt(raw, 10, 64)
	}
	t.mu.Lock()
	if v != t.version {
		t.version = v
		t.clearLocked()
	}
	t.mu.Unlock()
	return v
}

func (t *Tiered) localVersion() int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.version
}

// Get 读取：先查 L1，未命中再查 L2（命中时回填 L1）
func (t *Tiered) Get(key string) ([]byte, bool) {
	version := t.currentVersion()
	if value, ok := t.getLocal(key); ok {
		return value, true
	}
	if !sharedstate.Shared() {
		return nil, false
	}
	l2Key := "cache:" + t.name + ":v" + strconv.FormatInt(version, 10) + ":" + key
	raw, ok, err := sharedstate.Current().Get(l2Key)
	if err != nil {
		logrus.Debugf("cache %s: read %s failed: %v", t.name, key, err)
		return nil, false
	}
	if !ok {
		return nil, false
	}
	t.setLocal(key, []byte(raw), t.localTTL)
	return []byte(raw), true
}

const (
	// l1RefillTTL 从 L2 回填到 L1 的条目保留的时间（L2 不返回剩余时间）
	l1RefillTTL = time.Minute
	// l1MaxTTL 共享时本实例写入的条目在 L1 最多保留的时间：其他实例更新了同一个键而通知丢失时，最多这么久后改读 L2 的新值
	l1MaxTTL = 10 * time.Minute
)

// Set 写入两级缓存，ttl 为有效期（必须大于 0）；并通知其他实例丢弃 L1 里的旧值
func (t *Tiered) Set(key string, value []byte, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	if !sharedstate.Shared() {
		t.setLocal(key, value, ttl)
		return
	}
	t.setLocal(key, value, min(ttl, l1MaxTTL, t.localTTL*10))
	if err := sharedstate.Current().Set(t.l2Key(key), string(value), ttl); err != nil {
		logrus.Debugf("cache %s: write %s failed: %v", t.name, key, err)
		return
	}
	sharedstate.Notify(tieredEvictChannel, t.name+"\x00"+key)
}

// Delete 从两级缓存中删除，并通知其他实例
func (t *Tiered) Delete(key string) {
	t.dropLocal(key, true)
	if !sharedstate.Shared() {
		return
	}
	if err := sharedstate.Current().Delete(t.l2Key(key)); err != nil {
		logrus.Debugf("cache %s: delete %s failed: %v", t.name, key, err)
	}
	sharedstate.Notify(tieredEvictChannel, t.name+"\x00"+key)
}

// Clear 让整个命名空间失效：版本号加一（旧版本的 L2 键不再被读取，按过期时间淘汰），并通知其他实例清空 L1
func (t *Tiered) Clear() {
	t.mu.Lock()
	t.version++
	t.clearLocked()
	t.mu.Unlock()
	if !sharedstate.Shared() {
		return
	}
	v, err := sharedstate.Current().Incr(t.versionKey(), 0)
	if err != nil {
		logrus.Debugf("cache %s: bump version failed: %v", t.name, err)
		return
	}
	t.mu.Lock()
	t.version, t.checkedAt = v, time.Now()
	t.mu.Unlock()
	sharedstate.Notify(tieredEvictChannel, t.name)
}

// WithLocalTTL 共享时 L1 条目最多保留 d（默认一分钟；本实例写入的条目还不超过写入时的有效期）。
// 有效期很短的缓存（如几十秒的查询缓存）应设得更短：L2 不返回剩余时间，从 L2 回填的条目在 L1 里可能比 L2 里活得久
func (t *Tiered) WithLocalTTL(d time.Duration) *Tiered {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.localTTL = d
	return t
}

// ResetLocal 只清空本实例的 L1（如切换数据库时，不影响其他实例与 L2）
func (t *Tiered) ResetLocal() {
	t.dropLocal("", false)
}

// GetJSON 读取并反序列化；反序列化失败按未命中处理
func GetJSON[T any](t *Tiered, key string) (T, bool) {
	var value T
	data, ok := t.Get(key)
	if !ok || json.Unmarshal(data, &value) != nil {
		var zero T
		return zero, false
	}
	return value, true
}

// SetJSON 序列化后写入
func SetJSON(t *Tiered, key string, value any, ttl time.Duration) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	t.Set(key, data, ttl)
}

// dropLocal 丢弃 L1 中的一个键；single 为 false 时清空整个 L1（并在下次读取时重新确认版本号）
func (t *Tiered) dropLocal(key string, single bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !single {
		t.clearLocked()
		t.checkedAt = time.Time{}
		return
	}
	if el, ok := t.items[key]; ok {
		t.removeLocked(el)
	}
}

func (t *Tiered) getLocal(key string) ([]byte, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	el, ok := t.items[key]
	if !ok {
		return nil, false
	}
	e := el.Value.(*tieredEntry)
	if time.Now().After(e.expiresAt) {
		t.removeLocked(el)
		return nil, false
	}
	t.order.MoveToFront(el)
	return e.value, true
}

func (t *Tiered) setLocal(key string, value []byte, ttl time.Duration) {
	size := int64(len(value))
	if size > t.maxBytes {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if el, ok := t.items[key]; ok {
		t.removeLocked(el)
	}
	for t.order.Len() > 0 && (t.order.Len() >= t.maxItems || t.bytes+size > t.maxBytes) {
		t.removeLocked(t.order.Back())
	}
	t.items[key] = t.order.PushFront(&tieredEntry{key: key, value: value, expiresAt: time.Now().Add(ttl)})
	t.bytes += size
}

func (t *Tiered) removeLocked(el *list.Element) {
	e := el.Value.(*tieredEntry)
	delete(t.items, e.key)
	t.order.Remove(el)
	t.bytes -= int64(len(e.value))
}

func (t *Tiered) clearLocked() {
	t.items = map[string]*list.Element{}
	t.order.Init()
	t.bytes = 0
}

// IDCache 以无符号整数为键的两级缓存：接口与进程内的 LRUCache 相同，写入时多传有效期
type IDCache struct{ *Tiered }

// NewIDCache 创建名为 name 的两级缓存，maxItems、maxBytes 为 L1 的上限
func NewIDCache(name string, maxItems int, maxBytes int64) IDCache {
	return IDCache{NewTiered(name, maxItems, maxBytes)}
}

func (c IDCache) Get(id uint) ([]byte, bool) {
	return c.Tiered.Get(strconv.FormatUint(uint64(id), 10))
}

func (c IDCache) Put(id uint, value []byte, ttl time.Duration) {
	c.Set(strconv.FormatUint(uint64(id), 10), value, ttl)
}

func (c IDCache) Remove(id uint) {
	c.Delete(strconv.FormatUint(uint64(id), 10))
}
