package tools

import (
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
	utils2 "github.com/snowykami/neo-blog/pkg/utils"
)

func GetBaseUrl() string {
	return repo.KV.GetKVWithoutErr("base_url", utils2.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl)).(string)
}

func GetAllowRegister() bool {
	return repo.KV.GetKVWithoutErr("enable_register", utils2.Env.GetAsBool("ENABLE_REGISTER", false)).(bool)
}

func GetAllowRegisterFromOidc() bool {
	return repo.KV.GetKVWithoutErr("enable_register_from_oidc", utils2.Env.GetAsBool("ENABLE_REGISTER_FROM_OIDC", true)).(bool)
}

func GetMaximumReplyDepth() int {
	return repo.KV.GetKVWithoutErr("max_reply_depth", utils.Env.GetAsInt(constant.EnvKeyMaxReplyDepth, constant.MaxReplyDepthDefault)).(int)
}
