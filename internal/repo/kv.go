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

func (k *kvRepo) GetStringWithoutErr(key string, defaultValue ...any) string {
	value, err := k.GetKV(key, defaultValue...)
	if err != nil {
		return defaultValue[0].(string)
	}
	return value.(string)
}
