package tools

import (
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	utils2 "github.com/snowykami/neo-blog/pkg/utils"
)

func GetBaseUrl() string {
	return repo.KV.GetKVWithoutErr("base_url", utils2.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl)).(string)
}
