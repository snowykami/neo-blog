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
			if len(defaultValue) > 0 {
				return defaultValue[0], nil
			}
			return nil, nil
		}
		return nil, err
	}

	if kv.Value == nil {
		if len(defaultValue) > 0 {
			return defaultValue[0], nil
		}
		return nil, nil
	}

	if v, ok := kv.Value["value"]; ok {
		return v, nil
	}

	if len(defaultValue) > 0 {
		return defaultValue[0], nil
	}
	return nil, nil
}

func (k *kvRepo) SetKV(key string, value any) error {
	kv := &model.KV{
		Key:   key,
		Value: map[string]any{"value": value},
	}
	return GetDB().Save(kv).Error
}
