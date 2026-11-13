package sharedstate

import (
	"strconv"
	"strings"
	"sync"
	"time"
)

// memoryMaxItems 进程内存储的条目上限：满时先清理过期项，仍满则随机淘汰
const memoryMaxItems = 100000

type memoryItem struct {
	value    string
	expireAt time.Time // 零值表示不过期
}

func (i memoryItem) expired(now time.Time) bool {
	return !i.expireAt.IsZero() && !now.Before(i.expireAt)
}

// memoryStore 进程内存实现，只在本实例可见（单实例部署）；过期项在访问或写满时清理
type memoryStore struct {
	mu    sync.Mutex
	items map[string]memoryItem
}

func newMemoryStore() *memoryStore {
	return &memoryStore{items: map[string]memoryItem{}}
}

func expireAt(now time.Time, ttl time.Duration) time.Time {
	if ttl <= 0 {
		return time.Time{}
	}
	return now.Add(ttl)
}

// getLocked 读取未过期的条目（调用方持有锁），过期的顺带删除
func (m *memoryStore) getLocked(key string, now time.Time) (memoryItem, bool) {
	item, ok := m.items[key]
	if !ok {
		return memoryItem{}, false
	}
	if item.expired(now) {
		delete(m.items, key)
		return memoryItem{}, false
	}
	return item, true
}

func isProtectedMemoryKey(key string) bool {
	return strings.HasPrefix(key, "lock:") ||
		strings.HasPrefix(key, "lease") ||
		strings.HasPrefix(key, "task_round:") ||
		strings.HasPrefix(key, "storage_migration:") ||
		strings.HasPrefix(key, "ai_summary:") ||
		strings.HasPrefix(key, "edit_session:")
}

func (m *memoryStore) putLocked(key string, item memoryItem, now time.Time) {
	if _, exists := m.items[key]; !exists && len(m.items) >= memoryMaxItems {
		for k, v := range m.items {
			if v.expired(now) {
				delete(m.items, k)
			}
		}
		// 优先淘汰非锁/租约的普通缓存与限流计数，防止写满时误删互斥锁与任务令牌
		for k := range m.items {
			if len(m.items) < memoryMaxItems {
				break
			}
			if !isProtectedMemoryKey(k) {
				delete(m.items, k)
			}
		}
		for k := range m.items {
			if len(m.items) < memoryMaxItems {
				break
			}
			delete(m.items, k)
		}
	}
	m.items[key] = item
}

func (m *memoryStore) Get(key string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.getLocked(key, time.Now())
	return item.value, ok, nil
}

func (m *memoryStore) GetMany(keys ...string) (map[string]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	result := make(map[string]string, len(keys))
	for _, key := range keys {
		if item, ok := m.getLocked(key, now); ok {
			result[key] = item.value
		}
	}
	return result, nil
}

func (m *memoryStore) Set(key, value string, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	m.putLocked(key, memoryItem{value: value, expireAt: expireAt(now, ttl)}, now)
	return nil
}

func (m *memoryStore) SetNX(key, value string, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	if _, ok := m.getLocked(key, now); ok {
		return false, nil
	}
	m.putLocked(key, memoryItem{value: value, expireAt: expireAt(now, ttl)}, now)
	return true, nil
}

func (m *memoryStore) Take(key string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.getLocked(key, time.Now())
	if ok {
		delete(m.items, key)
	}
	return item.value, ok, nil
}

func (m *memoryStore) CompareAndDelete(key, value string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.getLocked(key, time.Now())
	if !ok || item.value != value {
		return false, nil
	}
	delete(m.items, key)
	return true, nil
}

func (m *memoryStore) Extend(key, value string, ttl time.Duration) (bool, error) {
	if ttl <= 0 {
		return false, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	item, ok := m.getLocked(key, now)
	if !ok || item.value != value {
		return false, nil
	}
	item.expireAt = expireAt(now, ttl)
	m.items[key] = item
	return true, nil
}

func (m *memoryStore) Delete(keys ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, key := range keys {
		delete(m.items, key)
	}
	return nil
}

func (m *memoryStore) Incr(key string, ttl time.Duration) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	if item, ok := m.getLocked(key, now); ok {
		count, err := strconv.ParseInt(item.value, 10, 64)
		if err != nil {
			return 0, err
		}
		item.value = strconv.FormatInt(count+1, 10)
		m.items[key] = item
		return count + 1, nil
	}
	m.putLocked(key, memoryItem{value: "1", expireAt: expireAt(now, ttl)}, now)
	return 1, nil
}

func (m *memoryStore) GetByPrefix(prefix string) (map[string]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	result := map[string]string{}
	for key := range m.items {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		if item, ok := m.getLocked(key, now); ok {
			result[key] = item.value
		}
	}
	return result, nil
}

// Publish 单实例没有其他实例需要通知
func (m *memoryStore) Publish(string, string) error {
	return nil
}

func (m *memoryStore) Close() error {
	return nil
}
