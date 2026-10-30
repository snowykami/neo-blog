package tools

import (
	"net/url"
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

// AIWritingStyleMaxRunes 站点写作风格的长度上限，超出部分不放进提示词，避免挤占正文的上下文
const AIWritingStyleMaxRunes = 4000

// GetAIWritingStyle 站点写作风格：管理员在全局配置中填写，编辑器 AI 帮写与外部 AI（MCP）写作时遵循
func GetAIWritingStyle() string {
	style := []rune(strings.TrimSpace(repo.KV.GetStringWithoutErr("ai_writing_style", "")))
	return string(style[:min(len(style), AIWritingStyleMaxRunes)])
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

// 歌词特效（歌词标注）的有效期天数：默认值与允许范围，过期后在后台重新生成
const (
	LyricAnnotationTTLDaysDefault = 7
	LyricAnnotationTTLDaysMax     = 365
)

// GetLyricAnnotationTTLDays 读取歌词标注有效期天数，超出范围时取边界值
func GetLyricAnnotationTTLDays() int {
	n := repo.KV.GetIntWithoutErr("lyric_annotation_ttl_days", LyricAnnotationTTLDaysDefault)
	return min(max(n, 1), LyricAnnotationTTLDaysMax)
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

// GetMusicTTMLURLTemplate 自定义 TTML 歌词源的地址（含 {id} / {song_id} 的模板，或目录前缀）：环境变量 MUSIC_TTML_URL_PREFIX 优先，
// 未设置时取后台配置 music_ttml_url_template；fromEnv 表示取自环境变量（后台的配置此时不生效）
func GetMusicTTMLURLTemplate() (value string, fromEnv bool) {
	if env := strings.TrimSpace(utils.Env.Get(constant.EnvKeyMusicTTMLURL)); env != "" {
		return env, true
	}
	return strings.TrimSpace(repo.KV.GetStringWithoutErr("music_ttml_url_template", "")), false
}

// EnvOverrides 由环境变量设置、优先于后台配置的配置项：配置键 → 环境变量中的值（未设置的不列出），供后台显示
func EnvOverrides() map[string]string {
	overrides := map[string]string{}
	if value, fromEnv := GetMusicTTMLURLTemplate(); fromEnv {
		overrides["music_ttml_url_template"] = value
	}
	return overrides
}

// getNCMSongLevel 读取播放音质，未配置或不在可选范围内时使用默认音质
func getNCMSongLevel() string {
	level := strings.TrimSpace(repo.KV.GetStringWithoutErr("ncm_song_level", NCMSongLevelDefault))
	if !slices.Contains(NCMSongLevels, level) {
		return NCMSongLevelDefault
	}
	return level
}

// QWeatherConfig 和风天气配置（仅后端使用，Key 不对外公开）；Host 为和风天气控制台中的专属 API Host
type QWeatherConfig struct {
	Host string // 规范化后的 scheme://host
	Key  string
}

// Configured Host 与 Key 均已填写；未配置时天气使用 Open-Meteo
func (c QWeatherConfig) Configured() bool {
	return c.Host != "" && c.Key != ""
}

func GetQWeatherConfig() QWeatherConfig {
	return QWeatherConfig{
		Host: normalizeAPIHost(repo.KV.GetStringWithoutErr("qweather_api_host", "")),
		Key:  strings.TrimSpace(repo.KV.GetStringWithoutErr("qweather_api_key", "")),
	}
}

// normalizeAPIHost 只保留 scheme 与 host（未写 scheme 时按 https），不合法时返回空字符串
func normalizeAPIHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func GetMaximumReplyDepth() int {
	return repo.KV.GetIntWithoutErr("max_reply_depth", utils.Env.GetAsInt(constant.EnvKeyMaxReplyDepth, constant.MaxReplyDepthDefault))
}
