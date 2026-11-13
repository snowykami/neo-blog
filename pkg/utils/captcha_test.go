package utils

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestVerifyCaptchaShortCircuitAndClientReuse(t *testing.T) {
	if captchaHTTPClient.Timeout != 5*time.Second || captchaClient.Timeout() != 5*time.Second {
		t.Fatalf("expected package-level captcha client timeout 5s, got http=%v resty=%v", captchaHTTPClient.Timeout, captchaClient.Timeout())
	}

	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_ = r.ParseForm()
		w.Header().Set("Content-Type", "application/json")
		ok := r.FormValue("secret") == "sec" && r.FormValue("response") == "good-token"
		_ = json.NewEncoder(w).Encode(map[string]any{"success": ok})
	}))
	defer srv.Close()

	origURL := captchaVerifyEndpoints[constant.CaptchaTypeTurnstile]
	captchaVerifyEndpoints[constant.CaptchaTypeTurnstile] = srv.URL
	defer func() { captchaVerifyEndpoints[constant.CaptchaTypeTurnstile] = origURL }()

	cfg := &CaptchaConfig{
		Type:      constant.CaptchaTypeTurnstile,
		SecretKey: "sec",
	}

	// 1. 空字符串或纯空白 token 必须前置短路返回 false，不触发任何网络请求
	for _, empty := range []string{"", "   ", "\t\n"} {
		ok, err := Captcha.VerifyCaptcha(cfg, empty)
		if err != nil || ok {
			t.Fatalf("VerifyCaptcha(%q) = (%v, %v), want (false, nil)", empty, ok, err)
		}
	}
	if hits.Load() != 0 {
		t.Fatalf("expected 0 network calls on blank tokens, got %d", hits.Load())
	}

	// 2. 禁用验证码直接放行
	if ok, err := Captcha.VerifyCaptcha(&CaptchaConfig{Type: constant.CaptchaTypeDisable}, ""); err != nil || !ok {
		t.Fatalf("disabled captcha should pass: ok=%v err=%v", ok, err)
	}

	// 3. 正常校验（带空白裁剪）与失败校验复用同一客户端
	if ok, err := Captcha.VerifyCaptcha(cfg, "  good-token  "); err != nil || !ok {
		t.Fatalf("valid token failed: ok=%v err=%v", ok, err)
	}
	if ok, err := Captcha.VerifyCaptcha(cfg, "bad-token"); err != nil || ok {
		t.Fatalf("invalid token should return false: ok=%v err=%v", ok, err)
	}
	if hits.Load() != 2 {
		t.Fatalf("expected 2 network calls, got %d", hits.Load())
	}

	// 4. 未知类型返回错误
	if ok, err := Captcha.VerifyCaptcha(&CaptchaConfig{Type: "unknown"}, "tok"); err == nil || ok {
		t.Fatalf("expected error for unknown captcha type, got ok=%v err=%v", ok, err)
	}
}
