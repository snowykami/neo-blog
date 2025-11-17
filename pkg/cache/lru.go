package cache

import (
	"container/list"
	"sync"
)

// LRUCache 是一个线程安全的 LRU (Least Recently Used) 缓存实现
type LRUCache struct {
	capacity int
	cache    map[uint]*list.Element
	list     *list.List
	mu       sync.RWMutex
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
		capacity: capacity,
		cache:    make(map[uint]*list.Element),
		list:     list.New(),
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

	// 如果键已存在，更新值并移到前面
	if elem, ok := c.cache[key]; ok {
		c.list.MoveToFront(elem)
		elem.Value.(*entry).value = value
		return
	}

	// 如果缓存已满，删除最久未使用的元素
	if c.list.Len() >= c.capacity {
		oldest := c.list.Back()
		if oldest != nil {
			c.list.Remove(oldest)
			delete(c.cache, oldest.Value.(*entry).key)
		}
	}

	// 添加新元素到链表头部
	elem := c.list.PushFront(&entry{key: key, value: value})
	c.cache[key] = elem
}

// Remove 从缓存中删除指定的键
func (c *LRUCache) Remove(key uint) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.cache[key]; ok {
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
