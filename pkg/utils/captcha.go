package utils

import (
	"fmt"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/pkg/constant"
	"resty.dev/v3"
)

type captchaUtils struct{}

var Captcha = captchaUtils{}

type CaptchaConfig struct {
	Type      string
	SiteKey   string // Site secret key for the captcha service
	SecretKey string // Secret key for the captcha service
}

const captchaVerifyTimeout = 5 * time.Second

// VerifyCaptcha 根据提供的配置和令牌验证验证码
func (c *captchaUtils) VerifyCaptcha(captchaConfig *CaptchaConfig, captchaToken string) (bool, error) {
	if captchaConfig == nil || captchaConfig.Type == constant.CaptchaTypeDisable {
		return true, nil
	}
	var verifyURL string
	switch captchaConfig.Type {
	case constant.CaptchaTypeHCaptcha:
		verifyURL = "https://hcaptcha.com/siteverify"
	case constant.CaptchaTypeTurnstile:
		verifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
	case constant.CaptchaTypeReCaptcha:
		verifyURL = "https://www.google.com/recaptcha/api/siteverify"
	default:
		return false, fmt.Errorf("invalid captcha type: %s", captchaConfig.Type)
	}
	if strings.TrimSpace(captchaToken) == "" {
		return false, nil
	}

	restyClient := resty.New().SetTimeout(captchaVerifyTimeout)
	defer restyClient.Close() // resty v3 客户端用完需 Close，释放后台资源

	result := make(map[string]any)
	resp, err := restyClient.R().
		SetFormData(map[string]string{
			"secret":   captchaConfig.SecretKey,
			"response": captchaToken,
		}).SetResult(&result).Post(verifyURL)
	if err != nil {
		return false, err
	}
	if resp.IsStatusFailure() {
		return false, nil
	}
	success, ok := result["success"].(bool)
	return ok && success, nil
}
