package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// SendTestEmail 用后台当前填写的 SMTP 配置发一封测试邮件，确认邮件配置可用（不修改已保存的配置）
func (cc *AdminController) SendTestEmail(ctx context.Context, c *app.RequestContext) {
	var req dto.SendTestEmailReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	result, svcerr := cc.service.SendTestEmail(&req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}
