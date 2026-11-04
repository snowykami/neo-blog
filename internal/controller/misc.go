package v1

import (
	"context"
	"maps"
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
	utils2 "github.com/snowykami/neo-blog/pkg/utils"
)

const (
	KeySiteInfo = "site_info"
)

type MiscController struct{}

func NewMiscController() *MiscController {
	return &MiscController{}
}

func (mc *MiscController) GetSiteInfo(ctx context.Context, c *app.RequestContext) {
	// 已保存整体站点信息时直接返回，避免为默认值逐项查询配置
	if value, err := repo.KV.GetKV(KeySiteInfo); err == nil {
		// 设置了环境变量 BASE_URL 时站点地址以它为准（复制一份再改，不动缓存里的值）
		if info, ok := value.(map[string]any); ok {
			if _, fromEnv := config.Lookup("base_url").EnvValue(); fromEnv {
				info = maps.Clone(info)
				info["base_url"] = tools.GetBaseUrl()
				value = info
			}
		}
		resps.Ok(c, "", value)
		return
	}
	value, err := repo.KV.GetKV(KeySiteInfo, utils.H{
		"metadata": utils.H{
			"name":        tools.GetSiteName(),
			"icon":        tools.GetSiteIcon(),
			"description": tools.GetSiteDescription(),
		},
		"color_schemes":        repo.KV.GetKVWithoutErr("color_schemes", []string{"blue", "green", "orange", "red", "rose", "pink", "violet", "yellow"}),
		"default_color_scheme": repo.KV.GetKVWithoutErr("default_color_scheme", "blue"),
		"default_cover": repo.KV.GetKVWithoutErr("default_cover", []string{
			"https://cdn.liteyuki.org/snowykami/image/1759709826590.webp",
			"https://cdn.liteyuki.org/snowykami/image/1759710439228.webp",
			"https://cdn.liteyuki.org/snowykami/image/1759710339517.webp",
			"https://cdn.liteyuki.org/snowykami/image/furina.png",
			"https://cdn.liteyuki.org/snowykami/image/1759710500693.webp",
		}),
		"owner": utils.H{
			"name":        repo.KV.GetKVWithoutErr("owner_name", "SnowyKami"),
			"description": repo.KV.GetKVWithoutErr("owner_description", "A full-stack developer."),
			"avatar":      repo.KV.GetKVWithoutErr("owner_avatar", "https://cdn.liteyuki.org/snowykami/avatar.jpg"),
		},
		"posts_per_page":            repo.KV.GetKVWithoutErr("posts_per_page", 10),
		"comments_per_page":         repo.KV.GetKVWithoutErr("comments_per_page", 10),
		"verify_code_cool_down":     repo.KV.GetKVWithoutErr("verify_code_cool_down", 60), // 单位秒
		"animation_duration_second": repo.KV.GetKVWithoutErr("animation_duration_second", 0.618),
		"footer": repo.KV.GetKVWithoutErr("footer", utils.H{
			"text": repo.KV.GetKVWithoutErr("footer_text", "Liteyuki ICP 114514"),
			"link": repo.KV.GetKVWithoutErr("footer_link", "https://sfkm.me"),
		}),
		"base_url": tools.GetBaseUrl(),
	})
	if err != nil {
		resps.InternalError(c, err)
		return
	}
	resps.Ok(c, "", value)
}

// publicConfigKeys 允许匿名读取的配置键
var publicConfigKeys = []string{
	KeySiteInfo, "site_name", "site_description", "site_icon", "base_url",
	"posts_per_page", "comments_per_page", "max_reply_depth", "enable_register", "enable_register_from_oidc",
	"visit_log_retention_days", // 隐私政策页展示访问记录保留天数
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

func (mc *MiscController) SetPublicConfig(ctx context.Context, c *app.RequestContext) {
	data := make(map[string]interface{})
	err := c.BindAndValidate(&data)
	if err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	for key, value := range data {
		err = repo.KV.SetKV(key, value)
		if err != nil {
			resps.InternalError(c, err)
			return
		}
	}
	resps.Ok(c, "", nil)
}

func (mc *MiscController) GetSitemapData(ctx context.Context, c *app.RequestContext) {
	// 此函数不加错误处理，能返回多少算多少
	var posts []model.Post
	repo.GetDB().Model(&model.Post{}).
		Select("id, slug, created_at, updated_at").
		Where("is_private = ?", false).
		Order("created_at DESC").
		Limit(utils2.Env.GetAsInt(constant.EnvKeySitemapLimit, constant.DefaultSitemapLimit)).
		Find(&posts)

	var editors []model.User
	repo.GetDB().Model(&model.User{}).
		Select("id, username, updated_at").
		Where("role IN ?", []constant.Role{constant.RoleEditor, constant.RoleAdmin}).
		Order("updated_at DESC").
		Limit(utils2.Env.GetAsInt(constant.EnvKeySitemapLimit, constant.DefaultSitemapLimit)).
		Find(&editors)

	var categories []model.Category
	repo.GetDB().Model(&model.Category{}).
		Select("id, slug, updated_at").
		Order("updated_at DESC").
		Limit(utils2.Env.GetAsInt(constant.EnvKeySitemapLimit, constant.DefaultSitemapLimit)).
		Find(&categories)

	var labels []model.Label
	repo.GetDB().Model(&model.Label{}).
		Select("id, name, slug, updated_at").
		Order("updated_at DESC").
		Limit(utils2.Env.GetAsInt(constant.EnvKeySitemapLimit, constant.DefaultSitemapLimit)).
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
		Limit(utils2.Env.GetAsInt(constant.EnvKeyRssLimit, constant.DefaultRssLimit)).
		Omit("draft_content").
		Preload("User").
		Preload("Category").
		Find(&posts).Error; err != nil {
		resps.InternalError(c, err)
		return
	}

	resps.Ok(c, "", map[string]any{
		"title":              repo.KV.GetKVWithoutErr(constant.KeySiteTitle, "Neo Blog Default Title"),
		"description":        repo.KV.GetKVWithoutErr(constant.KeySiteDescription, "The default description of Neo Blog."),
		"site_url":           tools.GetBaseUrl(),
		"feed_url":           tools.GetBaseUrl() + "/rss.xml",
		"author":             repo.KV.GetKVWithoutErr(constant.KeySiteAuthor, "Neo Bloger"),
		"copyright":          repo.KV.GetKVWithoutErr(constant.KeySiteCopyright, "CC BY-NC-SA 4.0"),
		"image_url":          repo.KV.GetKVWithoutErr(constant.KeySiteImage, ""),
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
