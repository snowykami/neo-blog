package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/resps"
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
		"metadata": utils.H{
			"name":        "Neo Blog S",
			"icon":        "https://cdn.liteyuki.org/snowykami/avatar.jpg",
			"description": "A neo blog system.",
		},
		"color_schemes": []string{"blue", "green", "orange", "red", "rose", "violet", "yellow"},
		"default_cover": "https://cdn.liteyuki.org/blog/background.png",
		"owner": utils.H{
			"name":        "SnowyKami",
			"description": "A full-stack developer.",
			"avatar":      "https://cdn.liteyuki.org/snowykami/avatar.jpg",
		},
		"posts_per_page":            9,
		"comments_per_page":         8,
		"verify_code_cool_down":     60,
		"animation_duration_second": 0.618,
		"footer": utils.H{
			"text":  "Liteyuki ICP 114514",
			"links": []string{"https://www.liteyuki.com/"},
		},
	})
	if err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	resps.Ok(c, "", value)
}

func (mc *MiscController) SetSiteInfo(ctx context.Context, c *app.RequestContext) {
	data := make(map[string]interface{})
	err := c.BindAndValidate(&data)
	if err != nil {
		resps.BadRequest(c, err.Error())
		return
	}
	err = repo.KV.SetKV(KeySiteInfo, data)
	if err != nil {
		resps.InternalServerError(c, err.Error())
	}
	resps.Ok(c, "", nil)
}
