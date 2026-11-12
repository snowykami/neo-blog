package service

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// GetConfigSchema 后台全局配置表单的结构与当前值（含环境变量设置的值与密钥，仅管理员可读）
func (s *AdminService) GetConfigSchema() config.Schema {
	return config.GetSchema()
}

// SaveConfig 按配置注册表校验类型、取值范围后保存；只写数据库，环境变量设置的配置不受影响
func (s *AdminService) SaveConfig(req *dto.SaveConfigReq) *errs.ServiceError {
	changes := make([]config.Change, 0, len(req.Items))
	touchedSearch := false
	for _, item := range req.Items {
		changes = append(changes, config.Change{Key: item.Key, Value: item.Value})
		if strings.HasPrefix(item.Key, "meilisearch_") {
			touchedSearch = true
		}
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
