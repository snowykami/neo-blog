package utils

import (
	"fmt"

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

func (c *captchaUtils) GetCaptchaConfigFromEnv() *CaptchaConfig {
	return &CaptchaConfig{
		Type:      Env.Get(constant.EnvKeyCaptchaProvider, constant.CaptchaTypeDisable),
		SiteKey:   Env.Get(constant.EnvKeyCaptchaSiteKey, ""),
		SecretKey: Env.Get(constant.EnvKeyCaptchaSecreteKey, ""),
	}
}

// VerifyCaptcha 根据提供的配置和令牌验证验证码
func (c *captchaUtils) VerifyCaptcha(captchaConfig *CaptchaConfig, captchaToken string) (bool, error) {
	restyClient := resty.New()
	switch captchaConfig.Type {
	case constant.CaptchaTypeDisable:
		return true, nil
	case constant.CaptchaTypeHCaptcha:
		result := make(map[string]any)
		resp, err := restyClient.R().
			SetFormData(map[string]string{
				"secret":   captchaConfig.SecretKey,
				"response": captchaToken,
			}).SetResult(&result).Post("https://hcaptcha.com/siteverify")
		if err != nil {
			return false, err
		}
		if resp.IsError() {
			return false, nil
		}
		fmt.Printf("%#v\n", result)
		if success, ok := result["success"].(bool); ok && success {
			return true, nil
		} else {
			return false, nil
		}
	case constant.CaptchaTypeTurnstile:
		result := make(map[string]any)
		resp, err := restyClient.R().
			SetFormData(map[string]string{
				"secret":   captchaConfig.SecretKey,
				"response": captchaToken,
			}).SetResult(&result).Post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
		if err != nil {
			return false, err
		}
		if resp.IsError() {
			return false, nil
		}
		fmt.Printf("%#v\n", result)
		if success, ok := result["success"].(bool); ok && success {
			return true, nil
		} else {
			return false, nil
		}
	case constant.CaptchaTypeReCaptcha:
		result := make(map[string]any)
		resp, err := restyClient.R().
			SetFormData(map[string]string{
				"secret":   captchaConfig.SecretKey,
				"response": captchaToken,
			}).SetResult(&result).Post("https://www.google.com/recaptcha/api/siteverify")
		if err != nil {
			return false, err
		}
		if resp.IsError() {
			return false, nil
		}
		fmt.Printf("%#v\n", result)
		if success, ok := result["success"].(bool); ok && success {
			return true, nil
		} else {
			return false, nil
		}
	default:
		return false, fmt.Errorf("invalid captcha type: %s", captchaConfig.Type)
	}
}
