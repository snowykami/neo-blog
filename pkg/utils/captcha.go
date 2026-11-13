package utils

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
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

// captchaHTTPClient 与 captchaClient 为包级复用的带 5s 超时客户端，避免每次校验重复创建连接池且杜绝无超时阻塞
var (
	captchaHTTPClient = &http.Client{Timeout: captchaVerifyTimeout}
	captchaClient     = resty.NewWithClient(captchaHTTPClient).SetTimeout(captchaVerifyTimeout)
)

var captchaVerifyEndpoints = map[string]string{
	constant.CaptchaTypeHCaptcha:  "https://hcaptcha.com/siteverify",
	constant.CaptchaTypeTurnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
	constant.CaptchaTypeReCaptcha: "https://www.google.com/recaptcha/api/siteverify",
}

// VerifyCaptcha 根据提供的配置和令牌验证验证码
func (c *captchaUtils) VerifyCaptcha(captchaConfig *CaptchaConfig, captchaToken string) (bool, error) {
	if captchaConfig == nil || captchaConfig.Type == constant.CaptchaTypeDisable {
		return true, nil
	}
	token := strings.TrimSpace(captchaToken)
	if token == "" {
		return false, nil
	}
	verifyURL, ok := captchaVerifyEndpoints[captchaConfig.Type]
	if !ok {
		return false, fmt.Errorf("invalid captcha type: %s", captchaConfig.Type)
	}

	result := make(map[string]any)
	resp, err := captchaClient.R().
		SetFormData(map[string]string{
			"secret":   captchaConfig.SecretKey,
			"response": token,
		}).SetResult(&result).Post(verifyURL)
	if err != nil {
		logrus.Warnf("captcha verify request (%s) failed: %v", captchaConfig.Type, err)
		return false, err
	}
	if resp.IsStatusFailure() {
		logrus.Warnf("captcha verify (%s) unexpected status: %d", captchaConfig.Type, resp.StatusCode())
		return false, nil
	}
	success, ok := result["success"].(bool)
	return ok && success, nil
}
