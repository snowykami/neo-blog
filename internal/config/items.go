package config

import (
	"strings"

	"github.com/snowykami/neo-blog/pkg/constant"
)

// 这里声明全部后台配置。字段说明见 Item；Label / Description 等为前端 Console.global 下的 i18n 键，新增配置时同步补充 5 种语言的文案

// 每篇文章 / 页面最多保留的历史版本数，超出的旧版本自动清理
const (
	RevisionMaxKeepDefault = 50
	RevisionMaxKeepMin     = 10
	RevisionMaxKeepMax     = 500
)

// NCMSongLevels 网易云播放音质（song/url/v1 的 level），只提供浏览器可以直接播放的格式：
// standard 128k、higher 192k、exhigh 320k（默认）、lossless 无损 FLAC、hires Hi-Res FLAC
var NCMSongLevels = []string{"standard", "higher", "exhigh", "lossless", "hires"}

var tabs = []Tab{
	{Key: "site", Title: "tab_site"},
	{Key: "content", Title: "tab_content"},
	{Key: "frontend", Title: "tab_frontend"},
	{Key: "account", Title: "tab_account"},
	{Key: "ai", Title: "tab_ai"},
	{Key: "rss", Title: "tab_rss"},
}

// 站点内置的配色方案，对应前端 app/styles 下的主题文件
var colorSchemes = []string{"blue", "green", "orange", "red", "pink", "rose", "violet", "yellow"}

var sections = []*Section{
	{Tab: "site", Key: "site", Title: "section_site", Description: "section_site_desc", Items: []*Item{
		{Key: "site_name", Type: TypeString, Label: "site_name", Default: "Snowykami's Blog", siteInfoPath: path("metadata.name"), mirror: same},
		{Key: "base_url", Type: TypeURL, Label: "base_url", Description: "base_url_desc", Default: constant.DefaultBaseUrl, Env: constant.EnvKeyBaseUrl, siteInfoPath: path("base_url"), mirror: same},
		{Key: "site_description", Type: TypeText, Label: "site_description", Wide: true, Default: "A neo blog system", siteInfoPath: path("metadata.description"), mirror: same},
		// 站点语言：文章主要使用的语言。没有语言偏好的访客（不带 Accept-Language 的请求，如搜索引擎爬虫）按它显示界面，
		// 也是 RSS 订阅源的语言。取值与界面支持的语言对应（zh / zh-tw / ja / en / ko）
		{Key: "default_language", Type: TypeEnum, Label: "site_language", Description: "site_language_desc", Options: options([]string{"zh-cn", "zh-tw", "en-us", "ja-jp", "ko-kr"}, ""), Default: "zh-cn"},
		{Key: "site_icon", Type: TypeImage, Label: "site_icon", Default: "https://cdn.liteyuki.org/snowykami/avatar_alpha.png", siteInfoPath: path("metadata.icon"), mirror: same},
		{Key: "keywords", Type: TypeStringList, Label: "keywords", PlaceholderKey: "keyword_placeholder", Default: []string{}, siteInfoPath: path("keywords")},
		// 前台随机使用其中一张；RSS 的默认封面只支持单张，独立配置键只写第一张
		{Key: "default_cover", Type: TypeImageList, Label: "default_covers", Description: "default_covers_desc", Default: []string{
			"https://cdn.liteyuki.org/snowykami/image/1759709826590.webp",
			"https://cdn.liteyuki.org/snowykami/image/1759710439228.webp",
			"https://cdn.liteyuki.org/snowykami/image/1759710339517.webp",
			"https://cdn.liteyuki.org/snowykami/image/furina.png",
			"https://cdn.liteyuki.org/snowykami/image/1759710500693.webp",
		}, siteInfoPath: path("default_cover"), mirror: first},
	}},
	{Tab: "site", Key: "owner", Title: "section_owner", Items: []*Item{
		{Key: "owner_name", Type: TypeString, Label: "owner_name", Default: "SnowyKami", siteInfoPath: path("owner.name")},
		{Key: "owner_motto", Type: TypeString, Label: "owner_motto", Default: "", siteInfoPath: path("owner.motto")},
		{Key: "owner_description", Type: TypeText, Label: "owner_description", Wide: true, Default: "A full-stack developer.", siteInfoPath: path("owner.description")},
		{Key: "owner_avatar", Type: TypeImage, Label: "owner_avatar", Default: "https://cdn.liteyuki.org/snowykami/avatar.jpg", siteInfoPath: path("owner.avatar")},
		{Key: "owner_gravatar_email", Type: TypeEmail, Label: "owner_gravatar_email", Description: "owner_gravatar_email_desc", Default: "", siteInfoPath: path("owner.gravatar_email")},
	}},

	{Tab: "content", Key: "appearance", Title: "section_appearance", Widget: "theme_preview", Items: []*Item{
		{Key: "color_schemes", Type: TypeStringList, Widget: "color_schemes", Label: "color_schemes", Description: "color_schemes_desc", Options: options(colorSchemes, ""), Default: []string{"blue", "green", "orange", "red", "rose", "pink", "violet", "yellow"}, siteInfoPath: path("color_schemes")},
		{Key: "default_color_scheme", Type: TypeEnum, Widget: "color_scheme", Label: "default_color_scheme", Options: options(colorSchemes, ""), Default: "blue", siteInfoPath: path("default_color_scheme")},
		{Key: "content_theme", Type: TypeEnum, Label: "content_theme", Description: "content_theme_desc", Options: options(ContentThemes, "content_theme_"), Default: ContentThemes[0], siteInfoPath: path("content_theme")},
		{Key: "animation_duration_second", Type: TypeFloat, Label: "animation_duration", Description: "animation_duration_desc", Min: num(0), Max: num(3), Default: 0.618, siteInfoPath: path("animation_duration_second")},
	}},
	{Tab: "content", Key: "page_background", Title: "page_background", Items: []*Item{
		{Key: "page_background_image", Type: TypeImage, Label: "page_background_image", Description: "page_background_image_desc", Default: "", siteInfoPath: path("page_background.image")},
		{Key: "page_background_decorations", Type: TypeBool, Label: "page_background_decorations", Description: "page_background_decorations_desc", Default: true, siteInfoPath: path("page_background.decorations")},
		{Key: "page_background_blur", Type: TypeInt, Label: "page_background_blur", Description: "page_background_blur_desc", Min: num(0), Max: num(40), Default: 0, siteInfoPath: path("page_background.blur")},
		{Key: "page_background_opacity", Type: TypeFloat, Label: "page_background_opacity", Description: "page_background_opacity_desc", Min: num(0), Max: num(1), Step: 0.05, Default: 1.0, siteInfoPath: path("page_background.opacity")},
		{Key: "page_background_veil", Type: TypeFloat, Label: "page_background_veil", Description: "page_background_veil_desc", Min: num(0), Max: num(1), Step: 0.05, Default: 0.72, siteInfoPath: path("page_background.veil")},
		{Key: "page_background_veil_color", Type: TypeColor, Label: "page_background_veil_color", Description: "page_background_veil_color_desc", Default: "", siteInfoPath: path("page_background.veil_color")},
	}},
	{Tab: "content", Key: "content", Title: "section_content", Items: []*Item{
		{Key: "posts_per_page", Type: TypeInt, Label: "posts_per_page", Min: num(1), Max: num(100), Default: 10, siteInfoPath: path("posts_per_page")},
		{Key: "comments_per_page", Type: TypeInt, Label: "comments_per_page", Min: num(1), Max: num(100), Default: 10, siteInfoPath: path("comments_per_page")},
		{Key: "max_reply_depth", Type: TypeInt, Label: "max_reply_depth", Description: "max_reply_depth_desc", Min: num(1), Max: num(10), Default: constant.MaxReplyDepthDefault, Env: constant.EnvKeyMaxReplyDepth},
		{Key: "revision_max_keep", Type: TypeInt, Label: "revision_max_keep", Description: "revision_max_keep_desc", Min: num(RevisionMaxKeepMin), Max: num(RevisionMaxKeepMax), Default: RevisionMaxKeepDefault},
		// 站点地图协议单个文件最多 50000 条
		{Key: "sitemap_limit", Type: TypeInt, Label: "sitemap_limit", Description: "sitemap_limit_desc", Min: num(1), Max: num(50000), Default: constant.DefaultSitemapLimit, Env: constant.EnvKeySitemapLimit},
		{Key: "copyright", Type: TypeString, Label: "copyright", Placeholder: "CC BY-NC-SA 4.0", Default: "", siteInfoPath: path("copyright")},
		{Key: "copyright_link", Type: TypeURL, Label: "copyright_link", Default: "", siteInfoPath: path("copyright_link")},
	}},
	{Tab: "content", Key: "footer", Title: "section_footer", Items: []*Item{
		{Key: "footer_text", Type: TypeString, Label: "footer_text", Wide: true, Default: "Liteyuki ICP 114514", siteInfoPath: path("footer.text")},
		{Key: "footer_links", Type: TypeLinkList, Label: "footer_links", Default: []map[string]any{}, siteInfoPath: path("footer.links")},
	}},

	{Tab: "frontend", Key: "personalize", Title: "section_personalize", Description: "section_personalize_desc", Items: []*Item{
		{Key: "about_background", Type: TypeImage, Label: "about_background", Description: "empty_to_hide", Default: "https://cdn.liteyuki.org/snowykami/dark_2.png", siteInfoPath: path("about_background")},
		{Key: "enable_third_party_script", Type: TypeBool, Label: "enable_third_party_script", Description: "enable_third_party_script_desc", Default: true, siteInfoPath: path("enable_third_party_script")},
	}},
	{Tab: "frontend", Key: "sidebar", Title: "section_sidebar", Description: "section_sidebar_desc", Items: []*Item{
		// 未配置时前台按默认卡片展示（含旧的嵌入页面配置），由前端组件补全
		{Key: "sidebar_cards", Type: TypeJSON, Widget: "sidebar_cards", Label: "sidebar_cards", Description: "sidebar_cards_desc", Default: nil, siteInfoPath: path("sidebar_cards")},
	}},
	{Tab: "frontend", Key: "music", Title: "section_music", Description: "section_music_desc", Items: []*Item{
		{Key: "music_source", Type: TypeEnum, Label: "music_source", Options: []Option{{Value: "static", Label: "music_source_static"}, {Value: "ncm", Label: "music_source_ncm"}}, Default: "static", siteInfoPath: path("music_source")},
		{Key: "music_playlist_url", Type: TypeURL, Label: "music_playlist_url", Description: "music_playlist_url_desc", Default: "https://cdn.liteyuki.org/snowykami/music/playlists/favorite.json", ShowWhen: when("music_source", "static"), siteInfoPath: path("music_playlist_url")},
		{Key: "ncm_api_base_url", Type: TypeURL, Label: "ncm_api_base_url", Description: "ncm_api_base_url_desc", Placeholder: "https://ncm-api.example.com", Default: "", ShowWhen: when("music_source", "ncm")},
		{Key: "ncm_cookie", Type: TypeSecret, Label: "ncm_cookie", Description: "ncm_cookie_desc", Placeholder: "MUSIC_U=...", Wide: true, Default: "", ShowWhen: when("music_source", "ncm")},
		// 用当前填写的 API 地址与 Cookie 读取账号歌单，选择其一作为博客歌单
		{Key: "ncm_playlist_id", Type: TypeInt, Widget: "ncm_playlist", Label: "ncm_playlist", Description: "ncm_playlist_desc", Min: num(0), Default: 0, ShowWhen: when("music_source", "ncm")},
		{Key: "ncm_song_level", Type: TypeEnum, Label: "ncm_song_level", Description: "ncm_song_level_desc", Options: options(NCMSongLevels, "ncm_song_level_"), Default: "exhigh", ShowWhen: when("music_source", "ncm")},
		// 自定义 TTML 歌词源，按顺序探测（见 ttml_sources.go）
		{Key: "music_ttml_sources", Type: TypeJSON, Widget: "ttml_sources", Label: "music_ttml_sources", Description: "music_ttml_sources_desc", Placeholder: "https://cdn.example.com/lyrics/{song_id}.ttml", Default: []MusicTTMLSource{}, Env: constant.EnvKeyMusicTTMLURL, decode: decodeMusicTTMLSources},
	}},
	// 顶栏灵动岛（实验性）：顶栏标题区按当前情境显示的内容，各项可单独关闭；总开关关闭时标题区只显示站名
	{Tab: "frontend", Key: "island", Title: "section_island", Description: "section_island_desc", Items: []*Item{
		{Key: "island_enabled", Type: TypeBool, Label: "island_enabled", Description: "island_enabled_desc", Default: true, siteInfoPath: path("island.enabled")},
		{Key: "island_expand", Type: TypeBool, Label: "island_expand", Description: "island_expand_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.expand")},
		{Key: "island_music", Type: TypeBool, Label: "island_music", Description: "island_music_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.music")},
		{Key: "island_music_peek", Type: TypeBool, Label: "island_music_peek", Description: "island_music_peek_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.music_peek")},
		{Key: "island_music_paused", Type: TypeBool, Label: "island_music_paused", Description: "island_music_paused_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.music_paused")},
		{Key: "island_music_beat", Type: TypeBool, Label: "island_music_beat", Description: "island_music_beat_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.music_beat")},
		{Key: "island_music_chorus", Type: TypeBool, Label: "island_music_chorus", Description: "island_music_chorus_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.music_chorus")},
		{Key: "island_reading", Type: TypeBool, Label: "island_reading", Description: "island_reading_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.reading")},
		{Key: "island_reading_finish", Type: TypeBool, Label: "island_reading_finish", Description: "island_reading_finish_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.reading_finish")},
		{Key: "island_feedback", Type: TypeBool, Label: "island_feedback", Description: "island_feedback_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.feedback")},
		{Key: "island_upload", Type: TypeBool, Label: "island_upload", Description: "island_upload_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.upload")},
		{Key: "island_update", Type: TypeBool, Label: "island_update", Description: "island_update_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.update")},
		{Key: "island_network", Type: TypeBool, Label: "island_network", Description: "island_network_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.network")},
		{Key: "island_holiday", Type: TypeBool, Label: "island_holiday", Description: "island_holiday_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.holiday")},
		{Key: "island_greeting", Type: TypeBool, Label: "island_greeting", Description: "island_greeting_desc", Default: true, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.greeting")},
		// 问候时附带访客所在城市的天气：按 IP 粗略定位（城市级，不保存）并多一次天气请求，默认关闭
		{Key: "island_weather", Type: TypeBool, Label: "island_weather", Description: "island_weather_desc", Default: false, ShowWhen: when("island_enabled", "true"), siteInfoPath: path("island.weather")},
	}},
	{Tab: "frontend", Key: "weather", Title: "section_weather", Description: "section_weather_desc", Items: []*Item{
		{Key: "qweather_api_host", Type: TypeString, Label: "qweather_api_host", Description: "qweather_api_host_desc", Placeholder: "abc123xyz.re.qweatherapi.com", Default: ""},
		{Key: "qweather_api_key", Type: TypeSecret, Label: "qweather_api_key", Description: "qweather_api_key_desc", Default: ""},
	}},

	{Tab: "account", Key: "account", Title: "section_account", Items: []*Item{
		{Key: "enable_register", Type: TypeBool, Label: "enable_register", Description: "enable_register_desc", Default: false, Env: constant.EnvKeyEnableRegister},
		{Key: "enable_register_from_oidc", Type: TypeBool, Label: "enable_register_from_oidc", Description: "enable_register_from_oidc_desc", Default: true, Env: constant.EnvKeyEnableRegisterFromOidc},
		{Key: "verify_code_cool_down", Type: TypeInt, Label: "verify_code_cool_down", Description: "seconds", Min: num(10), Max: num(3600), Default: 60, siteInfoPath: path("verify_code_cool_down")},
	}},
	{Tab: "account", Key: "token", Title: "section_token", Description: "section_token_desc", Items: []*Item{
		// 令牌有效期的环境变量单位为秒，由 tools.GetAuthDurations 读取
		{Key: "token_duration", Type: TypeInt, Label: "token_duration", Description: "token_duration_desc", Min: num(30), Max: num(24 * 60 * 60), Default: 300, Env: constant.EnvKeyTokenDuration, EnvUnit: "seconds", envCustom: true},
		{Key: "refresh_token_days", Type: TypeInt, Label: "refresh_token_days", Description: "refresh_token_days_desc", Min: num(1), Max: num(365), Default: 7, Env: constant.EnvKeyRefreshTokenDuration, EnvUnit: "seconds", envCustom: true},
		{Key: "refresh_token_remember_days", Type: TypeInt, Label: "refresh_token_remember_days", Description: "refresh_token_remember_days_desc", Min: num(1), Max: num(365), Default: 30, Env: constant.EnvKeyRefreshTokenDurationWithRemember, EnvUnit: "seconds", envCustom: true},
	}},
	{Tab: "account", Key: "captcha", Title: "section_captcha", Description: "section_captcha_desc", Items: []*Item{
		{Key: "captcha_provider", Type: TypeEnum, Label: "captcha_provider", Options: options([]string{constant.CaptchaTypeDisable, constant.CaptchaTypeTurnstile, constant.CaptchaTypeHCaptcha, constant.CaptchaTypeReCaptcha}, "captcha_provider_"), Default: constant.CaptchaTypeDisable, Env: constant.EnvKeyCaptchaProvider},
		{Key: "captcha_site_key", Type: TypeString, Label: "captcha_site_key", Description: "captcha_site_key_desc", Default: "", Env: constant.EnvKeyCaptchaSiteKey},
		{Key: "captcha_secret_key", Type: TypeSecret, Label: "captcha_secret_key", Description: "captcha_secret_key_desc", Wide: true, Default: "", Env: constant.EnvKeyCaptchaSecreteKey},
	}},
	// 组内最前面是发送测试邮件的组件：用它确认当前填写的 SMTP 配置可用，不需要先保存
	{Tab: "account", Key: "email", Title: "section_email", Description: "section_email_desc", Widget: "email_test", Items: []*Item{
		{Key: "email_enable", Type: TypeBool, Label: "email_enable", Description: "email_enable_desc", Default: false, Env: constant.EnvKeyEmailEnable},
		{Key: "email_host", Type: TypeString, Label: "email_host", Placeholder: "smtp.example.com", Default: "", Env: constant.EnvKeyEmailHost},
		{Key: "email_port", Type: TypeInt, Label: "email_port", Description: "email_port_desc", Min: num(1), Max: num(65535), Default: 587, Env: constant.EnvKeyEmailPort},
		{Key: "email_ssl", Type: TypeBool, Label: "email_ssl", Description: "email_ssl_desc", Default: true, Env: constant.EnvKeyEmailSsl},
		{Key: "email_username", Type: TypeString, Label: "email_username", Default: "", Env: constant.EnvKeyEmailUsername},
		{Key: "email_password", Type: TypeSecret, Label: "email_password", Description: "email_password_desc", Default: "", Env: constant.EnvKeyEmailPassword},
		{Key: "email_address", Type: TypeEmail, Label: "email_address", Description: "email_address_desc", Placeholder: "noreply@example.com", Default: "", Env: constant.EnvKeyEmailAddress},
	}},
	// 站内互动通知：站内通知始终即时送达，这里的配置只影响邮件汇总（见 docs/notification-spec.md）
	{Tab: "account", Key: "notification", Title: "section_notification", Description: "section_notification_desc", Items: []*Item{
		{Key: "notification_email_enable", Type: TypeBool, Label: "notification_email_enable", Description: "notification_email_enable_desc", Default: false},
		// 重要类型同时是用户可选的「上限」：用户只能在这个集合里关，不能开站点没开的类型；点赞与线程活动永远只是附带，不进这个列表
		{Key: "notification_email_types", Type: TypeStringList, Label: "notification_email_types", Description: "notification_email_types_desc", Options: []Option{
			{Value: constant.NotificationTypeCommentCreated, Label: "notification_type_comment_created"},
			{Value: constant.NotificationTypeCommentReplied, Label: "notification_type_comment_replied"},
		}, Default: []string{constant.NotificationTypeCommentCreated, constant.NotificationTypeCommentReplied}},
		{Key: "notification_email_interval", Type: TypeInt, Label: "notification_email_interval", Description: "notification_email_interval_desc", Min: num(0), Max: num(1440), Default: 10},
		{Key: "notification_email_attach_hours", Type: TypeInt, Label: "notification_email_attach_hours", Description: "notification_email_attach_hours_desc", Min: num(1), Max: num(720), Default: 24},
		{Key: "notification_email_attach_max", Type: TypeInt, Label: "notification_email_attach_max", Description: "notification_email_attach_max_desc", Min: num(0), Max: num(50), Default: 5},
		{Key: "notification_email_max_items", Type: TypeInt, Label: "notification_email_max_items", Description: "notification_email_max_items_desc", Min: num(1), Max: num(50), Default: 10},
		{Key: "notification_email_hourly_limit", Type: TypeInt, Label: "notification_email_hourly_limit", Description: "notification_email_hourly_limit_desc", Min: num(1), Max: num(1000), Default: 20},
		{Key: "notification_thread_include_author", Type: TypeBool, Label: "notification_thread_include_author", Description: "notification_thread_include_author_desc", Default: true},
		{Key: "notification_retention_days", Type: TypeInt, Label: "notification_retention_days", Description: "notification_retention_days_desc", Min: num(7), Max: num(3650), Default: 180},
	}},
	{Tab: "account", Key: "visit", Title: "section_visit", Items: []*Item{
		{Key: "visit_log_retention_days", Type: TypeInt, Label: "visit_log_retention_days", Description: "visit_log_retention_days_desc", Min: num(1), Max: num(3650), Default: 90},
		{Key: "visit_fingerprint_attribution", Type: TypeBool, Label: "visit_fingerprint_attribution", Description: "visit_fingerprint_attribution_desc", Default: true},
	}},
	{Tab: "account", Key: "error_report", Title: "section_error_report", Description: "section_error_report_desc", Items: []*Item{
		{Key: "error_report_enabled", Type: TypeBool, Label: "error_report_enabled", Description: "error_report_enabled_desc", Default: true},
		{Key: "error_report_retention_days", Type: TypeInt, Label: "error_report_retention_days", Description: "error_report_retention_days_desc", Min: num(1), Max: num(365), Default: 30},
	}},

	{Tab: "ai", Key: "ai", Title: "section_ai", Description: "section_ai_desc", Items: []*Item{
		{Key: "ai_api_base_url", Type: TypeURL, Label: "ai_api_base_url", Description: "ai_api_base_url_desc", Placeholder: "https://api.openai.com/v1", Default: ""},
		{Key: "ai_model", Type: TypeString, Label: "ai_model", Description: "ai_model_desc", Placeholder: "gpt-4o-mini / deepseek-chat", Default: ""},
		{Key: "ai_api_key", Type: TypeSecret, Label: "ai_api_key", Description: "ai_api_key_desc", Wide: true, Default: ""},
		{Key: "ai_summary_concurrency", Type: TypeInt, Label: "ai_summary_concurrency", Description: "ai_summary_concurrency_desc", Min: num(1), Max: num(20), Default: 3},
		{Key: "ai_writing_style", Type: TypeText, Label: "ai_writing_style", Description: "ai_writing_style_desc", PlaceholderKey: "ai_writing_style_placeholder", Rows: 6, Wide: true, Default: ""},
		{Key: "lyric_annotation_ttl_days", Type: TypeInt, Label: "lyric_annotation_ttl_days", Description: "lyric_annotation_ttl_days_desc", Min: num(1), Max: num(365), Default: 7},
	}},
	// AI 用户：由 Agent 驱动、与普通用户同权限的账号；模型使用上面的 AI 配置
	{Tab: "ai", Key: "ai_agents", Title: "section_ai_agents", Description: "section_ai_agents_desc", Items: []*Item{
		{Key: "ai_agents_enabled", Type: TypeBool, Label: "ai_agents_enabled", Description: "ai_agents_enabled_desc", Default: false},
		{Key: "ai_agent_model_ambient", Type: TypeString, Label: "ai_agent_model_ambient", Description: "ai_agent_model_ambient_desc", Default: ""},
		{Key: "ai_agent_model_expert", Type: TypeString, Label: "ai_agent_model_expert", Description: "ai_agent_model_expert_desc", Default: ""},
		{Key: "ai_agents_llm_calls_per_hour", Type: TypeInt, Label: "ai_agents_llm_calls_per_hour", Description: "ai_agents_llm_calls_per_hour_desc", Min: num(1), Max: num(100000), Default: 200},
		{Key: "ai_agents_monthly_token_budget", Type: TypeInt, Label: "ai_agents_monthly_token_budget", Description: "ai_agents_monthly_token_budget_desc", Min: num(0), Max: num(1e12), Default: 20000000},
		{Key: "ai_agents_comments_per_day", Type: TypeInt, Label: "ai_agents_comments_per_day", Description: "ai_agents_comments_per_day_desc", Min: num(0), Max: num(100000), Default: 60},
		{Key: "ai_agents_likes_per_day", Type: TypeInt, Label: "ai_agents_likes_per_day", Description: "ai_agents_likes_per_day_desc", Min: num(0), Max: num(1000000), Default: 600},
		{Key: "ai_agents_comments_per_post", Type: TypeInt, Label: "ai_agents_comments_per_post", Description: "ai_agents_comments_per_post_desc", Min: num(0), Max: num(1000), Default: 3},
		{Key: "ai_agents_ai_ratio", Type: TypeFloat, Label: "ai_agents_ai_ratio", Description: "ai_agents_ai_ratio_desc", Min: num(0), Max: num(100), Step: 0.5, Default: 2.0},
		{Key: "ai_agents_replies_per_human_comment", Type: TypeInt, Label: "ai_agents_replies_per_human_comment", Description: "ai_agents_replies_per_human_comment_desc", Min: num(0), Max: num(100), Default: 2},
		{Key: "ai_agents_publish_fanout", Type: TypeInt, Label: "ai_agents_publish_fanout", Description: "ai_agents_publish_fanout_desc", Min: num(0), Max: num(1000), Default: 8},
		{Key: "ai_agents_quiet_hours", Type: TypeString, Label: "ai_agents_quiet_hours", Description: "ai_agents_quiet_hours_desc", Placeholder: "02:00-07:00", Default: ""},
		{Key: "ai_agents_max_chain_depth", Type: TypeInt, Label: "ai_agents_max_chain_depth", Description: "ai_agents_max_chain_depth_desc", Min: num(1), Max: num(10), Default: 5},
		{Key: "ai_agents_pair_exchanges", Type: TypeInt, Label: "ai_agents_pair_exchanges", Description: "ai_agents_pair_exchanges_desc", Min: num(0), Max: num(100), Default: 2},
		{Key: "ai_agents_profile_self_edit", Type: TypeBool, Label: "ai_agents_profile_self_edit", Description: "ai_agents_profile_self_edit_desc", Default: true},
		{Key: "ai_agents_memory_days_ambient", Type: TypeInt, Label: "ai_agents_memory_days_ambient", Description: "ai_agents_memory_days_ambient_desc", Min: num(1), Max: num(3650), Default: 30},
		{Key: "ai_agents_memory_days_expert", Type: TypeInt, Label: "ai_agents_memory_days_expert", Description: "ai_agents_memory_days_expert_desc", Min: num(1), Max: num(3650), Default: 180},
		{Key: "ai_agents_run_retention_days", Type: TypeInt, Label: "ai_agents_run_retention_days", Description: "ai_agents_run_retention_days_desc", Min: num(1), Max: num(3650), Default: 90},
	}},

	{Tab: "rss", Key: "rss", Title: "section_rss", Description: "section_rss_desc", Items: []*Item{
		{Key: "site_title", Type: TypeString, Label: "rss_title", Default: ""},
		{Key: "site_author", Type: TypeString, Label: "rss_author", Default: ""},
		{Key: "site_copyright", Type: TypeString, Label: "rss_copyright", Default: ""},
		{Key: "site_image", Type: TypeImage, Label: "rss_image", Default: ""},
		{Key: "rss_limit", Type: TypeInt, Label: "rss_limit", Description: "rss_limit_desc", Min: num(1), Max: num(500), Default: constant.DefaultRssLimit, Env: constant.EnvKeyRssLimit},
	}},
}

// crossChecks 涉及多项配置的保存校验：keys 中任一项被修改时执行，get 取保存后实际生效的值，返回错误码
var crossChecks = []struct {
	keys  []string
	check func(get func(key string) any) string
}{
	{
		// 启用人机验证却缺少 Key 时所有人都无法用密码登录（包括管理员）
		keys: []string{"captcha_provider", "captcha_site_key", "captcha_secret_key"},
		check: func(get func(string) any) string {
			if get("captcha_provider") != constant.CaptchaTypeDisable && (get("captcha_site_key") == "" || get("captcha_secret_key") == "") {
				return "captcha_keys_required"
			}
			return ""
		},
	},
}

func num(v float64) *float64 { return &v }

func path(p string) []string { return strings.Split(p, ".") }

func same(v any) any { return v }

// first 列表的第一项，空列表为空字符串
func first(v any) any {
	if list, _ := v.([]string); len(list) > 0 {
		return list[0]
	}
	return ""
}

// options 可选值；labelPrefix 非空时文案的 i18n 键为前缀加取值，否则直接显示取值
func options(values []string, labelPrefix string) []Option {
	opts := make([]Option, 0, len(values))
	for _, v := range values {
		opt := Option{Value: v}
		if labelPrefix != "" {
			opt.Label = labelPrefix + v
		}
		opts = append(opts, opt)
	}
	return opts
}

func when(key string, values ...string) *Condition {
	return &Condition{Key: key, Values: values}
}
