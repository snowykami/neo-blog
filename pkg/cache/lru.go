package cache

import (
	"container/list"
	"sync"

	"github.com/sirupsen/logrus"
)

// LRUCache 是一个线程安全的 LRU (Least Recently Used) 缓存实现
type LRUCache struct {
	capacity    int // 最大条目数量
	maxBytes    int64 // 最大缓存字节数，0表示不限制
	currentSize int64 // 当前缓存字节数
	cache       map[uint]*list.Element
	list        *list.List
	mu          sync.RWMutex
}

// entry 表示缓存中的一个条目
type entry struct {
	key   uint
	value []byte
}

// NewLRUCache 创建一个新的 LRU 缓存
func NewLRUCache(capacity int) *LRUCache {
	if capacity <= 0 {
		capacity = 100 // 默认容量
	}
	return &LRUCache{
		capacity:    capacity,
		maxBytes:    100 * 1024 * 1024, // 默认100MB最大缓存大小
		currentSize: 0,
		cache:       make(map[uint]*list.Element),
		list:        list.New(),
	}
}

// NewLRUCacheWithSize 创建一个带大小限制的 LRU 缓存
func NewLRUCacheWithSize(capacity int, maxBytes int64) *LRUCache {
	if capacity <= 0 {
		capacity = 100 // 默认容量
	}
	if maxBytes <= 0 {
		maxBytes = 100 * 1024 * 1024 // 默认100MB
	}
	return &LRUCache{
		capacity:    capacity,
		maxBytes:    maxBytes,
		currentSize: 0,
		cache:       make(map[uint]*list.Element),
		list:        list.New(),
	}
}

// Get 从缓存中获取值
// 如果找到，返回值和 true；否则返回 nil 和 false
func (c *LRUCache) Get(key uint) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.cache[key]; ok {
		// 将访问的元素移到链表头部（最近使用）
		c.list.MoveToFront(elem)
		return elem.Value.(*entry).value, true
	}
	return nil, false
}

// Put 将键值对放入缓存
func (c *LRUCache) Put(key uint, value []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()

	valueSize := int64(len(value))

	// 如果单个文件超过最大缓存大小，不缓存
	if c.maxBytes > 0 && valueSize > c.maxBytes {
		logrus.Warnf("Cache item size %d bytes exceeds max cache size %d bytes, skipping cache for key %d", valueSize, c.maxBytes, key)
		return
	}

	// 如果键已存在，更新值并移到前面
	if elem, ok := c.cache[key]; ok {
		oldSize := int64(len(elem.Value.(*entry).value))
		c.list.MoveToFront(elem)
		elem.Value.(*entry).value = value
		c.currentSize = c.currentSize - oldSize + valueSize
		return
	}

	// 驱逐元素直到有足够空间
	for c.maxBytes > 0 && c.currentSize+valueSize > c.maxBytes && c.list.Len() > 0 {
		oldest := c.list.Back()
		if oldest != nil {
			oldEntry := oldest.Value.(*entry)
			c.currentSize -= int64(len(oldEntry.value))
			c.list.Remove(oldest)
			delete(c.cache, oldEntry.key)
		}
	}

	// 如果缓存数量已满，删除最久未使用的元素
	if c.list.Len() >= c.capacity {
		oldest := c.list.Back()
		if oldest != nil {
			oldEntry := oldest.Value.(*entry)
			c.currentSize -= int64(len(oldEntry.value))
			c.list.Remove(oldest)
			delete(c.cache, oldEntry.key)
		}
	}

	// 添加新元素到链表头部
	elem := c.list.PushFront(&entry{key: key, value: value})
	c.cache[key] = elem
	c.currentSize += valueSize
}

// Remove 从缓存中删除指定的键
func (c *LRUCache) Remove(key uint) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.cache[key]; ok {
		c.currentSize -= int64(len(elem.Value.(*entry).value))
		c.list.Remove(elem)
		delete(c.cache, key)
	}
}

// Clear 清空缓存
func (c *LRUCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache = make(map[uint]*list.Element)
	c.list = list.New()
	c.currentSize = 0
}

// Len 返回缓存中的元素数量
func (c *LRUCache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.list.Len()
}

// Capacity 返回缓存的容量
func (c *LRUCache) Capacity() int {
	return c.capacity
}

// CurrentSize 返回当前缓存占用的字节数
func (c *LRUCache) CurrentSize() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.currentSize
}

// MaxBytes 返回最大缓存字节数
func (c *LRUCache) MaxBytes() int64 {
	return c.maxBytes
}
