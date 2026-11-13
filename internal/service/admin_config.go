package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

const adminKVLockTTL = 10 * time.Second

func hasKVValue(v any) bool {
	if v == nil {
		return false
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s) != ""
	}
	return strings.TrimSpace(fmt.Sprint(v)) != ""
}

// isSecretMaskValue 判断传入的值是否为前端敏感项脱敏掩码占位符（如 "******"、"••••••••"），写回时跳过以免覆盖真实密钥
func isSecretMaskValue(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) < 4 {
		return false
	}
	for _, r := range runes {
		if r != '*' && r != '•' {
			return false
		}
	}
	return true
}

// GetConfigSchema 后台全局配置表单的结构与当前值（敏感密钥项脱敏，仅管理员可读）
func (s *AdminService) GetConfigSchema() config.Schema {
	return config.GetSchema()
}

// SaveConfig 按配置注册表校验类型、取值范围后保存；环境变量接管的只读项拒绝覆盖，敏感掩码占位符不覆盖已有密钥
func (s *AdminService) SaveConfig(req *dto.SaveConfigReq) *errs.ServiceError {
	changes := make([]config.Change, 0, len(req.Items))
	touchedSearch := false
	for _, item := range req.Items {
		if it := config.Lookup(item.Key); it != nil {
			if _, fromEnv := it.EnvValue(); fromEnv {
				return errs.NewBadRequest("config_readonly_env")
			}
			if it.Type == config.TypeSecret && isSecretMaskValue(item.Value) && repo.KV.HasKey(item.Key) {
				continue
			}
		}
		changes = append(changes, config.Change{Key: item.Key, Value: item.Value})
		if strings.HasPrefix(item.Key, "meilisearch_") {
			touchedSearch = true
		}
	}
	if len(changes) == 0 {
		return nil
	}
	if svcerr := config.Save(changes); svcerr != nil {
		return svcerr
	}
	if touchedSearch {
		repo.InvalidatePostCache()
		onSearchConfigSaved()
	}
	return nil
}

// ListKV 列出配置键值，对标记为 secret 或注册表声明为 TypeSecret 的敏感凭据执行脱敏保护
func (s *AdminService) ListKV(query string) ([]dto.KVDto, *errs.ServiceError) {
	kvs, err := repo.KV.ListKV(query)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("kv")
	}
	items := make([]dto.KVDto, 0, len(kvs))
	for _, kv := range kvs {
		rawVal := kv.Value["value"]
		if kv.Secret || config.IsSecretKey(kv.Key) {
			items = append(items, dto.KVDto{
				Key:      kv.Key,
				Value:    nil,
				Secret:   true,
				HasValue: hasKVValue(rawVal),
			})
			continue
		}
		items = append(items, dto.KVDto{Key: kv.Key, Value: rawVal})
	}
	return items, nil
}

// SetKV 写入单个键值：
//   - 拦截已由环境变量接管的只读注册项；
//   - 对敏感凭据实施掩码占位符写回保护，不覆盖真实密钥；
//   - 注册表配置项统一走 SaveConfig / config.Save，确保类型与交叉校验、site_info 并发写锁及跨实例缓存失效广播全部生效。
func (s *AdminService) SetKV(key string, req *dto.SetKVReq) *errs.ServiceError {
	if key == "" {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	it := config.Lookup(key)
	if it != nil {
		if _, fromEnv := it.EnvValue(); fromEnv {
			return errs.NewBadRequest("config_readonly_env")
		}
	}

	updateValue := req.UpdateValue == nil || *req.UpdateValue
	secret := req.Secret
	if config.IsSecretKey(key) {
		isSecret := true
		secret = &isSecret
	}

	isSecretTarget := config.IsSecretKey(key) || (secret != nil && *secret) || repo.KV.IsSecret(key)
	if isSecretTarget && updateValue && isSecretMaskValue(req.Value) {
		if secret != nil && repo.KV.HasKey(key) {
			if err := repo.KV.SetKVWithSecret(key, nil, false, secret); err != nil {
				return errs.Internal("failed_to_update_target", err).WithResource("kv")
			}
		}
		return nil
	}

	if it != nil {
		if updateValue {
			if svcerr := s.SaveConfig(&dto.SaveConfigReq{
				Items: []dto.KVDto{{Key: key, Value: req.Value}},
			}); svcerr != nil {
				return svcerr
			}
			if !config.IsSecretKey(key) && secret != nil && repo.KV.HasKey(key) {
				if err := repo.KV.SetKVWithSecret(key, nil, false, secret); err != nil {
					return errs.Internal("failed_to_update_target", err).WithResource("kv")
				}
			}
			return nil
		}
		if err := repo.KV.SetKVWithSecret(key, req.Value, false, secret); err != nil {
			return errs.Internal("failed_to_update_target", err).WithResource("kv")
		}
		return nil
	}

	if key == "site_info" {
		if updateValue {
			if _, ok := req.Value.(map[string]any); !ok {
				return errs.NewBadRequest("invalid_config_value")
			}
		}
		lockCtx, cancel := context.WithTimeout(context.Background(), adminKVLockTTL)
		defer cancel()
		release, lockErr := sharedstate.Lock(lockCtx, "config:save", adminKVLockTTL)
		if lockErr != nil {
			return errs.Internal("failed_to_save_config", lockErr)
		}
		defer release()
		repo.KV.InvalidateCache(key)
		if err := repo.KV.SetKVWithSecret(key, req.Value, updateValue, secret); err != nil {
			return errs.Internal("failed_to_update_target", err).WithResource("kv")
		}
		return nil
	}

	if err := repo.KV.SetKVWithSecret(key, req.Value, updateValue, secret); err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("kv")
	}
	return nil
}

// DeleteKV 删除配置键值：注册表配置项走 config.Reset 以校验关联约束、同步清理 site_info 聚合路径并广播跨实例缓存失效
func (s *AdminService) DeleteKV(key string) *errs.ServiceError {
	if key == "" {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	if it := config.Lookup(key); it != nil {
		if _, fromEnv := it.EnvValue(); fromEnv {
			return errs.NewBadRequest("config_readonly_env")
		}
		if svcerr := config.Reset(key); svcerr != nil {
			return svcerr
		}
		if strings.HasPrefix(key, "meilisearch_") {
			repo.InvalidatePostCache()
			onSearchConfigSaved()
		}
		return nil
	}
	if key == "site_info" {
		lockCtx, cancel := context.WithTimeout(context.Background(), adminKVLockTTL)
		defer cancel()
		release, lockErr := sharedstate.Lock(lockCtx, "config:save", adminKVLockTTL)
		if lockErr != nil {
			return errs.Internal("failed_to_save_config", lockErr)
		}
		defer release()
		repo.KV.InvalidateCache(key)
	}
	if err := repo.KV.DeleteKV(key); err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("kv")
	}
	return nil
}
