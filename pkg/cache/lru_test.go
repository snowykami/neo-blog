package cache

import (
	"testing"
)

func TestLRUCache_Basic(t *testing.T) {
	cache := NewLRUCache(3)

	// Test Put and Get
	cache.Put(1, []byte("value1"))
	cache.Put(2, []byte("value2"))
	cache.Put(3, []byte("value3"))

	if cache.Len() != 3 {
		t.Errorf("Expected cache length 3, got %d", cache.Len())
	}

	// Test Get
	if val, ok := cache.Get(1); !ok || string(val) != "value1" {
		t.Errorf("Expected to get value1, got %s, ok=%v", val, ok)
	}

	if val, ok := cache.Get(2); !ok || string(val) != "value2" {
		t.Errorf("Expected to get value2, got %s, ok=%v", val, ok)
	}

	if val, ok := cache.Get(3); !ok || string(val) != "value3" {
		t.Errorf("Expected to get value3, got %s, ok=%v", val, ok)
	}
}

func TestLRUCache_Eviction(t *testing.T) {
	cache := NewLRUCache(2)

	// Add 2 items
	cache.Put(1, []byte("value1"))
	cache.Put(2, []byte("value2"))

	// Access item 1 to make it more recent
	cache.Get(1)

	// Add a 3rd item, should evict item 2 (least recently used)
	cache.Put(3, []byte("value3"))

	// Item 2 should be evicted
	if _, ok := cache.Get(2); ok {
		t.Error("Expected item 2 to be evicted")
	}

	// Items 1 and 3 should still be present
	if _, ok := cache.Get(1); !ok {
		t.Error("Expected item 1 to be present")
	}
	if _, ok := cache.Get(3); !ok {
		t.Error("Expected item 3 to be present")
	}

	if cache.Len() != 2 {
		t.Errorf("Expected cache length 2, got %d", cache.Len())
	}
}

func TestLRUCache_Update(t *testing.T) {
	cache := NewLRUCache(2)

	// Add item
	cache.Put(1, []byte("value1"))

	// Update the same item
	cache.Put(1, []byte("updated_value1"))

	// Should still have only 1 item
	if cache.Len() != 1 {
		t.Errorf("Expected cache length 1, got %d", cache.Len())
	}

	// Value should be updated
	if val, ok := cache.Get(1); !ok || string(val) != "updated_value1" {
		t.Errorf("Expected to get updated_value1, got %s, ok=%v", val, ok)
	}
}

func TestLRUCache_Remove(t *testing.T) {
	cache := NewLRUCache(3)

	cache.Put(1, []byte("value1"))
	cache.Put(2, []byte("value2"))
	cache.Put(3, []byte("value3"))

	// Remove item 2
	cache.Remove(2)

	if cache.Len() != 2 {
		t.Errorf("Expected cache length 2, got %d", cache.Len())
	}

	if _, ok := cache.Get(2); ok {
		t.Error("Expected item 2 to be removed")
	}

	// Items 1 and 3 should still be present
	if _, ok := cache.Get(1); !ok {
		t.Error("Expected item 1 to be present")
	}
	if _, ok := cache.Get(3); !ok {
		t.Error("Expected item 3 to be present")
	}
}

func TestLRUCache_Clear(t *testing.T) {
	cache := NewLRUCache(3)

	cache.Put(1, []byte("value1"))
	cache.Put(2, []byte("value2"))
	cache.Put(3, []byte("value3"))

	cache.Clear()

	if cache.Len() != 0 {
		t.Errorf("Expected cache length 0 after clear, got %d", cache.Len())
	}

	if _, ok := cache.Get(1); ok {
		t.Error("Expected all items to be cleared")
	}
}

func TestLRUCache_ZeroCapacity(t *testing.T) {
	cache := NewLRUCache(0)

	// Should default to 100
	if cache.Capacity() != 100 {
		t.Errorf("Expected default capacity 100, got %d", cache.Capacity())
	}
}

func TestLRUCache_Concurrent(t *testing.T) {
	cache := NewLRUCache(100)

	done := make(chan bool)

	// Writer goroutine
	go func() {
		for i := uint(0); i < 50; i++ {
			cache.Put(i, []byte("value"))
		}
		done <- true
	}()

	// Reader goroutine
	go func() {
		for i := uint(0); i < 50; i++ {
			cache.Get(i)
		}
		done <- true
	}()

	// Wait for both goroutines
	<-done
	<-done

	// Just check that we didn't panic
	if cache.Len() > 100 {
		t.Errorf("Cache exceeded capacity")
	}
}

func TestLRUCache_SizeBasedEviction(t *testing.T) {
	// Create cache with 10 items capacity and 100 bytes max size
	cache := NewLRUCacheWithSize(10, 100)

	// Add items that fit within size limit
	cache.Put(1, make([]byte, 30)) // 30 bytes
	cache.Put(2, make([]byte, 30)) // 60 bytes total
	cache.Put(3, make([]byte, 30)) // 90 bytes total

	if cache.Len() != 3 {
		t.Errorf("Expected 3 items, got %d", cache.Len())
	}

	// Add another item that exceeds size limit, should evict oldest
	cache.Put(4, make([]byte, 30)) // Would be 120 bytes, should evict item 1

	if cache.Len() != 3 {
		t.Errorf("Expected 3 items after eviction, got %d", cache.Len())
	}

	// Item 1 should be evicted
	if _, ok := cache.Get(1); ok {
		t.Error("Expected item 1 to be evicted due to size limit")
	}

	// Items 2, 3, 4 should be present
	if _, ok := cache.Get(2); !ok {
		t.Error("Expected item 2 to be present")
	}
	if _, ok := cache.Get(3); !ok {
		t.Error("Expected item 3 to be present")
	}
	if _, ok := cache.Get(4); !ok {
		t.Error("Expected item 4 to be present")
	}
}

func TestLRUCache_OversizedItem(t *testing.T) {
	// Create cache with 100 bytes max size
	cache := NewLRUCacheWithSize(10, 100)

	// Add normal item
	cache.Put(1, make([]byte, 50))

	if cache.Len() != 1 {
		t.Errorf("Expected 1 item, got %d", cache.Len())
	}

	// Try to add an item that exceeds max size - should be rejected
	cache.Put(2, make([]byte, 150))

	if cache.Len() != 1 {
		t.Errorf("Expected 1 item (oversized item should be rejected), got %d", cache.Len())
	}

	// Item 1 should still be present
	if _, ok := cache.Get(1); !ok {
		t.Error("Expected item 1 to still be present")
	}

	// Item 2 should not be cached
	if _, ok := cache.Get(2); ok {
		t.Error("Expected oversized item 2 to not be cached")
	}
}

func TestLRUCache_CurrentSize(t *testing.T) {
	cache := NewLRUCacheWithSize(10, 1000)

	cache.Put(1, make([]byte, 100))
	cache.Put(2, make([]byte, 200))
	cache.Put(3, make([]byte, 300))

	expectedSize := int64(600)
	if cache.CurrentSize() != expectedSize {
		t.Errorf("Expected current size %d, got %d", expectedSize, cache.CurrentSize())
	}

	// Remove an item
	cache.Remove(2)

	expectedSize = int64(400)
	if cache.CurrentSize() != expectedSize {
		t.Errorf("Expected current size %d after removal, got %d", expectedSize, cache.CurrentSize())
	}

	// Clear cache
	cache.Clear()

	if cache.CurrentSize() != 0 {
		t.Errorf("Expected current size 0 after clear, got %d", cache.CurrentSize())
	}
}
