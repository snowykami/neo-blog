package repo

import (
	"errors"

	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

type kvRepo struct{}

var KV = &kvRepo{}

func (k *kvRepo) GetKV(key string, defaultValue ...any) (any, error) {
	var kv = &model.KV{}
	err := GetDB().First(kv, "key = ?", key).Error

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
	kv := &model.KV{
		Key:   key,
		Value: map[string]any{"value": value},
	}
	return GetDB().Save(kv).Error
}

func (k *kvRepo) ListKV(query string) ([]model.KV, error) {
	var kvs []model.KV
	q := GetDB().Model(&model.KV{})
	if query != "" {
		q = q.Where("key LIKE ?", "%"+query+"%")
	}
	if err := q.Order("key ASC").Find(&kvs).Error; err != nil {
		return nil, err
	}
	return kvs, nil
}

func (k *kvRepo) DeleteKV(key string) error {
	return GetDB().Delete(&model.KV{}, "key = ?", key).Error
}

func (k *kvRepo) GetKVWithoutErr(key string, defaultValue ...any) any {
	value, err := k.GetKV(key, defaultValue...)
	if err != nil {
		return defaultValue[0]
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
