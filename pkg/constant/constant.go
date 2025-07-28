package constant

const (
	CaptchaTypeDisable                     = "disable"   // 禁用验证码
	CaptchaTypeHCaptcha                    = "hcaptcha"  // HCaptcha验证码
	CaptchaTypeTurnstile                   = "turnstile" // Turnstile验证码
	CaptchaTypeReCaptcha                   = "recaptcha" // ReCaptcha验证码
	ContextKeyUserID                       = "user_id"   // 上下文键：用户ID
	ModeDev                                = "dev"
	ModeProd                               = "prod"
	RoleUser                               = "user"
	RoleAdmin                              = "admin"
	EnvKeyBaseUrl                          = "BASE_URL"       // 环境变量：基础URL
	EnvKeyLogLevel                         = "LOG_LEVEL"      // 环境变量：日志级别
	EnvKeyMode                             = "MODE"           // 环境变量：运行模式
	EnvKeyJwtSecrete                       = "JWT_SECRET"     // 环境变量：JWT密钥
	EnvKeyPasswordSalt                     = "PASSWORD_SALT"  // 环境变量：密码盐
	EnvKeyTokenDuration                    = "TOKEN_DURATION" // 环境变量：令牌有效期
	EnvKeyTokenDurationDefault             = 300
	EnvKeyRefreshTokenDurationDefault      = 604800
	EnvKeyRefreshTokenDuration             = "REFRESH_TOKEN_DURATION"               // 环境变量：刷新令牌有效期
	EnvKeyRefreshTokenDurationWithRemember = "REFRESH_TOKEN_DURATION_WITH_REMEMBER" // 环境变量：记住我刷新令牌有效期
	KVKeyEmailVerificationCode             = "email_verification_code:"             // KV存储：邮箱验证码
	KVKeyOidcState                         = "oidc_state:"                          // KV存储：OIDC状态
	ApiSuffix                              = "/api/v1"                              // API版本前缀
	OidcUri                                = "/user/oidc/login"                     // OIDC登录URI
	OidcProviderTypeMisskey                = "misskey"                              // OIDC提供者类型：Misskey
	OidcProviderTypeOauth2                 = "oauth2"                               // OIDC提供者类型：GitHub
	DefaultBaseUrl                         = "http://localhost:3000"                // 默认BaseUrl
	TargetTypePost                         = "post"
	TargetTypeComment                      = "comment"
	OrderByCreatedAt                       = "created_at"    // 按创建时间排序
	OrderByUpdatedAt                       = "updated_at"    // 按更新时间排序
	OrderByLikeCount                       = "like_count"    // 按点赞数排序
	OrderByCommentCount                    = "comment_count" // 按评论数排序
	OrderByViewCount                       = "view_count"    // 按浏览量排序
	OrderByHeat                            = "heat"
	HeatFactorViewWeight                   = 1  // 热度因子：浏览量权重
	HeatFactorLikeWeight                   = 5  // 热度因子：点赞权重
	HeatFactorCommentWeight                = 10 // 热度因子：评论权重
	PageLimitDefault                       = 20 // 默认分页大小
)

var (
	OrderByEnumPost    = []string{OrderByCreatedAt, OrderByUpdatedAt, OrderByLikeCount, OrderByCommentCount, OrderByViewCount, OrderByHeat} // 帖子可用的排序方式
	OrderByEnumComment = []string{OrderByCreatedAt, OrderByUpdatedAt, OrderByCommentCount}                                                  // 评论可用的排序方式
)
