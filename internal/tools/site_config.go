package tools

import (
	"slices"
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
	BaseURL     string
	APIKey      string
	Model       string
	Concurrency int // 同时进行的摘要生成任务数上限
}

// AI 摘要并发数：默认值与允许范围
const (
	AISummaryConcurrencyDefault = 3
	AISummaryConcurrencyMax     = 20
)

// Configured 三项均已填写
func (c AIConfig) Configured() bool {
	return c.BaseURL != "" && c.APIKey != "" && c.Model != ""
}

func GetAIConfig() AIConfig {
	return AIConfig{
		BaseURL:     strings.TrimRight(strings.TrimSpace(repo.KV.GetStringWithoutErr("ai_api_base_url", "")), "/"),
		APIKey:      strings.TrimSpace(repo.KV.GetStringWithoutErr("ai_api_key", "")),
		Model:       strings.TrimSpace(repo.KV.GetStringWithoutErr("ai_model", "")),
		Concurrency: GetAISummaryConcurrency(),
	}
}

// GetAISummaryConcurrency 读取 AI 摘要并发数，超出范围时取边界值
func GetAISummaryConcurrency() int {
	n := repo.KV.GetIntWithoutErr("ai_summary_concurrency", AISummaryConcurrencyDefault)
	return min(max(n, 1), AISummaryConcurrencyMax)
}

// NCMConfig 网易云音乐 API（NeteaseCloudMusicApi Enhanced）配置（仅后端使用，Cookie 不对外公开）
type NCMConfig struct {
	BaseURL    string
	Cookie     string
	PlaylistID int64  // 作为博客歌单的网易云歌单 ID
	Level      string // 播放音质，见 NCMSongLevels
}

// NCMSongLevels 可选的播放音质（song/url/v1 的 level），只提供浏览器可以直接播放的格式
// standard 128k、higher 192k、exhigh 320k（默认）、lossless 无损 FLAC、hires Hi-Res FLAC
var NCMSongLevels = []string{"standard", "higher", "exhigh", "lossless", "hires"}

const NCMSongLevelDefault = "exhigh"

// Configured 已填写 API 地址并选择了歌单
func (c NCMConfig) Configured() bool {
	return c.BaseURL != "" && c.PlaylistID > 0
}

func GetNCMConfig() NCMConfig {
	return NCMConfig{
		BaseURL:    strings.TrimRight(strings.TrimSpace(repo.KV.GetStringWithoutErr("ncm_api_base_url", "")), "/"),
		Cookie:     strings.TrimSpace(repo.KV.GetStringWithoutErr("ncm_cookie", "")),
		PlaylistID: int64(repo.KV.GetIntWithoutErr("ncm_playlist_id", 0)),
		Level:      getNCMSongLevel(),
	}
}

// getNCMSongLevel 读取播放音质，未配置或不在可选范围内时使用默认音质
func getNCMSongLevel() string {
	level := strings.TrimSpace(repo.KV.GetStringWithoutErr("ncm_song_level", NCMSongLevelDefault))
	if !slices.Contains(NCMSongLevels, level) {
		return NCMSongLevelDefault
	}
	return level
}

func GetMaximumReplyDepth() int {
	return repo.KV.GetIntWithoutErr("max_reply_depth", utils.Env.GetAsInt(constant.EnvKeyMaxReplyDepth, constant.MaxReplyDepthDefault))
}
