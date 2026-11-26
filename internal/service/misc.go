package service

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
	"golang.org/x/sync/singleflight"
)

const keySiteInfo = "site_info"

var sitemapGuestFlight singleflight.Group

// publicConfigKeys 允许匿名读取的配置键
var publicConfigKeys = []string{
	keySiteInfo, "site_name", "site_description", "site_icon", "base_url",
	"posts_per_page", "comments_per_page", "max_reply_depth", "enable_register", "enable_register_from_oidc",
	"enable_interaction", "enable_comment", "enable_like",
	"comment_max_length", "comment_collapsed_lines",
	"visit_log_retention_days",    // 隐私政策页展示访问记录保留天数
	"error_report_retention_days", // 隐私政策页展示错误报告保留天数
}

type MiscService struct{}

func NewMiscService() *MiscService {
	return &MiscService{}
}

// GetSiteInfo 前台站点信息：后台保存的整体站点信息补上缺少的注册项，从未保存过时全部按配置注册表的生效值与默认值
func (s *MiscService) GetSiteInfo() map[string]any {
	info := config.SiteInfo()
	// 设置了环境变量 BASE_URL 时站点地址以它为准
	if _, fromEnv := config.Lookup("base_url").EnvValue(); fromEnv {
		info["base_url"] = tools.GetBaseUrl()
	}
	// 互动功能开关写入综合总开关与环境变量后的实际生效值
	info["interaction"] = map[string]any{
		"enabled": tools.InteractionEnabled(),
		"comment": tools.CommentEnabled(),
		"like":    tools.LikeEnabled(),
	}
	// SEO 配置写入综合总开关后的实际生效值（关闭全站索引时 sitemap_enabled 同步为 false）
	info["seo"] = dto.SEOSettingsDto{
		HomeTitle:          config.String("seo_home_title"),
		HomeDescription:    config.String("seo_home_description"),
		OgImage:            config.String("seo_og_image"),
		TwitterHandle:      config.String("seo_twitter_handle"),
		TwitterCard:        config.String("seo_twitter_card"),
		GoogleVerification: config.String("seo_google_verification"),
		BingVerification:   config.String("seo_bing_verification"),
		BaiduVerification:  config.String("seo_baidu_verification"),
		AllowIndexing:      tools.GetSEOAllowIndexing(),
		RobotsExtraRules:   config.String("seo_robots_extra_rules"),
		SitemapEnabled:     tools.GetSEOSitemapEnabled(),
		SitemapLocaleMode:  config.String("seo_sitemap_locale_mode"),
		LocaleIndexMode:    config.String("seo_locale_index_mode"),
		RssEnabled:         tools.GetRssEnabled(),
	}
	// 评论的字数上限与折叠行数是后台可调的配置，直接给生效值，前台不必再判断缺省
	info["comment_max_length"] = tools.GetCommentMaxLength()
	info["comment_collapsed_lines"] = tools.GetCommentCollapsedLines()
	// 歌单只来自网易云：填好 API 地址并选定歌单才显示音乐播放器，前台据此决定是否挂载播放器（不暴露 API 地址本身）
	info["music_enabled"] = tools.GetNCMConfig().Configured()
	// 音乐播放器是否可用站点 AI（仅给布尔值，供前端判断是否允许在无原生翻译时开启并触发 AI 歌词翻译）
	info["music_ai_enabled"] = tools.GetAIConfig().Configured()
	// 注册、找回密码要不要邮箱验证码、邮件服务能不能发信：只给布尔值，前台据此隐藏验证码或提示联系管理员（不暴露任何邮件配置）
	info["email_verify_enabled"] = EmailVerifyEnabled()
	info["email_available"] = tools.GetEmailConfig().Usable()
	return info
}

// GetPublicConfig 读取白名单内允许匿名公开访问的配置项
func (s *MiscService) GetPublicConfig(keysParam string) (map[string]any, *errs.ServiceError) {
	if keysParam == "" {
		return nil, errs.NewBadRequest("keys parameter is required")
	}
	keys := strings.Split(keysParam, ",")
	result := make(map[string]any)
	for _, key := range keys {
		if !slices.Contains(publicConfigKeys, key) {
			continue
		}
		if config.Lookup(key) != nil {
			result[key] = config.Value(key)
			continue
		}
		value, err := repo.KV.GetKV(key)
		if err != nil {
			continue
		}
		result[key] = value
	}
	return result, nil
}

// GetSitemapData 聚合全站公开文章、独立页面、分类、标签与编辑列表供站点地图使用（带短时缓存与防击穿合并）
func (s *MiscService) GetSitemapData(ctx context.Context) (map[string]any, *errs.ServiceError) {
	if !tools.GetSEOSitemapEnabled() {
		return map[string]any{
			"base_url":            tools.GetBaseUrl(),
			"sitemap_enabled":     false,
			"sitemap_locale_mode": config.String("seo_sitemap_locale_mode"),
			"friends_enabled":     false,
			"friends_updated_at":  nil,
			"archives":            []string{},
			"pages":               []map[string]any{},
			"labels":              []map[string]any{},
			"categories":          []map[string]any{},
			"posts":               []map[string]any{},
			"editors":             []map[string]any{},
		}, nil
	}
	if cached, ok := cache.GetJSON[map[string]any](repo.SitemapGuestCache, "sitemap"); ok {
		return cached, nil
	}
	rawVal, err, _ := sitemapGuestFlight.Do("sitemap", func() (any, error) {
		if cached, ok := cache.GetJSON[map[string]any](repo.SitemapGuestCache, "sitemap"); ok {
			return cached, nil
		}
		raw, dbErr := repo.Misc.GetSitemapRaw(context.WithoutCancel(ctx), tools.GetSitemapLimit())
		if dbErr != nil {
			return nil, dbErr
		}
		archiveSet := make(map[string]struct{})
		archives := make([]string, 0)
		for _, post := range raw.Posts {
			archive := post.CreatedAt.Format("2006-01")
			if _, ok := archiveSet[archive]; ok {
				continue
			}
			archiveSet[archive] = struct{}{}
			archives = append(archives, archive)
		}

		payload := map[string]any{
			"base_url":            tools.GetBaseUrl(),
			"sitemap_enabled":     true,
			"sitemap_locale_mode": config.String("seo_sitemap_locale_mode"),
			"friends_enabled":     true,
			"friends_updated_at":  raw.FriendsUpdatedAt,
			"archives":            archives,
			"pages": func() []map[string]any {
				m := make([]map[string]any, 0, len(raw.Pages))
				for _, page := range raw.Pages {
					m = append(m, map[string]any{
						"id":         page.ID,
						"slug":       page.Slug,
						"updated_at": page.UpdatedAt,
					})
				}
				return m
			}(),
			"labels": func() []map[string]any {
				m := make([]map[string]any, 0, len(raw.Labels))
				for _, label := range raw.Labels {
					m = append(m, map[string]any{
						"id":         label.ID,
						"name":       label.Name,
						"slug":       label.Slug,
						"updated_at": label.UpdatedAt,
					})
				}
				return m
			}(),
			"categories": func() []map[string]any {
				m := make([]map[string]any, 0, len(raw.Categories))
				for _, category := range raw.Categories {
					m = append(m, map[string]any{
						"id":         category.ID,
						"slug":       category.Slug,
						"updated_at": category.UpdatedAt,
					})
				}
				return m
			}(),
			"posts": func() []map[string]any {
				m := make([]map[string]any, 0, len(raw.Posts))
				for _, post := range raw.Posts {
					m = append(m, map[string]any{
						"id":         post.ID,
						"created_at": post.CreatedAt,
						"updated_at": post.UpdatedAt,
						"slug":       post.Slug,
					})
				}
				return m
			}(),
			"editors": func() []map[string]any {
				m := make([]map[string]any, 0, len(raw.Editors))
				for _, editor := range raw.Editors {
					m = append(m, map[string]any{
						"username":   editor.Username,
						"id":         editor.ID,
						"updated_at": editor.UpdatedAt,
					})
				}
				return m
			}(),
		}
		cache.SetJSON(repo.SitemapGuestCache, "sitemap", payload, repo.PostGuestCacheTTL)
		return payload, nil
	})
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("sitemap")
	}
	return rawVal.(map[string]any), nil
}

// GetRssData 获取 RSS 订阅源数据
func (s *MiscService) GetRssData(ctx context.Context) (*dto.RssDataDto, *errs.ServiceError) {
	if !tools.GetRssEnabled() {
		return &dto.RssDataDto{
			Enabled: false,
			Posts:   []dto.RssPostItemDto{},
		}, nil
	}

	fullContent := tools.GetRssFullContent()
	posts, err := repo.Misc.ListPublicPostsForRSS(ctx, tools.GetRssLimit(), fullContent)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("post")
	}

	pubDate := time.Now()
	if len(posts) > 0 {
		pubDate = posts[0].UpdatedAt
		for _, post := range posts[1:] {
			if post.UpdatedAt.After(pubDate) {
				pubDate = post.UpdatedAt
			}
		}
	}

	items := make([]dto.RssPostItemDto, 0, len(posts))
	for _, post := range posts {
		var cat *dto.CategoryDto
		if post.Category != nil {
			cat = post.Category.ToDto()
		}
		content := ""
		if fullContent {
			content = post.Content
		}
		items = append(items, dto.RssPostItemDto{
			ID:          post.ID,
			Title:       post.Title,
			Slug:        post.Slug,
			Description: post.Description,
			Excerpt:     post.Excerpt,
			Content:     content,
			CreatedAt:   post.CreatedAt,
			UpdatedAt:   post.UpdatedAt,
			User:        post.User.ToPublicDto(),
			Category:    cat,
			Cover:       post.Cover,
		})
	}

	return &dto.RssDataDto{
		Enabled:          true,
		FullContent:      fullContent,
		Title:            tools.GetRssTitle(),
		Description:      tools.GetRssDescription(),
		SiteURL:          tools.GetBaseUrl(),
		FeedURL:          tools.GetBaseUrl() + "/rss.xml",
		Author:           tools.GetRssAuthor(),
		Copyright:        tools.GetRssCopyright(),
		ImageURL:         tools.GetRssImage(),
		Language:         config.String("default_language"),
		PostDefaultCover: tools.GetPostDefaultCover(),
		PubDate:          pubDate,
		Posts:            items,
	}, nil
}
