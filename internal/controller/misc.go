package v1

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
)

const (
	KeySiteInfo = "site_info"
)

type MiscController struct{}

func NewMiscController() *MiscController {
	return &MiscController{}
}

// GetCacheTags 前端服务端缓存各失效标签的版本号，供前端实例轮询（见 service.CacheTagVersions）
func (mc *MiscController) GetCacheTags(ctx context.Context, c *app.RequestContext) {
	versions, svcerr := service.CacheTagVersions()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"tags": versions})
}

// GetSiteInfo 前台站点信息：后台保存的整体站点信息补上缺少的注册项，从未保存过时全部按配置注册表的生效值与默认值（见 config.SiteInfo）
func (mc *MiscController) GetSiteInfo(ctx context.Context, c *app.RequestContext) {
	info := config.SiteInfo()
	// 设置了环境变量 BASE_URL 时站点地址以它为准
	if _, fromEnv := config.Lookup("base_url").EnvValue(); fromEnv {
		info["base_url"] = tools.GetBaseUrl()
	}
	// 评论的字数上限与折叠行数是后台可调的配置，直接给生效值，前台不必再判断缺省
	info["comment_max_length"] = tools.GetCommentMaxLength()
	info["comment_collapsed_lines"] = tools.GetCommentCollapsedLines()
	// 歌单只来自网易云：填好 API 地址并选定歌单才显示音乐播放器，前台据此决定是否挂载播放器（不暴露 API 地址本身）
	info["music_enabled"] = tools.GetNCMConfig().Configured()
	// 注册、找回密码要不要邮箱验证码、邮件服务能不能发信：只给布尔值，前台据此隐藏验证码或提示联系管理员（不暴露任何邮件配置）
	info["email_verify_enabled"] = service.EmailVerifyEnabled()
	info["email_available"] = tools.GetEmailConfig().Usable()
	resps.Ok(c, "", info)
}

// publicConfigKeys 允许匿名读取的配置键
var publicConfigKeys = []string{
	KeySiteInfo, "site_name", "site_description", "site_icon", "base_url",
	"posts_per_page", "comments_per_page", "max_reply_depth", "enable_register", "enable_register_from_oidc",
	"comment_max_length", "comment_collapsed_lines",
	"visit_log_retention_days",    // 隐私政策页展示访问记录保留天数
	"error_report_retention_days", // 隐私政策页展示错误报告保留天数
}

func (mc *MiscController) GetPublicConfig(ctx context.Context, c *app.RequestContext) {
	keysParam := c.Query("keys")
	if keysParam == "" {
		resps.BadRequest(c, "keys parameter is required")
		return
	}
	keys := strings.Split(keysParam, ",")
	result := make(map[string]interface{})
	for _, key := range keys {
		// 只允许读取明确公开的配置，避免后台存储的其他键值被匿名读取
		if !slices.Contains(publicConfigKeys, key) {
			continue
		}
		// 已注册的配置返回实际生效的值（环境变量 > 后台配置 > 默认值）
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
	resps.Ok(c, "", result)
}

func (mc *MiscController) GetSitemapData(ctx context.Context, c *app.RequestContext) {
	// 此函数不加错误处理，能返回多少算多少
	var posts []model.Post
	repo.GetDB().Model(&model.Post{}).
		Select("id, slug, created_at, updated_at").
		Where("is_private = ?", false).
		Order("created_at DESC").
		Limit(tools.GetSitemapLimit()).
		Find(&posts)

	var editors []model.User
	repo.GetDB().Model(&model.User{}).
		Select("id, username, updated_at").
		Where("role IN ?", []constant.Role{constant.RoleEditor, constant.RoleAdmin}).
		Order("updated_at DESC").
		Limit(tools.GetSitemapLimit()).
		Find(&editors)

	var categories []model.Category
	repo.GetDB().Model(&model.Category{}).
		Select("id, slug, updated_at").
		Order("updated_at DESC").
		Limit(tools.GetSitemapLimit()).
		Find(&categories)

	// 公开的独立页面（链接页面只是导航入口，不列入）
	var pages []model.Page
	repo.GetDB().Model(&model.Page{}).
		Select("id, slug, updated_at").
		Where("is_private = ? AND kind <> ?", false, model.PageKindLink).
		Order("updated_at DESC").
		Limit(tools.GetSitemapLimit()).
		Find(&pages)

	var labels []model.Label
	repo.GetDB().Model(&model.Label{}).
		Select("id, name, slug, updated_at").
		Order("updated_at DESC").
		Limit(tools.GetSitemapLimit()).
		Find(&labels)

	archiveSet := make(map[string]struct{})
	archives := make([]string, 0)
	for _, post := range posts {
		archive := post.CreatedAt.Format("2006-01")
		if _, ok := archiveSet[archive]; ok {
			continue
		}
		archiveSet[archive] = struct{}{}
		archives = append(archives, archive)
	}

	resps.Ok(c, "", utils.H{
		"base_url": tools.GetBaseUrl(),
		"archives": archives,
		"pages": func() []map[string]any {
			m := make([]map[string]any, 0, len(pages))
			for _, page := range pages {
				m = append(m, map[string]any{
					"id":         page.ID,
					"slug":       page.Slug,
					"updated_at": page.UpdatedAt,
				})
			}
			return m
		}(),
		"labels": func() []map[string]any {
			m := make([]map[string]any, 0)
			for _, label := range labels {
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
			m := make([]map[string]any, 0)
			for _, category := range categories {
				m = append(m, map[string]any{
					"id":         category.ID,
					"slug":       category.Slug,
					"updated_at": category.UpdatedAt,
				})
			}
			return m
		}(),
		"posts": func() []map[string]any {
			m := make([]map[string]any, 0)
			for _, post := range posts {
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
			m := make([]map[string]any, 0)
			for _, editor := range editors {
				m = append(m, map[string]any{
					"username":   editor.Username,
					"id":         editor.ID,
					"updated_at": editor.UpdatedAt,
				})
			}
			return m
		}(),
	})
}

func (mc *MiscController) GetRssData(ctx context.Context, c *app.RequestContext) {
	var posts []model.Post
	if err := repo.GetDB().Model(&model.Post{}).
		Where("is_private = ?", false).
		Order("created_at DESC").
		Limit(tools.GetRssLimit()).
		Omit("draft_content").
		Preload("User").
		Preload("Category").
		Find(&posts).Error; err != nil {
		resps.InternalError(c, err)
		return
	}

	resps.Ok(c, "", map[string]any{
		"title":              tools.GetRssTitle(),
		"description":        tools.GetSiteDescription(),
		"site_url":           tools.GetBaseUrl(),
		"feed_url":           tools.GetBaseUrl() + "/rss.xml",
		"author":             tools.GetRssAuthor(),
		"copyright":          tools.GetRssCopyright(),
		"image_url":          tools.GetRssImage(),
		"language":           config.String("default_language"),
		"post_default_cover": repo.KV.GetKVWithoutErr(constant.KeyPostDefaultCover, "https://cdn.liteyuki.org/blog/background.png"),
		"pub_date": func() time.Time {
			if len(posts) > 0 {
				return posts[0].UpdatedAt
			}
			return time.Now()
		}(),
		"posts": func() []map[string]any {
			m := make([]map[string]any, 0)
			for _, post := range posts {
				m = append(m, map[string]any{
					"id":         post.ID,
					"title":      post.Title,
					"slug":       post.Slug,
					"content":    post.Content,
					"created_at": post.CreatedAt,
					"updated_at": post.UpdatedAt,
					"user":       post.User.ToDto(),
					"category": func() *dto.CategoryDto {
						if post.Category == nil {
							return nil
						}
						return post.Category.ToDto()
					}(),
					"cover": post.Cover,
				})
			}
			return m
		}(),
	})
}

// GetMetrics 获取全部后端实例的运行时指标，仅管理员可见
func (mc *MiscController) GetMetrics(ctx context.Context, c *app.RequestContext) {
	resp, svcerr := service.ListRuntimeMetrics()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, "", resp)
}
