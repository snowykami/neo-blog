package utils

import (
	"sync"
	"time"
)

type kvStoreUtils struct{}

var KV kvStoreUtils

// KVStore 是一个简单的内存键值存储系统
type KVStore struct {
	data  map[string]storeItem
	mutex sync.RWMutex
}

// storeItem 代表存储的单个数据项
type storeItem struct {
	value      interface{}
	expiration int64 // Unix时间戳，0表示永不过期
}

// 全局单例
var (
	kvStore     *KVStore
	kvStoreOnce sync.Once
)

// GetInstance 获取KVStore单例实例
func (kv *kvStoreUtils) GetInstance() *KVStore {
	kvStoreOnce.Do(func() {
		kvStore = &KVStore{
			data: make(map[string]storeItem),
		}
		// 启动清理过期项的协程
		go kvStore.startCleanupTimer()
	})
	return kvStore
}

// Set 设置键值对，可选指定过期时间
func (s *KVStore) Set(key string, value interface{}, ttl time.Duration) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	var expiration int64
	if ttl > 0 {
		expiration = time.Now().Add(ttl).Unix()
	}

	s.data[key] = storeItem{
		value:      value,
		expiration: expiration,
	}
}

// Get 获取键对应的值，如果键不存在或已过期则返回(nil, false)
func (s *KVStore) Get(key string) (interface{}, bool) {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	item, exists := s.data[key]
	if !exists {
		return nil, false
	}

	// 检查是否过期
	if item.expiration > 0 && time.Now().Unix() > item.expiration {
		return nil, false
	}

	return item.value, true
}

// Delete 删除键值对
func (s *KVStore) Delete(key string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	delete(s.data, key)
}

// Lookup 检查键是否存在且未过期
func (s *KVStore) Lookup(key string) bool {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	item, exists := s.data[key]
	if !exists {
		return false
	}

	// 检查是否过期
	if item.expiration > 0 && time.Now().Unix() > item.expiration {
		return false
	}

	return true
}

// Clear 清空所有键值对
func (s *KVStore) Clear() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	s.data = make(map[string]storeItem)
}

// startCleanupTimer 启动定期清理过期项的计时器
func (s *KVStore) startCleanupTimer() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		s.cleanup()
	}
}

// cleanup 清理过期的数据项
func (s *KVStore) cleanup() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	now := time.Now().Unix()
	for key, item := range s.data {
		if item.expiration > 0 && now > item.expiration {
			delete(s.data, key)
		}
	}
}

// secureRand 生成0到max-1之间的安全随机数
func secureRand(max int) int {
	// 简单实现，可以根据需要使用crypto/rand替换
	return int(time.Now().UnixNano() % int64(max))
}
