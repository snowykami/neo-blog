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
	return repo.KV.GetBoolWithoutErr("enable_register", utils.Env.GetAsBool(constant.EnvKeyEnableRegister, false))
}

func GetAllowRegisterFromOidc() bool {
	return repo.KV.GetBoolWithoutErr("enable_register_from_oidc", utils.Env.GetAsBool(constant.EnvKeyEnableRegisterFromOidc, true))
}

// GetVerifyCodeCoolDown 验证码发送冷却秒数：后台表单保存在 site_info 中，兼容旧的独立配置键
func GetVerifyCodeCoolDown() int {
	if siteInfo, ok := repo.KV.GetKVWithoutErr("site_info", nil).(map[string]any); ok {
		if value, ok := siteInfo["verify_code_cool_down"].(float64); ok && value > 0 {
			return int(value)
		}
	}
	return repo.KV.GetIntWithoutErr("verify_code_cool_down", 60)
}

// AIConfig OpenAI 兼容接口配置（仅后端使用，不对外公开）
type AIConfig struct {
	BaseURL string
	APIKey  string
	Model   string
}

// Configured 三项均已填写
func (c AIConfig) Configured() bool {
	return c.BaseURL != "" && c.APIKey != "" && c.Model != ""
}

func GetAIConfig() AIConfig {
	return AIConfig{
		BaseURL: strings.TrimRight(strings.TrimSpace(repo.KV.GetStringWithoutErr("ai_api_base_url", "")), "/"),
		APIKey:  strings.TrimSpace(repo.KV.GetStringWithoutErr("ai_api_key", "")),
		Model:   strings.TrimSpace(repo.KV.GetStringWithoutErr("ai_model", "")),
	}
}

func GetMaximumReplyDepth() int {
	return repo.KV.GetIntWithoutErr("max_reply_depth", utils.Env.GetAsInt(constant.EnvKeyMaxReplyDepth, constant.MaxReplyDepthDefault))
}
