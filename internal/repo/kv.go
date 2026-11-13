package repo

import (
	"errors"
	"sync"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
)

type kvRepo struct {
	mu    sync.RWMutex
	gen   uint64
	cache map[string]kvCacheEntry
	group singleflight.Group
}

// kvCacheEntry 配置读取缓存；配置读多写少，每个页面会读取数十个键
type kvCacheEntry struct {
	kv        model.KV
	err       error
	expiresAt time.Time
}

// kvCacheTTL 本进程写入会立即失效缓存，并通知其他实例（配置 Redis 时）同步清除；通知丢失时其他实例最多延迟该时长生效
const kvCacheTTL = 30 * time.Second

// kvChangedChannel 配置写入后通知其他实例清除该键的缓存
const kvChangedChannel = "config_changed"

var KV = &kvRepo{cache: make(map[string]kvCacheEntry)}

// cloneKVValue 深拷贝 JSON 值，防止调用方原地修改 map / slice 导致并发读写或污染进程内缓存
func cloneKVValue(v any) any {
	switch val := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, item := range val {
			out[k] = cloneKVValue(item)
		}
		return out
	case model.JSONMap:
		if val == nil {
			return nil
		}
		out := make(model.JSONMap, len(val))
		for k, item := range val {
			out[k] = cloneKVValue(item)
		}
		return out
	case []any:
		out := make([]any, len(val))
		for i, item := range val {
			out[i] = cloneKVValue(item)
		}
		return out
	default:
		return v
	}
}

func cloneModelKV(src model.KV) *model.KV {
	cloned, _ := cloneKVValue(src.Value).(model.JSONMap)
	return &model.KV{
		Key:    src.Key,
		Value:  cloned,
		Secret: src.Secret,
	}
}

// loadKV 读取配置记录（带缓存、并发去重与代数保护），记录不存在也会缓存
func (k *kvRepo) loadKV(key string) (*model.KV, error) {
	k.mu.RLock()
	entry, ok := k.cache[key]
	k.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return cloneModelKV(entry.kv), entry.err
	}
	if GetDB() == nil {
		return nil, ErrDatabaseNotInitialized
	}
	res, err, _ := k.group.Do(key, func() (any, error) {
		k.mu.RLock()
		entry, ok := k.cache[key]
		startGen := k.gen
		k.mu.RUnlock()
		if ok && time.Now().Before(entry.expiresAt) {
			return entry.kv, entry.err
		}
		d := GetDB()
		if d == nil {
			return model.KV{}, ErrDatabaseNotInitialized
		}
		var kv model.KV
		qErr := d.First(&kv, "key = ?", key).Error
		if qErr == nil || errors.Is(qErr, gorm.ErrRecordNotFound) {
			k.mu.Lock()
			if k.gen == startGen {
				k.cache[key] = kvCacheEntry{kv: *cloneModelKV(kv), err: qErr, expiresAt: time.Now().Add(kvCacheTTL)}
			}
			k.mu.Unlock()
		}
		return kv, qErr
	})
	kv, _ := res.(model.KV)
	return cloneModelKV(kv), err
}

func (k *kvRepo) invalidate(key string) {
	k.mu.Lock()
	k.gen++
	delete(k.cache, key)
	k.mu.Unlock()
}

func (k *kvRepo) resetCache() {
	k.mu.Lock()
	k.gen++
	k.cache = make(map[string]kvCacheEntry)
	k.mu.Unlock()
}

// InvalidateCache 主动失效指定配置键的本机缓存；未传参时清空全部配置缓存（如加锁合并写前强制读最新库值）
func (k *kvRepo) InvalidateCache(keys ...string) {
	if len(keys) == 0 {
		k.resetCache()
		return
	}
	for _, key := range keys {
		k.invalidate(key)
	}
}

// changed 写入后清除本实例缓存并通知其他实例；前端带 site 标签的缓存（站点信息与全部前台页面）一并失效
func (k *kvRepo) changed(key string) {
	k.invalidate(key)
	sharedstate.Notify(kvChangedChannel, key)
	TouchCacheTags(CacheTagSite)
}

// ListenChanges 订阅其他实例的配置写入，及时清除本实例缓存；与 Redis 断线重连后清空全部缓存
func (k *kvRepo) ListenChanges() {
	sharedstate.OnNotify(kvChangedChannel, func(key string) {
		if key == "" {
			k.resetCache()
			return
		}
		k.invalidate(key)
	})
}

// HasKey 配置键是否存在于数据库中
func (k *kvRepo) HasKey(key string) bool {
	_, err := k.loadKV(key)
	return err == nil
}

// IsSecret 配置键在数据库中是否已标记为敏感项
func (k *kvRepo) IsSecret(key string) bool {
	kv, err := k.loadKV(key)
	return err == nil && kv.Secret
}

func (k *kvRepo) GetKV(key string, defaultValue ...any) (any, error) {
	kv, err := k.loadKV(key)

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 记录确实不存在
			if len(defaultValue) > 0 {
				return defaultValue[0], nil
			}
			return nil, err // 保持原始的 ErrRecordNotFound
		}
		return nil, err
	}
	// 记录存在，但 Value 字段为空
	if kv.Value == nil {
		if len(defaultValue) > 0 {
			return defaultValue[0], nil
		}
		// 使用不同的错误类型区分语义
		return nil, gorm.ErrRecordNotFound
	}
	// 尝试提取实际值
	if v, ok := kv.Value["value"]; ok {
		return v, nil // 返回实际存储的值（可能是 null）
	}
	// Value 结构异常
	if len(defaultValue) > 0 {
		return defaultValue[0], nil
	}
	return nil, gorm.ErrRecordNotFound
}

func (k *kvRepo) SetKV(key string, value any) error {
	return k.SetKVWithSecret(key, value, true, nil)
}

// SetKVWithSecret 写入配置键并可选更新敏感布尔标记：
//   - updateValue 为 false 时保持原 Value 不变，仅修改 Secret 标记
//   - secret 为 nil 时保持已有记录的 Secret 标记不变
func (k *kvRepo) SetKVWithSecret(key string, value any, updateValue bool, secret *bool) error {
	d := GetDB()
	if d == nil {
		return ErrDatabaseNotInitialized
	}
	var existing model.KV
	err := d.First(&existing, "key = ?", key).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		kv := &model.KV{
			Key:    key,
			Value:  map[string]any{"value": value},
			Secret: secret != nil && *secret,
		}
		if !updateValue {
			kv.Value = map[string]any{"value": nil}
		}
		defer k.changed(key)
		return d.Create(kv).Error
	}
	if updateValue {
		existing.Value = map[string]any{"value": value}
	}
	if secret != nil {
		existing.Secret = *secret
	}
	defer k.changed(key)
	return d.Save(&existing).Error
}

func (k *kvRepo) ListKV(query string) ([]model.KV, error) {
	d := GetDB()
	if d == nil {
		return nil, ErrDatabaseNotInitialized
	}
	var kvs []model.KV
	q := d.Model(&model.KV{})
	if query != "" {
		q = q.Where("key LIKE ?", "%"+query+"%")
	}
	if err := q.Order("key ASC").Find(&kvs).Error; err != nil {
		return nil, err
	}
	return kvs, nil
}

func (k *kvRepo) DeleteKV(key string) error {
	d := GetDB()
	if d == nil {
		return ErrDatabaseNotInitialized
	}
	defer k.changed(key)
	return d.Delete(&model.KV{}, "key = ?", key).Error
}

func (k *kvRepo) GetKVWithoutErr(key string, defaultValue ...any) any {
	value, err := k.GetKV(key, defaultValue...)
	if err != nil {
		if len(defaultValue) > 0 {
			return defaultValue[0]
		}
		return nil
	}
	return value
}

// GetStringWithoutErr 读取字符串配置，不存在或类型不符时返回默认值
func (k *kvRepo) GetStringWithoutErr(key string, defaultValue string) string {
	if value, ok := k.GetKVWithoutErr(key, defaultValue).(string); ok {
		return value
	}
	return defaultValue
}

// GetIntWithoutErr 读取整数配置：JSON 中的数字会被解析为 float64，这里统一转换；不存在或类型不符时返回默认值
func (k *kvRepo) GetIntWithoutErr(key string, defaultValue int) int {
	switch value := k.GetKVWithoutErr(key, defaultValue).(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	}
	return defaultValue
}

// GetBoolWithoutErr 读取布尔配置，不存在或类型不符时返回默认值
func (k *kvRepo) GetBoolWithoutErr(key string, defaultValue bool) bool {
	if value, ok := k.GetKVWithoutErr(key, defaultValue).(bool); ok {
		return value
	}
	return defaultValue
}
