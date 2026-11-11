package tools

import (
	"cmp"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 以下配置的类型、默认值、取值范围与可覆盖它的环境变量统一在 internal/config 中声明，读取顺序为环境变量 > 后台配置 > 默认值；
// 这里按业务需要组合与规整（如去掉地址末尾的斜杠）

func GetSiteName() string        { return config.String("site_name") }
func GetSiteIcon() string        { return config.String("site_icon") }
func GetSiteDescription() string { return config.String("site_description") }

// RSS 频道信息：后台「RSS」页单独填写的优先，留空时沿用站点名称、站长名称、页脚版权与站点图标
func GetRssTitle() string  { return cmp.Or(config.String("site_title"), GetSiteName()) }
func GetRssAuthor() string { return cmp.Or(config.String("site_author"), config.String("owner_name")) }
func GetRssImage() string  { return cmp.Or(config.String("site_image"), GetSiteIcon()) }

// GetRssCopyright 都没填写时沿用以往的默认协议
func GetRssCopyright() string {
	return cmp.Or(config.String("site_copyright"), config.String("copyright"), "CC BY-NC-SA 4.0")
}

// GetBaseUrl 站点地址：环境变量 BASE_URL 优先，其次后台配置
func GetBaseUrl() string {
	return strings.TrimSuffix(config.String("base_url"), "/")
}

func GetAllowRegister() bool         { return config.Bool("enable_register") }
func GetAllowRegisterFromOidc() bool { return config.Bool("enable_register_from_oidc") }

// GetVisitFingerprintAttribution 用户登录后，是否按浏览器指纹与 IP 段把其他访客登录前的匿名访问也补记到该用户
func GetVisitFingerprintAttribution() bool { return config.Bool("visit_fingerprint_attribution") }

// GetErrorReportEnabled 是否接收错误报告（浏览器、Next.js 服务端与 Go 后端）
func GetErrorReportEnabled() bool { return config.Bool("error_report_enabled") }

// GetErrorReportRetentionDays 错误报告的保留天数
func GetErrorReportRetentionDays() int { return config.Int("error_report_retention_days") }

// GetVerifyCodeCoolDown 验证码发送冷却秒数
func GetVerifyCodeCoolDown() int { return config.Int("verify_code_cool_down") }

// AIWritingStyleMaxRunes 站点写作风格的长度上限，超出部分不放进提示词，避免挤占正文的上下文
const AIWritingStyleMaxRunes = 4000

// GetAIWritingStyle 站点写作风格：管理员在全局配置中填写，编辑器 AI 帮写与外部 AI（MCP）写作时遵循
func GetAIWritingStyle() string {
	style := []rune(config.String("ai_writing_style"))
	return string(style[:min(len(style), AIWritingStyleMaxRunes)])
}

// AIConfig OpenAI 兼容接口配置（仅后端使用，不对外公开）
type AIConfig struct {
	BaseURL     string
	APIKey      string
	Model       string
	Concurrency int // 同时进行的摘要生成任务数上限
}

// Configured 三项均已填写
func (c AIConfig) Configured() bool {
	return c.BaseURL != "" && c.APIKey != "" && c.Model != ""
}

func GetAIConfig() AIConfig {
	return AIConfig{
		BaseURL:     strings.TrimRight(config.String("ai_api_base_url"), "/"),
		APIKey:      config.String("ai_api_key"),
		Model:       config.String("ai_model"),
		Concurrency: GetAISummaryConcurrency(),
	}
}

// GetAISummaryConcurrency AI 摘要同时进行的任务数
func GetAISummaryConcurrency() int { return config.Int("ai_summary_concurrency") }

// GetAIMonthlyTokenBudget 全站 AI 月度 token 预算，0 为不限
func GetAIMonthlyTokenBudget() int64 { return int64(config.Int("ai_monthly_token_budget")) }

// GetLyricAnnotationTTLDays 歌词特效（歌词标注）的有效期天数，过期后在后台重新生成
func GetLyricAnnotationTTLDays() int { return config.Int("lyric_annotation_ttl_days") }

// NCMConfig 网易云音乐 API（NeteaseCloudMusicApi Enhanced）配置（仅后端使用，Cookie 不对外公开）
type NCMConfig struct {
	BaseURL    string
	Cookie     string
	PlaylistID int64  // 作为博客歌单的网易云歌单 ID
	Level      string // 播放音质，见 NCMSongLevels
}

// NCMSongLevels 可选的播放音质，从低到高
var NCMSongLevels = config.NCMSongLevels

// Configured 已填写 API 地址并选择了歌单
func (c NCMConfig) Configured() bool {
	return c.BaseURL != "" && c.PlaylistID > 0
}

func GetNCMConfig() NCMConfig {
	return NCMConfig{
		BaseURL:    strings.TrimRight(config.String("ncm_api_base_url"), "/"),
		Cookie:     config.String("ncm_cookie"),
		PlaylistID: int64(config.Int("ncm_playlist_id")),
		Level:      config.String("ncm_song_level"),
	}
}

// GetMusicTTMLSources 自定义 TTML 歌词源，按探测顺序排列
func GetMusicTTMLSources() []config.MusicTTMLSource {
	sources, _ := config.Value("music_ttml_sources").([]config.MusicTTMLSource)
	return sources
}

// GetCaptchaConfig 人机验证配置，每次请求时读取，后台修改后立即生效
func GetCaptchaConfig() *utils.CaptchaConfig {
	return &utils.CaptchaConfig{
		Type:      config.String("captcha_provider"),
		SiteKey:   config.String("captcha_site_key"),
		SecretKey: config.String("captcha_secret_key"),
	}
}

// GetEmailConfig 发信（SMTP）配置
func GetEmailConfig() *utils.EmailConfig {
	return &utils.EmailConfig{
		Enable:   config.Bool("email_enable"),
		Host:     config.String("email_host"),
		Port:     config.Int("email_port"),
		SSL:      config.Bool("email_ssl"),
		Username: config.String("email_username"),
		Password: config.String("email_password"),
		Address:  config.String("email_address"),
	}
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
		Host: normalizeAPIHost(config.String("qweather_api_host")),
		Key:  config.String("qweather_api_key"),
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

func GetMaximumReplyDepth() int { return config.Int("max_reply_depth") }

// GetCommentMaxLength 单条评论的字符上限（后台可配置，默认 500）
func GetCommentMaxLength() int {
	if n := config.Int("comment_max_length"); n > 0 {
		return n
	}
	return config.CommentMaxLengthDefault
}

// GetCommentCollapsedLines 评论正文超过多少行时先折叠，其余展开阅读（后台可配置，默认 6）
func GetCommentCollapsedLines() int {
	if n := config.Int("comment_collapsed_lines"); n > 0 {
		return n
	}
	return config.CommentCollapsedLinesDefault
}

// GetRssLimit RSS 输出的文章数
func GetRssLimit() int { return config.Int("rss_limit") }

// GetSitemapLimit 站点地图中每类条目（文章、页面等）的数量上限
func GetSitemapLimit() int { return config.Int("sitemap_limit") }

// 每篇文章 / 页面最多保留的历史版本数，超出的旧版本自动清理
const (
	RevisionMaxKeepDefault = config.RevisionMaxKeepDefault
	RevisionMaxKeepMin     = config.RevisionMaxKeepMin
	RevisionMaxKeepMax     = config.RevisionMaxKeepMax
)

// GetRevisionMaxKeep 历史版本保留上限
func GetRevisionMaxKeep() int { return config.Int("revision_max_keep") }

// GetAuthDurations 访问令牌与刷新令牌的有效期：环境变量 TOKEN_DURATION / REFRESH_TOKEN_DURATION / REFRESH_TOKEN_DURATION_WITH_REMEMBER（秒）优先，
// 其次是后台配置 token_duration（秒）、refresh_token_days、refresh_token_remember_days（天），都没有时用默认值（300 秒 / 7 天 / 30 天）；
// 超出取值范围时取边界值（环境变量也按配置的范围换算后截断）
func GetAuthDurations() utils.JwtDurations {
	day := 24 * time.Hour
	pick := func(key string, unit time.Duration) time.Duration {
		item := config.Lookup(key)
		if env, ok := item.EnvValue(); ok {
			if seconds, _ := strconv.Atoi(env); seconds > 0 {
				lo, hi := time.Duration(*item.Min)*unit, time.Duration(*item.Max)*unit
				return min(max(time.Duration(seconds)*time.Second, lo), hi)
			}
		}
		return time.Duration(config.Int(key)) * unit
	}
	return utils.JwtDurations{
		Access:          pick("token_duration", time.Second),
		Refresh:         pick("refresh_token_days", day),
		RefreshRemember: pick("refresh_token_remember_days", day),
	}
}

// AIAgentConfig AI 用户的全站配置
type AIAgentConfig struct {
	Enabled            bool
	ModelAmbient       string // 留空时使用 ai_model
	ModelExpert        string
	LLMCallsPerHour    int
	MonthlyTokenBudget int // 0 为不限
	CommentsPerDay     int
	LikesPerDay        int
	CommentsPerPost    int
	AIRatio            float64
	RepliesPerHuman    int // 每条真人评论最多被 AI 直接回复几次（单独计数，不占单篇的 AI 评论名额）
	PublishFanout      int
	QuietHours         string
	MaxChainDepth      int
	PairExchanges      int
	MentionsPerPair    int // 同一用户每天 @ 同一个 AI 最多唤醒几次（管理员不受限）
	MentionsPerUser    int // 同一用户每小时 @ 全部 AI 最多唤醒几次（管理员不受限）
	ProfileSelfEdit    bool
	MemoryDaysAmbient  int
	MemoryDaysExpert   int
	RunRetentionDays   int
}

// GetAIAgentConfig 读取 AI 用户的全站配置
func GetAIAgentConfig() AIAgentConfig {
	return AIAgentConfig{
		Enabled:            config.Bool("ai_agents_enabled"),
		ModelAmbient:       strings.TrimSpace(config.String("ai_agent_model_ambient")),
		ModelExpert:        strings.TrimSpace(config.String("ai_agent_model_expert")),
		LLMCallsPerHour:    config.Int("ai_agents_llm_calls_per_hour"),
		MonthlyTokenBudget: config.Int("ai_agents_monthly_token_budget"),
		CommentsPerDay:     config.Int("ai_agents_comments_per_day"),
		LikesPerDay:        config.Int("ai_agents_likes_per_day"),
		CommentsPerPost:    config.Int("ai_agents_comments_per_post"),
		AIRatio:            config.Float("ai_agents_ai_ratio"),
		RepliesPerHuman:    config.Int("ai_agents_replies_per_human_comment"),
		PublishFanout:      config.Int("ai_agents_publish_fanout"),
		QuietHours:         strings.TrimSpace(config.String("ai_agents_quiet_hours")),
		MaxChainDepth:      config.Int("ai_agents_max_chain_depth"),
		PairExchanges:      config.Int("ai_agents_pair_exchanges"),
		MentionsPerPair:    config.Int("ai_agents_mentions_per_pair_per_day"),
		MentionsPerUser:    config.Int("ai_agents_mentions_per_user_per_hour"),
		ProfileSelfEdit:    config.Bool("ai_agents_profile_self_edit"),
		MemoryDaysAmbient:  config.Int("ai_agents_memory_days_ambient"),
		MemoryDaysExpert:   config.Int("ai_agents_memory_days_expert"),
		RunRetentionDays:   config.Int("ai_agents_run_retention_days"),
	}
}
