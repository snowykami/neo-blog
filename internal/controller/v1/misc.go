package v1

import (
	"context"
	"runtime"
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

var startTime = time.Now()

const (
	KeySiteInfo = "site_info"
)

type MiscController struct{}

func NewMiscController() *MiscController {
	return &MiscController{}
}

func (mc *MiscController) GetSiteInfo(ctx context.Context, c *app.RequestContext) {
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
		}(),
	})
}

// GetMetrics 获取应用的运行时指标，仅管理员可见
func (mc *MiscController) GetMetrics(ctx context.Context, c *app.RequestContext) {
	m := &runtime.MemStats{}
	runtime.ReadMemStats(m)
	resps.Ok(c, "", utils.H{
		"uptime":     time.Since(startTime),
		"goroutines": runtime.NumGoroutine(),

		"memory_total_alloc": m.TotalAlloc, // 所有被分配过的内存
		"memory_sys":         m.Sys,        // 系统内存占用量
		"memory_mallocs":     m.Mallocs,    // 内存分配次数
		"memory_frees":       m.Frees,      // 内存释放次数
		"memory_lookups":     m.Lookups,    // 指针查找次数

		"memory_heap_alloc":    m.HeapAlloc,    // 堆内存分配
		"memory_heap_sys":      m.HeapSys,      // 堆内存占用
		"memory_heap_inuse":    m.HeapInuse,    // 正在使用的堆内存
		"memory_heap_idle":     m.HeapIdle,     // 空闲的堆内存
		"memory_heap_released": m.HeapReleased, // 释放给操作系统的堆内存
		"memory_heap_objects":  m.HeapObjects,  // 堆内存对象数

		"memory_stack_sys":     m.StackSys,    // 栈内存占用
		"memory_stack_inuse":   m.StackInuse,  // 正在使用的栈内存
		"memory_m_span_sys":    m.MSpanSys,    // MSpan结构体占用内存
		"memory_m_span_inuse":  m.MSpanInuse,  // 正在使用的MSpan内存
		"memory_m_cache_sys":   m.MCacheSys,   // MCache结构体占用内存
		"memory_m_cache_inuse": m.MCacheInuse, // 正在使用的MCache内存
		"memory_buck_hash_sys": m.BuckHashSys, // 哈希表占用内存
		"memory_gc_sys":        m.GCSys,       // 垃圾回收器占用内存
		"memory_other_sys":     m.OtherSys,    // 其他内存占用

		"gc_next":           m.NextGC,        // 下一次垃圾回收的内存目标
		"gc_last":           m.LastGC,        // 上一次垃圾回收的时间
		"gc_pause_total_ns": m.PauseTotalNs,  // 垃圾回收总暂停时间
		"gc_num":            m.NumGC,         // 垃圾回收次数
		"gc_cpu_fraction":   m.GCCPUFraction, // GC CPU占用比例
		"gc_last_pause_ns": func() uint64 {
			if m.NumGC == 0 {
				return 0
			}
			idx := (int(m.NumGC) - 1) % len(m.PauseNs)
			if idx < 0 {
				idx += len(m.PauseNs)
			}
			return m.PauseNs[idx] // 单位：纳秒
		}(),
	})
}
