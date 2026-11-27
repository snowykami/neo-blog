package config

import (
	"strings"

	"github.com/snowykami/neo-blog/pkg/constant"
)

// 这里声明全部后台配置。字段说明见 Item；Label / Description 等为前端 Console.global 下的 i18n 键，新增配置时同步补充各语言的文案（zh / zh-tw / en / ja / ko；地区变体只写与上一级不同的条目）

// 每篇文章 / 页面最多保留的历史版本数，超出的旧版本自动清理
const (
	RevisionMaxKeepDefault = 50
	RevisionMaxKeepMin     = 10
	RevisionMaxKeepMax     = 500
)

// 评论正文的字符上限与折叠展示行数（后台可调，前台输入框与评论列表据此渲染）
const (
	CommentMaxLengthDefault      = 500
	CommentMaxLengthMax          = 10000
	CommentCollapsedLinesDefault = 6
	CommentCollapsedLinesMax     = 50
)

// NCMSongLevels 网易云播放音质（song/url/v1 的 level），只提供浏览器可以直接播放的格式：
// standard 128k、higher 192k、exhigh 320k（默认）、lossless 无损 FLAC、hires Hi-Res FLAC
var NCMSongLevels = []string{"standard", "higher", "exhigh", "lossless", "hires"}

var tabs = []Tab{
	{Key: "site", Title: "tab_site"},
	{Key: "seo", Title: "tab_seo"},
	{Key: "appearance", Title: "tab_appearance"},
	{Key: "content", Title: "tab_content"},
	{Key: "account", Title: "tab_account"},
	{Key: "ai", Title: "tab_ai"},
}

// 站点内置的配色方案，对应前端 app/styles 下的主题文件
var colorSchemes = []string{"blue", "green", "orange", "red", "pink", "rose", "violet", "yellow"}

// 各 AI 任务可选的思考强度；空值表示继承模型默认行为
var aiThinkingModes = []Option{
	{Value: "", Label: "ai_thinking_mode_default"},
	{Value: "none", Label: "ai_thinking_mode_none"},
	{Value: "low", Label: "ai_thinking_mode_low"},
	{Value: "medium", Label: "ai_thinking_mode_medium"},
	{Value: "high", Label: "ai_thinking_mode_high"},
}

// 站点信息相关的默认值是开源项目的中性占位（站名、站长、图标、封面、页脚等），新站点在后台填写自己的信息；
// 已保存过站点信息的站点不受默认值变化影响（升级前的默认值由迁移 2026111150 补进已保存的站点信息）
var sections = []*Section{
	// ---- 站点与站长 ----
	{Tab: "site", Key: "site", Title: "section_site", Description: "section_site_desc", Items: []*Item{
		{Key: "site_name", Type: TypeString, Label: "site_name", Default: "My Blog", siteInfoPath: path("metadata.name"), mirror: same},
		{Key: "base_url", Type: TypeURL, Label: "base_url", Description: "base_url_desc", Default: constant.DefaultBaseUrl, Env: constant.EnvKeyBaseUrl, siteInfoPath: path("base_url"), mirror: same},
		{Key: "site_description", Type: TypeText, Label: "site_description", Wide: true, Default: "A neo blog system", siteInfoPath: path("metadata.description"), mirror: same},
		// 站点语言：文章主要使用的语言，只用于 RSS 订阅源的 <language> 与验证码（含测试）邮件的语言。
		// 界面语言由地址里的语言前缀决定（不带前缀固定简体中文，见前端 i18n/routing.ts），通知邮件按收件人自己的语言发送，都不看它。
		// 取值与界面支持的语言对应（zh / zh-tw / ja / en / ko）
		{Key: "default_language", Type: TypeEnum, Label: "site_language", Description: "site_language_desc", Options: options([]string{"zh-cn", "zh-tw", "en-us", "ja-jp", "ko-kr"}, "site_language_"), Default: "zh-cn"},
		{Key: "site_icon", Type: TypeImage, Label: "site_icon", Default: "", siteInfoPath: path("metadata.icon"), mirror: same},
		{Key: "site_icon_radius", Type: TypeInt, Widget: "site_icon_radius", Label: "site_icon_radius", Description: "site_icon_radius_desc", Min: num(0), Max: num(50), Wide: true, Default: 22, siteInfoPath: path("metadata.icon_radius")},
		// 前台随机使用其中一张；RSS 的默认封面只支持单张，独立配置键只写第一张
		{Key: "default_cover", Type: TypeImageList, Label: "default_covers", Description: "default_covers_desc", Default: []string{}, siteInfoPath: path("default_cover"), mirror: first},
	}},
	{Tab: "site", Key: "owner", Title: "section_owner", Description: "section_owner_desc", Items: []*Item{
		{Key: "owner_name", Type: TypeString, Label: "owner_name", Default: "Blogger", siteInfoPath: path("owner.name")},
		{Key: "owner_motto", Type: TypeString, Label: "owner_motto", Default: "", siteInfoPath: path("owner.motto")},
		{Key: "owner_description", Type: TypeText, Label: "owner_description", Wide: true, Default: "", siteInfoPath: path("owner.description")},
		{Key: "owner_avatar", Type: TypeImage, Label: "owner_avatar", Default: "", siteInfoPath: path("owner.avatar")},
		{Key: "owner_gravatar_email", Type: TypeEmail, Label: "owner_gravatar_email", Description: "owner_gravatar_email_desc", Default: "", siteInfoPath: path("owner.gravatar_email")},
		{Key: "about_background", Type: TypeImage, Label: "about_background", Description: "empty_to_hide", Default: "", siteInfoPath: path("about_background")},
		{Key: "owner_links", Type: TypeJSON, Widget: "owner_links", Label: "owner_links", Description: "owner_links_desc", Default: []OwnerLink{}, siteInfoPath: path("owner.links"), decode: decodeOwnerLinks},
	}},
	{Tab: "site", Key: "footer", Title: "section_footer", Items: []*Item{
		{Key: "copyright", Type: TypeString, Label: "copyright", Placeholder: "CC BY-NC-SA 4.0", Default: "", siteInfoPath: path("copyright")},
		{Key: "copyright_link", Type: TypeURL, Label: "copyright_link", Default: "", siteInfoPath: path("copyright_link")},
		{Key: "footer_text", Type: TypeString, Label: "footer_text", Wide: true, Default: "", siteInfoPath: path("footer.text")},
		{Key: "footer_links", Type: TypeLinkList, Label: "footer_links", Default: []map[string]any{}, siteInfoPath: path("footer.links")},
	}},

	// ---- SEO 与订阅 ----
	{Tab: "seo", Key: "seo_meta", Title: "section_seo_meta", Description: "section_seo_meta_desc", Items: []*Item{
		{Key: "seo_home_title", Type: TypeString, Label: "seo_home_title", Description: "seo_home_title_desc", PlaceholderKey: "seo_inherit_site_placeholder", Default: "", siteInfoPath: path("seo.home_title")},
		{Key: "seo_twitter_handle", Type: TypeString, Label: "seo_twitter_handle", Description: "seo_twitter_handle_desc", Placeholder: "@username", Default: "", siteInfoPath: path("seo.twitter_handle")},
		{Key: "seo_twitter_card", Type: TypeEnum, Label: "seo_twitter_card", Description: "seo_twitter_card_desc", Options: options([]string{"summary_large_image", "summary"}, "seo_twitter_card_"), Default: "summary_large_image", siteInfoPath: path("seo.twitter_card")},
		{Key: "seo_home_description", Type: TypeText, Label: "seo_home_description", Description: "seo_home_description_desc", PlaceholderKey: "seo_inherit_desc_placeholder", Wide: true, Default: "", siteInfoPath: path("seo.home_description")},
		{Key: "keywords", Type: TypeStringList, Label: "keywords", Description: "seo_keywords_desc", PlaceholderKey: "keyword_placeholder", Default: []string{}, siteInfoPath: path("keywords")},
		{Key: "seo_og_image", Type: TypeImage, Label: "seo_og_image", Description: "seo_og_image_desc", Default: "", siteInfoPath: path("seo.og_image")},
	}},
	{Tab: "seo", Key: "seo_verification", Title: "section_seo_verification", Description: "section_seo_verification_desc", Items: []*Item{
		{Key: "seo_google_verification", Type: TypeString, Label: "seo_google_verification", Description: "seo_google_verification_desc", Default: "", siteInfoPath: path("seo.google_verification")},
		{Key: "seo_bing_verification", Type: TypeString, Label: "seo_bing_verification", Description: "seo_bing_verification_desc", Default: "", siteInfoPath: path("seo.bing_verification")},
		{Key: "seo_baidu_verification", Type: TypeString, Label: "seo_baidu_verification", Description: "seo_baidu_verification_desc", Default: "", siteInfoPath: path("seo.baidu_verification")},
	}},
	{Tab: "seo", Key: "seo_indexing", Title: "section_seo_indexing", Description: "section_seo_indexing_desc", Items: []*Item{
		{Key: "seo_allow_indexing", Type: TypeBool, Label: "seo_allow_indexing", Description: "seo_allow_indexing_desc", Default: true, siteInfoPath: path("seo.allow_indexing")},
		{Key: "seo_locale_index_mode", Type: TypeEnum, Label: "seo_locale_index_mode", Description: "seo_locale_index_mode_desc", Options: options([]string{"canonical_default", "noindex_follow", "independent"}, "seo_locale_index_mode_"), Default: "canonical_default", ShowWhen: when("seo_allow_indexing", "true"), siteInfoPath: path("seo.locale_index_mode")},
		{Key: "seo_sitemap_enabled", Type: TypeBool, Label: "seo_sitemap_enabled", Description: "seo_sitemap_enabled_desc", Default: true, ShowWhen: when("seo_allow_indexing", "true"), siteInfoPath: path("seo.sitemap_enabled")},
		{Key: "seo_sitemap_locale_mode", Type: TypeEnum, Label: "seo_sitemap_locale_mode", Description: "seo_sitemap_locale_mode_desc", Options: options([]string{"default_only", "all_locales"}, "seo_sitemap_locale_mode_"), Default: "default_only", ShowWhen: when("seo_sitemap_enabled", "true"), siteInfoPath: path("seo.sitemap_locale_mode")},
		// 站点地图协议单个文件最多 50000 条
		{Key: "sitemap_limit", Type: TypeInt, Label: "sitemap_limit", Description: "sitemap_limit_desc", Min: num(1), Max: num(50000), Default: constant.DefaultSitemapLimit, Env: constant.EnvKeySitemapLimit, ShowWhen: when("seo_sitemap_enabled", "true")},
		{Key: "seo_indexnow_enabled", Type: TypeBool, Label: "seo_indexnow_enabled", Description: "seo_indexnow_enabled_desc", Default: false, Env: constant.EnvKeyIndexNowEnabled, ShowWhen: when("seo_allow_indexing", "true")},
		{Key: "seo_indexnow_key", Type: TypeString, Label: "seo_indexnow_key", Description: "seo_indexnow_key_desc", Placeholder: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", Default: "", Env: constant.EnvKeyIndexNowKey, ShowWhen: when("seo_allow_indexing", "true")},
		{Key: "seo_robots_extra_rules", Type: TypeText, Label: "seo_robots_extra_rules", Description: "seo_robots_extra_rules_desc", Placeholder: "User-agent: GPTBot\nDisallow: /", Rows: 4, Wide: true, Default: "", ShowWhen: when("seo_allow_indexing", "true"), siteInfoPath: path("seo.robots_extra_rules")},
	}},
	{Tab: "seo", Key: "rss", Title: "section_rss", Description: "section_rss_desc", Items: []*Item{
		{Key: "rss_enabled", Type: TypeBool, Label: "rss_enabled", Description: "rss_enabled_desc", Default: true, siteInfoPath: path("seo.rss_enabled")},
		{Key: "site_title", Type: TypeString, Label: "rss_title", PlaceholderKey: "seo_inherit_name_placeholder", Default: "", ShowWhen: when("rss_enabled", "true")},
		{Key: "site_author", Type: TypeString, Label: "rss_author", PlaceholderKey: "seo_inherit_owner_placeholder", Default: "", ShowWhen: when("rss_enabled", "true")},
		{Key: "site_copyright", Type: TypeString, Label: "rss_copyright", PlaceholderKey: "seo_inherit_copyright_placeholder", Default: "", ShowWhen: when("rss_enabled", "true")},
		{Key: "rss_limit", Type: TypeInt, Label: "rss_limit", Description: "rss_limit_desc", Min: num(1), Max: num(500), Default: constant.DefaultRssLimit, Env: constant.EnvKeyRssLimit, ShowWhen: when("rss_enabled", "true")},
		{Key: "rss_description", Type: TypeText, Label: "rss_description", Description: "rss_description_desc", PlaceholderKey: "seo_inherit_desc_placeholder", Wide: true, Default: "", ShowWhen: when("rss_enabled", "true")},
		{Key: "site_image", Type: TypeImage, Label: "rss_image", Description: "rss_image_desc", Default: "", ShowWhen: when("rss_enabled", "true")},
		{Key: "rss_full_content", Type: TypeBool, Label: "rss_full_content", Description: "rss_full_content_desc", Default: true, ShowWhen: when("rss_enabled", "true")},
	}},

	// ---- 外观与前台 ----
	{Tab: "appearance", Key: "appearance", Title: "section_appearance", Widget: "theme_preview", Items: []*Item{
		{Key: "color_schemes", Type: TypeStringList, Widget: "color_schemes", Label: "color_schemes", Description: "color_schemes_desc", Options: options(colorSchemes, ""), Default: []string{"blue", "green", "orange", "red", "rose", "pink", "violet", "yellow"}, siteInfoPath: path("color_schemes")},
		{Key: "default_color_scheme", Type: TypeEnum, Widget: "color_scheme", Label: "default_color_scheme", Options: options(colorSchemes, ""), Default: "blue", siteInfoPath: path("default_color_scheme")},
		{Key: "content_theme", Type: TypeEnum, Label: "content_theme", Description: "content_theme_desc", Options: options(ContentThemes, "content_theme_"), Default: ContentThemes[0], siteInfoPath: path("content_theme")},
		{Key: "animation_duration_second", Type: TypeFloat, Label: "animation_duration", Description: "animation_duration_desc", Min: num(0), Max: num(3), Default: 0.618, siteInfoPath: path("animation_duration_second")},
		{Key: "enable_third_party_script", Type: TypeBool, Label: "enable_third_party_script", Description: "enable_third_party_script_desc", Default: true, siteInfoPath: path("enable_third_party_script")},
	}},
	{Tab: "appearance", Key: "page_background", Title: "page_background", Items: []*Item{
		{Key: "page_background_image", Type: TypeImage, Label: "page_background_image", Description: "page_background_image_desc", Default: "", siteInfoPath: path("page_background.image")},
		{Key: "page_background_decorations", Type: TypeBool, Label: "page_background_decorations", Description: "page_background_decorations_desc", Default: true, siteInfoPath: path("page_background.decorations")},
		{Key: "page_background_blur", Type: TypeInt, Label: "page_background_blur", Description: "page_background_blur_desc", Min: num(0), Max: num(40), Default: 0, siteInfoPath: path("page_background.blur")},
		{Key: "page_background_opacity", Type: TypeFloat, Label: "page_background_opacity", Description: "page_background_opacity_desc", Min: num(0), Max: num(1), Step: 0.05, Default: 1.0, siteInfoPath: path("page_background.opacity")},
		{Key: "page_background_veil", Type: TypeFloat, Label: "page_background_veil", Description: "page_background_veil_desc", Min: num(0), Max: num(1), Step: 0.05, Default: 0.72, siteInfoPath: path("page_background.veil")},
		{Key: "page_background_veil_color", Type: TypeColor, Label: "page_background_veil_color", Description: "page_background_veil_color_desc", Default: "", siteInfoPath: path("page_background.veil_color")},
	}},
	{Tab: "appearance", Key: "sidebar", Title: "section_sidebar", Description: "section_sidebar_desc", Items: []*Item{
		// 未配置时前台按默认卡片展示（含旧的嵌入页面配置），由前端组件补全
		{Key: "sidebar_cards", Type: TypeJSON, Widget: "sidebar_cards", Label: "sidebar_cards", Description: "sidebar_cards_desc", Default: nil, siteInfoPath: path("sidebar_cards")},
	}},
	// 顶栏灵动岛（实验性）：顶栏标题区按当前情境显示的内容，各项可单独关闭；总开关关闭时标题区只显示站名
	{Tab: "appearance", Key: "island", Title: "section_island", Description: "section_island_desc", Items: []*Item{
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
	{Tab: "appearance", Key: "weather", Title: "section_weather", Description: "section_weather_desc", Items: []*Item{
		{Key: "qweather_api_host", Type: TypeString, Label: "qweather_api_host", Description: "qweather_api_host_desc", Placeholder: "abc123xyz.re.qweatherapi.com", Default: ""},
		{Key: "qweather_api_key", Type: TypeSecret, Label: "qweather_api_key", Description: "qweather_api_key_desc", Default: ""},
	}},
	{Tab: "appearance", Key: "music", Title: "section_music", Description: "section_music_desc", Widget: "music_links", Items: []*Item{
		// 歌单只来自网易云：填好 API 地址并选定歌单后前台才显示音乐播放器（站点信息的 music_enabled，见 controller/misc.go）
		{Key: "ncm_api_base_url", Type: TypeURL, Label: "ncm_api_base_url", Description: "ncm_api_base_url_desc", Placeholder: "https://ncm-api.example.com", Default: ""},
		{Key: "ncm_cookie", Type: TypeSecret, Label: "ncm_cookie", Description: "ncm_cookie_desc", Placeholder: "MUSIC_U=...", Wide: true, Default: ""},
		// 用当前填写的 API 地址与 Cookie 读取账号歌单，选择其一作为博客歌单
		{Key: "ncm_playlist_id", Type: TypeInt, Widget: "ncm_playlist", Label: "ncm_playlist", Description: "ncm_playlist_desc", Min: num(0), Default: 0},
		{Key: "ncm_song_level", Type: TypeEnum, Label: "ncm_song_level", Description: "ncm_song_level_desc", Options: options(NCMSongLevels, "ncm_song_level_"), Default: "exhigh"},
		// 自定义 TTML 歌词源，按顺序探测（见 ttml_sources.go）
		{Key: "music_ttml_sources", Type: TypeJSON, Widget: "ttml_sources", Label: "music_ttml_sources", Description: "music_ttml_sources_desc", Placeholder: "https://cdn.example.com/lyrics/{song_id}.ttml", Default: []MusicTTMLSource{}, Env: constant.EnvKeyMusicTTMLURL, decode: decodeMusicTTMLSources},
	}},
	// 侧边栏 Misskey 动态：由后端定时拉取公开帖子写入共享状态，前台只读缓存、不暴露令牌
	{Tab: "appearance", Key: "misskey", Title: "section_misskey", Description: "section_misskey_desc", Items: []*Item{
		{Key: "misskey_enabled", Type: TypeBool, Label: "misskey_enabled", Description: "misskey_enabled_desc", Default: false},
		{Key: "misskey_instance_url", Type: TypeURL, Label: "misskey_instance_url", Description: "misskey_instance_url_desc", Placeholder: "https://misskey.io", Default: "", ShowWhen: when("misskey_enabled", "true")},
		{Key: "misskey_username", Type: TypeString, Label: "misskey_username", Description: "misskey_username_desc", Placeholder: "@username", Default: "", ShowWhen: when("misskey_enabled", "true")},
		{Key: "misskey_api_token", Type: TypeSecret, Label: "misskey_api_token", Description: "misskey_api_token_desc", Wide: true, Default: "", ShowWhen: when("misskey_enabled", "true")},
		{Key: "misskey_fetch_interval_minutes", Type: TypeInt, Label: "misskey_fetch_interval_minutes", Description: "misskey_fetch_interval_minutes_desc", Min: num(1), Max: num(60), Default: 3, ShowWhen: when("misskey_enabled", "true")},
		{Key: "misskey_display_count", Type: TypeInt, Label: "misskey_display_count", Description: "misskey_display_count_desc", Min: num(1), Max: num(10), Default: 5, ShowWhen: when("misskey_enabled", "true")},
	}},

	// ---- 内容与互动 ----
	{Tab: "content", Key: "content", Title: "section_content", Items: []*Item{
		{Key: "posts_per_page", Type: TypeInt, Label: "posts_per_page", Min: num(1), Max: num(100), Default: 10, siteInfoPath: path("posts_per_page")},
		{Key: "revision_max_keep", Type: TypeInt, Label: "revision_max_keep", Description: "revision_max_keep_desc", Min: num(RevisionMaxKeepMin), Max: num(RevisionMaxKeepMax), Default: RevisionMaxKeepDefault},
	}},
	// 互动功能（评论与点赞）：把总分开关与评论展示参数放在同一处，应对审核或调优时一屏改完
	{Tab: "content", Key: "interaction", Title: "section_interaction", Description: "section_interaction_desc", Items: []*Item{
		{Key: "enable_interaction", Type: TypeBool, Label: "enable_interaction", Description: "enable_interaction_desc", Default: true, Env: constant.EnvKeyEnableInteraction, siteInfoPath: path("interaction.enabled")},
		{Key: "enable_comment", Type: TypeBool, Label: "enable_comment", Description: "enable_comment_desc", Default: true, Env: constant.EnvKeyEnableComment, ShowWhen: when("enable_interaction", "true"), siteInfoPath: path("interaction.comment")},
		{Key: "enable_like", Type: TypeBool, Label: "enable_like", Description: "enable_like_desc", Default: true, Env: constant.EnvKeyEnableLike, ShowWhen: when("enable_interaction", "true"), siteInfoPath: path("interaction.like")},
		{Key: "comments_per_page", Type: TypeInt, Label: "comments_per_page", Min: num(1), Max: num(100), Default: 10, siteInfoPath: path("comments_per_page")},
		{Key: "comment_max_length", Type: TypeInt, Label: "comment_max_length", Description: "comment_max_length_desc", Min: num(1), Max: num(CommentMaxLengthMax), Default: CommentMaxLengthDefault, siteInfoPath: path("comment_max_length")},
		{Key: "comment_collapsed_lines", Type: TypeInt, Label: "comment_collapsed_lines", Description: "comment_collapsed_lines_desc", Min: num(1), Max: num(CommentCollapsedLinesMax), Default: CommentCollapsedLinesDefault, siteInfoPath: path("comment_collapsed_lines")},
		{Key: "max_reply_depth", Type: TypeInt, Label: "max_reply_depth", Description: "max_reply_depth_desc", Min: num(1), Max: num(10), Default: constant.MaxReplyDepthDefault, Env: constant.EnvKeyMaxReplyDepth},
	}},
	// 全站公开资源检索（Meilisearch）：只索引公开的文章、页面、评论与候选用户，支持拼音与首字母检索；未启用或不可用时自动回退数据库查询
	{Tab: "content", Key: "search", Title: "section_search", Description: "section_search_desc", Widget: "search_test", Items: []*Item{
		{Key: "meilisearch_enable", Type: TypeBool, Label: "meilisearch_enable", Description: "meilisearch_enable_desc", Default: false, Env: constant.EnvKeyMeilisearchEnable},
		{Key: "meilisearch_url", Type: TypeURL, Label: "meilisearch_url", Description: "meilisearch_url_desc", Placeholder: "http://meilisearch:7700", Default: "", Env: constant.EnvKeyMeilisearchURL},
		{Key: "meilisearch_api_key", Type: TypeSecret, Label: "meilisearch_api_key", Description: "meilisearch_api_key_desc", Wide: true, Default: "", Env: constant.EnvKeyMeilisearchAPIKey},
		{Key: "meilisearch_index_prefix", Type: TypeString, Label: "meilisearch_index_prefix", Description: "meilisearch_index_prefix_desc", Placeholder: "neo_", Default: "neo_", Env: constant.EnvKeyMeilisearchIndexPrefix},
	}},

	// ---- 账号与通知 ----
	{Tab: "account", Key: "account", Title: "section_account", Items: []*Item{
		{Key: "enable_register", Type: TypeBool, Label: "enable_register", Description: "enable_register_desc", Default: false, Env: constant.EnvKeyEnableRegister},
		{Key: "enable_register_from_oidc", Type: TypeBool, Label: "enable_register_from_oidc", Description: "enable_register_from_oidc_desc", Default: true, Env: constant.EnvKeyEnableRegisterFromOidc},
		{Key: "enable_email_verify", Type: TypeBool, Label: "enable_email_verify", Description: "enable_email_verify_desc", Default: true, Env: constant.EnvKeyEnableEmailVerify},
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
		{Key: "captcha_site_key", Type: TypeString, Label: "captcha_site_key", Description: "captcha_site_key_desc", Default: "", Env: constant.EnvKeyCaptchaSiteKey, ShowWhen: when("captcha_provider", constant.CaptchaTypeTurnstile, constant.CaptchaTypeHCaptcha, constant.CaptchaTypeReCaptcha)},
		{Key: "captcha_secret_key", Type: TypeSecret, Label: "captcha_secret_key", Description: "captcha_secret_key_desc", Wide: true, Default: "", Env: constant.EnvKeyCaptchaSecreteKey, ShowWhen: when("captcha_provider", constant.CaptchaTypeTurnstile, constant.CaptchaTypeHCaptcha, constant.CaptchaTypeReCaptcha)},
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
	// 站内互动通知：站内通知始终即时送达，开启邮件通知后展开邮件汇总策略（见 docs/notification-spec.md）
	{Tab: "account", Key: "notification", Title: "section_notification", Description: "section_notification_desc", Widget: "notification_test", Items: []*Item{
		{Key: "notification_retention_days", Type: TypeInt, Label: "notification_retention_days", Description: "notification_retention_days_desc", Min: num(7), Max: num(3650), Default: 180},
		{Key: "notification_thread_include_author", Type: TypeBool, Label: "notification_thread_include_author", Description: "notification_thread_include_author_desc", Default: true},
		{Key: "notification_email_enable", Type: TypeBool, Label: "notification_email_enable", Description: "notification_email_enable_desc", Default: false},
		// 重要类型同时是用户可选的「上限」：用户只能在这个集合里关，不能开站点没开的类型；点赞与线程活动永远只是附带，不进这个列表
		{Key: "notification_email_types", Type: TypeStringList, Label: "notification_email_types", Description: "notification_email_types_desc", Options: []Option{
			{Value: constant.NotificationTypeCommentCreated, Label: "notification_type_comment_created"},
			{Value: constant.NotificationTypeCommentReplied, Label: "notification_type_comment_replied"},
			{Value: constant.NotificationTypeCommentMentioned, Label: "notification_type_comment_mentioned"},
		}, Default: []string{constant.NotificationTypeCommentCreated, constant.NotificationTypeCommentReplied, constant.NotificationTypeCommentMentioned}, ShowWhen: when("notification_email_enable", "true")},
		{Key: "notification_email_interval", Type: TypeInt, Label: "notification_email_interval", Description: "notification_email_interval_desc", Min: num(0), Max: num(1440), Default: 10, ShowWhen: when("notification_email_enable", "true")},
		{Key: "notification_email_attach_hours", Type: TypeInt, Label: "notification_email_attach_hours", Description: "notification_email_attach_hours_desc", Min: num(1), Max: num(720), Default: 24, ShowWhen: when("notification_email_enable", "true")},
		{Key: "notification_email_attach_max", Type: TypeInt, Label: "notification_email_attach_max", Description: "notification_email_attach_max_desc", Min: num(0), Max: num(50), Default: 5, ShowWhen: when("notification_email_enable", "true")},
		{Key: "notification_email_max_items", Type: TypeInt, Label: "notification_email_max_items", Description: "notification_email_max_items_desc", Min: num(1), Max: num(50), Default: 10, ShowWhen: when("notification_email_enable", "true")},
		{Key: "notification_email_hourly_limit", Type: TypeInt, Label: "notification_email_hourly_limit", Description: "notification_email_hourly_limit_desc", Min: num(1), Max: num(1000), Default: 20, ShowWhen: when("notification_email_enable", "true")},
	}},
	{Tab: "account", Key: "visit", Title: "section_visit", Items: []*Item{
		{Key: "visit_log_retention_days", Type: TypeInt, Label: "visit_log_retention_days", Description: "visit_log_retention_days_desc", Min: num(1), Max: num(3650), Default: 90},
		{Key: "visit_fingerprint_attribution", Type: TypeBool, Label: "visit_fingerprint_attribution", Description: "visit_fingerprint_attribution_desc", Default: true},
	}},
	{Tab: "account", Key: "error_report", Title: "section_error_report", Description: "section_error_report_desc", Items: []*Item{
		{Key: "error_report_enabled", Type: TypeBool, Label: "error_report_enabled", Description: "error_report_enabled_desc", Default: true},
		{Key: "error_report_retention_days", Type: TypeInt, Label: "error_report_retention_days", Description: "error_report_retention_days_desc", Min: num(1), Max: num(365), Default: 30},
	}},

	// ---- AI ----
	{Tab: "ai", Key: "ai", Title: "section_ai", Description: "section_ai_desc", Items: []*Item{
		{Key: "ai_api_base_url", Type: TypeURL, Label: "ai_api_base_url", Description: "ai_api_base_url_desc", Placeholder: "https://api.openai.com/v1", Default: ""},
		{Key: "ai_model", Type: TypeString, Label: "ai_model", Description: "ai_model_desc", Placeholder: "gpt-4o-mini / deepseek-chat", Default: ""},
		{Key: "ai_api_key", Type: TypeSecret, Label: "ai_api_key", Description: "ai_api_key_desc", Wide: true, Default: ""},
		// 识图：AI 摘要与 AI 用户读文章时把正文图片一并发给模型，需要模型支持图片输入
		{Key: "ai_vision_enabled", Type: TypeBool, Label: "ai_vision_enabled", Description: "ai_vision_enabled_desc", Default: false},
		{Key: "ai_summary_concurrency", Type: TypeInt, Label: "ai_summary_concurrency", Description: "ai_summary_concurrency_desc", Min: num(1), Max: num(100), Default: 3},
		// 全站 AI 月度预算：摘要、写作、翻译、歌词标注等非 AI 用户的调用在本月全站用量（含 AI 用户）达到后被拒绝；默认 0 不限
		{Key: "ai_monthly_token_budget", Type: TypeInt, Label: "ai_monthly_token_budget", Description: "ai_monthly_token_budget_desc", Min: num(0), Max: num(1e12), Default: 0},
	}},
	{Tab: "ai", Key: "ai_writing", Title: "section_ai_writing", Description: "section_ai_writing_desc", Items: []*Item{
		{Key: "ai_writing_style", Type: TypeText, Label: "ai_writing_style", Description: "ai_writing_style_desc", PlaceholderKey: "ai_writing_style_placeholder", Rows: 6, Wide: true, Default: ""},
	}},
	// 评论 AI 内容审查：先展示再异步后台审查（含 AI 用户），违规评论保留入库但仅后台管理员可见
	{Tab: "ai", Key: "ai_moderation", Title: "section_ai_moderation", Description: "section_ai_moderation_desc", Items: []*Item{
		{Key: "ai_comment_moderation_enabled", Type: TypeBool, Label: "ai_comment_moderation_enabled", Description: "ai_comment_moderation_enabled_desc", Default: true},
		{Key: "ai_comment_moderation_prompt", Type: TypeText, Label: "ai_comment_moderation_prompt", Description: "ai_comment_moderation_prompt_desc", PlaceholderKey: "ai_comment_moderation_prompt_placeholder", Rows: 4, Wide: true, Default: "", ShowWhen: when("ai_comment_moderation_enabled", "true")},
	}},
	// AI 思考强度：按任务独立控制 reasoning_effort / DeepSeek thinking；不支持的模型会自动降级重试
	{Tab: "ai", Key: "ai_thinking", Title: "section_ai_thinking", Description: "section_ai_thinking_desc", Items: []*Item{
		{Key: "ai_thinking_summary", Type: TypeEnum, Label: "ai_thinking_summary", Description: "ai_thinking_summary_desc", Options: aiThinkingModes, Default: "none"},
		{Key: "ai_thinking_writing", Type: TypeEnum, Label: "ai_thinking_writing", Description: "ai_thinking_writing_desc", Options: aiThinkingModes, Default: ""},
		{Key: "ai_thinking_comment_translate", Type: TypeEnum, Label: "ai_thinking_comment_translate", Description: "ai_thinking_comment_translate_desc", Options: aiThinkingModes, Default: "low"},
		{Key: "ai_thinking_comment_moderation", Type: TypeEnum, Label: "ai_thinking_comment_moderation", Description: "ai_thinking_comment_moderation_desc", Options: aiThinkingModes, Default: "none"},
		{Key: "ai_thinking_lyric_translation", Type: TypeEnum, Label: "ai_thinking_lyric_translation", Description: "ai_thinking_lyric_translation_desc", Options: aiThinkingModes, Default: ""},
		{Key: "ai_thinking_lyric_annotation", Type: TypeEnum, Label: "ai_thinking_lyric_annotation", Description: "ai_thinking_lyric_annotation_desc", Options: aiThinkingModes, Default: "none"},
		{Key: "ai_thinking_lyric_pronunciation", Type: TypeEnum, Label: "ai_thinking_lyric_pronunciation", Description: "ai_thinking_lyric_pronunciation_desc", Options: aiThinkingModes, Default: "none"},
	}},
	// AI 用户：由 Agent 驱动、与普通用户同权限的账号；开启后展开细粒度配额与冷却设置
	{Tab: "ai", Key: "ai_agents", Title: "section_ai_agents", Description: "section_ai_agents_desc", Widget: "ai_agents_link", Items: []*Item{
		{Key: "ai_agents_enabled", Type: TypeBool, Label: "ai_agents_enabled", Description: "ai_agents_enabled_desc", Default: false},
		{Key: "ai_agent_model_ambient", Type: TypeString, Label: "ai_agent_model_ambient", Description: "ai_agent_model_ambient_desc", Default: "", ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agent_model_expert", Type: TypeString, Label: "ai_agent_model_expert", Description: "ai_agent_model_expert_desc", Default: "", ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_llm_calls_per_hour", Type: TypeInt, Label: "ai_agents_llm_calls_per_hour", Description: "ai_agents_llm_calls_per_hour_desc", Min: num(1), Max: num(100000), Default: 200, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_monthly_token_budget", Type: TypeInt, Label: "ai_agents_monthly_token_budget", Description: "ai_agents_monthly_token_budget_desc", Min: num(0), Max: num(1e12), Default: 20000000, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_comments_per_day", Type: TypeInt, Label: "ai_agents_comments_per_day", Description: "ai_agents_comments_per_day_desc", Min: num(0), Max: num(100000), Default: 60, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_likes_per_day", Type: TypeInt, Label: "ai_agents_likes_per_day", Description: "ai_agents_likes_per_day_desc", Min: num(0), Max: num(1000000), Default: 600, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_comments_per_post", Type: TypeInt, Label: "ai_agents_comments_per_post", Description: "ai_agents_comments_per_post_desc", Min: num(0), Max: num(1000), Default: 3, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_ai_ratio", Type: TypeFloat, Label: "ai_agents_ai_ratio", Description: "ai_agents_ai_ratio_desc", Min: num(0), Max: num(100), Step: 0.5, Default: 2.0, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_replies_per_human_comment", Type: TypeInt, Label: "ai_agents_replies_per_human_comment", Description: "ai_agents_replies_per_human_comment_desc", Min: num(0), Max: num(100), Default: 2, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_publish_fanout", Type: TypeInt, Label: "ai_agents_publish_fanout", Description: "ai_agents_publish_fanout_desc", Min: num(0), Max: num(1000), Default: 8, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_quiet_hours", Type: TypeString, Label: "ai_agents_quiet_hours", Description: "ai_agents_quiet_hours_desc", Placeholder: "02:00-07:00", Default: "", ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_max_chain_depth", Type: TypeInt, Label: "ai_agents_max_chain_depth", Description: "ai_agents_max_chain_depth_desc", Min: num(1), Max: num(10), Default: 5, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_pair_exchanges", Type: TypeInt, Label: "ai_agents_pair_exchanges", Description: "ai_agents_pair_exchanges_desc", Min: num(0), Max: num(100), Default: 2, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_mentions_per_pair_per_day", Type: TypeInt, Label: "ai_agents_mentions_per_pair_per_day", Description: "ai_agents_mentions_per_pair_per_day_desc", Min: num(0), Max: num(1000), Default: 3, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_mentions_per_user_per_hour", Type: TypeInt, Label: "ai_agents_mentions_per_user_per_hour", Description: "ai_agents_mentions_per_user_per_hour_desc", Min: num(0), Max: num(10000), Default: 10, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_profile_self_edit", Type: TypeBool, Label: "ai_agents_profile_self_edit", Description: "ai_agents_profile_self_edit_desc", Default: true, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_memory_days_ambient", Type: TypeInt, Label: "ai_agents_memory_days_ambient", Description: "ai_agents_memory_days_ambient_desc", Min: num(1), Max: num(3650), Default: 30, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_memory_days_expert", Type: TypeInt, Label: "ai_agents_memory_days_expert", Description: "ai_agents_memory_days_expert_desc", Min: num(1), Max: num(3650), Default: 180, ShowWhen: when("ai_agents_enabled", "true")},
		{Key: "ai_agents_run_retention_days", Type: TypeInt, Label: "ai_agents_run_retention_days", Description: "ai_agents_run_retention_days_desc", Min: num(1), Max: num(3650), Default: 90, ShowWhen: when("ai_agents_enabled", "true")},
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
	{
		// 开启 Meilisearch 时必须填写服务地址
		keys: []string{"meilisearch_enable", "meilisearch_url"},
		check: func(get func(string) any) string {
			if enabled, _ := get("meilisearch_enable").(bool); enabled && strings.TrimSpace(get("meilisearch_url").(string)) == "" {
				return "meilisearch_url_required"
			}
			return ""
		},
	},
	{
		// 开启 IndexNow 时必须填写合法密钥；未开启但填了非空密钥时同样校验格式（8~128 位字母、数字或连字符）
		keys: []string{"seo_indexnow_enabled", "seo_indexnow_key"},
		check: func(get func(string) any) string {
			enabled, _ := get("seo_indexnow_enabled").(bool)
			rawKey, _ := get("seo_indexnow_key").(string)
			trimmed := strings.TrimSpace(rawKey)
			if enabled && NormalizeIndexNowKey(trimmed) == "" {
				return "indexnow_key_invalid"
			}
			if trimmed != "" && NormalizeIndexNowKey(trimmed) == "" {
				return "indexnow_key_invalid"
			}
			return ""
		},
	},
	{
		// 开启 Misskey 动态同步时必须填写合法公网实例根地址与本地用户名
		keys: []string{"misskey_enabled", "misskey_instance_url", "misskey_username"},
		check: func(get func(string) any) string {
			enabled, _ := get("misskey_enabled").(bool)
			if !enabled {
				return ""
			}
			rawURL, _ := get("misskey_instance_url").(string)
			rawUser, _ := get("misskey_username").(string)
			if _, err := NormalizeMisskeyInstanceURL(strings.TrimSpace(rawURL)); err != nil {
				return "invalid_config_value"
			}
			if _, ok := NormalizeMisskeyUsername(strings.TrimSpace(rawUser)); !ok {
				return "invalid_config_value"
			}
			return ""
		},
	},
}

// IsStrictIndexNowKey 严格校验请求入参是否为精确的 8~128 位 IndexNow 密钥（仅限 a-z、A-Z、0-9 与连字符 -，不含空白或 .txt 后缀）
func IsStrictIndexNowKey(raw string) bool {
	if len(raw) < 8 || len(raw) > 128 {
		return false
	}
	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-') {
			return false
		}
	}
	return true
}

// NormalizeIndexNowKey 校验并规整配置中的 IndexNow 密钥（兼容首尾空白与误带 .txt 后缀）
func NormalizeIndexNowKey(raw string) string {
	trimmed := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), ".txt"))
	if !IsStrictIndexNowKey(trimmed) {
		return ""
	}
	return trimmed
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
