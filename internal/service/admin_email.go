package service

import (
	"errors"
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// SendTestEmail 用后台表单里当前填写的 SMTP 配置发一封测试邮件（没填的沿用已保存的配置），
// 确认邮件配置可用。只发信，不写库，也不改动已保存的配置；「启用邮件发送」关闭时同样可以测试
func (s *AdminService) SendTestEmail(req *dto.SendTestEmailReq) (*dto.SendTestEmailResp, *errs.ServiceError) {
	emailConfig, to, serr := resolveTestEmailConfig(req)
	if serr != nil {
		return nil, serr
	}
	// 测试邮件的验证码不参与校验，仅用于展示正文样式
	code := utils.Strings.GenerateRandomStringWithCharset(6, "0123456789")
	if serr := sendVerifyCodeEmail(emailConfig, to, code, true); serr != nil {
		// 只有管理员能看到这里的 SMTP 报错（如 connection refused），便于对照排查配置；
		// 去掉发送函数包的那层前缀，避免和错误码对应的文案重复
		if serr.Err != nil {
			cause := serr.Err
			if unwrapped := errors.Unwrap(cause); unwrapped != nil {
				cause = unwrapped
			}
			serr = serr.WithDetail(cause.Error())
		}
		return nil, serr
	}
	return &dto.SendTestEmailResp{To: to}, nil
}

// resolveTestEmailConfig 用请求里的字段覆盖已保存的配置，并校验能否发出邮件。
// 测试不受「启用邮件发送」开关限制，否则关着开关时无法验证配置
func resolveTestEmailConfig(req *dto.SendTestEmailReq) (*utils.EmailConfig, string, *errs.ServiceError) {
	emailConfig := *tools.GetEmailConfig()
	if host := strings.TrimSpace(req.Host); host != "" {
		emailConfig.Host = host
	}
	if req.Port > 0 {
		emailConfig.Port = req.Port
	}
	if req.SSL != nil {
		emailConfig.SSL = *req.SSL
	}
	if username := strings.TrimSpace(req.Username); username != "" {
		emailConfig.Username = username
	}
	if req.Password != "" {
		emailConfig.Password = req.Password
	}
	if address := strings.TrimSpace(req.Address); address != "" {
		emailConfig.Address = address
	}
	if strings.TrimSpace(emailConfig.Host) == "" || emailConfig.Port <= 0 {
		return nil, "", errs.NewBadRequest("email_not_configured").WithResource("email")
	}
	// 发件人地址同时也是 From，留空或格式不对时 SMTP 会拒绝，先给出明确的错误
	emailConfig.Address = strings.TrimSpace(emailConfig.Address)
	if emailConfig.Address == "" {
		return nil, "", errs.NewBadRequest("email_cannot_be_empty").WithField("email", "")
	}
	if !isValidEmail(emailConfig.Address) {
		return nil, "", errs.NewBadRequest("invalid_email").WithField("email", emailConfig.Address)
	}
	// 收件人默认是发件人自己，避免测试邮件发到无关地址
	to := strings.TrimSpace(req.To)
	if to == "" {
		to = emailConfig.Address
	}
	if !isValidEmail(to) {
		return nil, "", errs.NewBadRequest("invalid_email").WithField("email", to)
	}
	emailConfig.Enable = true
	return &emailConfig, to, nil
}
