package tools

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 以下配置可在后台全局配置中修改；读取时容忍类型差异（JSON 数字为 float64），避免类型断言 panic

func GetSiteName() string {
	return repo.KV.GetStringWithoutErr("site_name", "Snowykami's Blog")
}

func GetSiteIcon() string {
	return repo.KV.GetStringWithoutErr("site_icon", "https://cdn.liteyuki.org/snowykami/avatar_alpha.png")
}

func GetSiteDescription() string {
	return repo.KV.GetStringWithoutErr("site_description", "A neo blog system")
}

func GetBaseUrl() string {
	return strings.TrimSuffix(repo.KV.GetStringWithoutErr("base_url", utils.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl)), "/")
}

func GetAllowRegister() bool {
	return repo.KV.GetBoolWithoutErr("enable_register", utils.Env.GetAsBool("ENABLE_REGISTER", false))
}

func GetAllowRegisterFromOidc() bool {
	return repo.KV.GetBoolWithoutErr("enable_register_from_oidc", utils.Env.GetAsBool("ENABLE_REGISTER_FROM_OIDC", true))
}

func GetMaximumReplyDepth() int {
	return repo.KV.GetIntWithoutErr("max_reply_depth", utils.Env.GetAsInt(constant.EnvKeyMaxReplyDepth, constant.MaxReplyDepthDefault))
}
