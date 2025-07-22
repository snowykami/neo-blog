package constant

const (
	CaptchaTypeDisable   = "disable"   // 禁用验证码
	CaptchaTypeHCaptcha  = "hcaptcha"  // HCaptcha验证码
	CaptchaTypeTurnstile = "turnstile" // Turnstile验证码
	CaptchaTypeReCaptcha = "recaptcha" // ReCaptcha验证码
	ModeDev              = "dev"
	ModeProd             = "prod"
	RoleUser             = "user"
	RoleAdmin            = "admin"

	EnvKeyBaseUrl                          = "BASE_URL"       // 环境变量：基础URL
	EnvKeyMode                             = "MODE"           // 环境变量：运行模式
	EnvKeyJwtSecrete                       = "JWT_SECRET"     // 环境变量：JWT密钥
	EnvKeyPasswordSalt                     = "PASSWORD_SALT"  // 环境变量：密码盐
	EnvKeyTokenDuration                    = "TOKEN_DURATION" // 环境变量：令牌有效期
	EnvKeyTokenDurationDefault             = 300
	EnvKeyRefreshTokenDuration             = "REFRESH_TOKEN_DURATION"               // 环境变量：刷新令牌有效期
	EnvKeyRefreshTokenDurationWithRemember = "REFRESH_TOKEN_DURATION_WITH_REMEMBER" // 环境变量：记住我刷新令牌有效期

	KVKeyEmailVerificationCode = "email_verification_code:" // KV存储：邮箱验证码
	KVKeyOidcState             = "oidc_state:"              // KV存储：OIDC状态

	OidcUri        = "/user/oidc/login"      // OIDC登录URI
	DefaultBaseUrl = "http://localhost:3000" // 默认BaseUrl

	TargetTypePost    = "post"
	TargetTypeComment = "comment"
)
