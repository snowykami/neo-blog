package v1

import (
	"context"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
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
	value, err := repo.KV.GetKV(KeySiteInfo, utils.H{
		"metadata": repo.KV.GetKVWithoutErr("metadata", utils.H{
			"name":        "Snowykami's Blog",
			"icon":        "https://cdn.liteyuki.org/snowykami/avatar_alpha.png",
			"description": "A neo blog system",
		}),
		"color_schemes": repo.KV.GetKVWithoutErr("color_schemes", []string{"blue", "green", "orange", "red", "rose", "pink", "violet", "yellow"}),
		"default_cover": repo.KV.GetKVWithoutErr("default_cover", "https://cdn.liteyuki.org/blog/background.png"),
		"owner": repo.KV.GetKVWithoutErr("owner", utils.H{
			"name":        "SnowyKami",
			"description": "A full-stack developer.",
			"avatar":      "https://cdn.liteyuki.org/snowykami/avatar.jpg",
		}),
		"posts_per_page":            repo.KV.GetKVWithoutErr("posts_per_page", 10),
		"comments_per_page":         repo.KV.GetKVWithoutErr("comments_per_page", 10),
		"verify_code_cool_down":     repo.KV.GetKVWithoutErr("verify_code_cool_down", 60), // 单位秒
		"animation_duration_second": repo.KV.GetKVWithoutErr("animation_duration_second", 0.618),
		"footer": repo.KV.GetKVWithoutErr("footer", utils.H{
			"text":  "Liteyuki ICP 114514",
			"links": []string{"https://www.liteyuki.com/"},
		}),
		"base_url": tools.GetBaseUrl(),
	})
	if err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	resps.Ok(c, "", value)
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
		resps.BadRequest(c, err.Error())
		return
	}
	for key, value := range data {
		err = repo.KV.SetKV(key, value)
		if err != nil {
			resps.InternalServerError(c, err.Error())
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
		Where("role IN ?", []string{constant.RoleEditor, constant.RoleAdmin}).
		Order("updated_at DESC").
		Limit(utils2.Env.GetAsInt(constant.EnvKeySitemapLimit, constant.DefaultSitemapLimit)).
		Find(&editors)

		// TODO: 未来可以考虑加入 categories, labels, archives

	resps.Ok(c, "", utils.H{
		"base_url":   tools.GetBaseUrl(),
		"archives":   []string{},
		"labels":     []string{},
		"categories": []string{},
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
		Preload("User").
		Find(&posts).Error; err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}

	resps.Ok(c, "", map[string]any{
		"title":              repo.KV.GetKVWithoutErr(constant.KeySiteTitle, "Neo Blog Default Title"),
		"description":        repo.KV.GetKVWithoutErr(constant.KeySiteDescription, "The default description of Neo Blog."),
		"site_url":           repo.KV.GetKVWithoutErr(constant.KeyBaseUrl, utils2.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl)),
		"feed_url":           repo.KV.GetStringWithoutErr(constant.KeyBaseUrl, utils2.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl)) + "/rss.xml",
		"author":             repo.KV.GetKVWithoutErr(constant.KeySiteAuthor, "Neo Bloger"),
		"copyright":          repo.KV.GetKVWithoutErr(constant.KeySiteCopyright, "CC BY-NC-SA 4.0"),
		"image_url":          repo.KV.GetKVWithoutErr(constant.KeySiteImage, ""),
		"language":           repo.KV.GetKVWithoutErr(constant.KeyDefaultLanguage, "en-us"),
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
		}()})
}
