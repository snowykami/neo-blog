package tools

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
	utils2 "github.com/snowykami/neo-blog/pkg/utils"
)

func GetSiteName() string {
	return repo.KV.GetKVWithoutErr("site_name", "Snowykami's Blog").(string)
}

func GetSiteIcon() string {
	return repo.KV.GetKVWithoutErr("site_icon", "https://cdn.liteyuki.org/snowykami/avatar_alpha.png").(string)
}

func GetSiteDescription() string {
	return repo.KV.GetKVWithoutErr("site_description", "A neo blog system").(string)
}

func GetBaseUrl() string {
	return strings.TrimSuffix(repo.KV.GetKVWithoutErr("base_url", utils2.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl)).(string), "/")
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
