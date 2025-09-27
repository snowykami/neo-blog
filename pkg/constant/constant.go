package constant

const (
	CaptchaTypeDisable   = "disable"     // 禁用验证码
	CaptchaTypeHCaptcha  = "hcaptcha"    // HCaptcha验证码
	CaptchaTypeTurnstile = "turnstile"   // Turnstile验证码
	CaptchaTypeReCaptcha = "recaptcha"   // ReCaptcha验证码
	ContextKeyUserID     = "user_id"     // 上下文键：用户ID
	ContextKeyRemoteAddr = "remote_addr" // 上下文键：远程地址
	ContextKeyUserAgent  = "user_agent"  // 上下文键：用户代理
	ModeDev              = "dev"
	ModeProd             = "prod"
	RoleUser             = "user"   // 普通用户 仅有阅读和评论权限
	RoleEditor           = "editor" // 能够发布和管理自己内容的用户
	RoleAdmin            = "admin"
	DefaultFileBasePath  = "./data/uploads"

	FileDriverTypeLocal        = "local"
	FileDriverTypeWebdav       = "webdav"
	FileDriverTypeS3           = "s3"
	KVKeyEmailVerificationCode = "email_verification_code:" // KV存储：邮箱验证码
	KVKeyOidcState             = "oidc_state:"              // KV存储：OIDC状态
	ApiSuffix                  = "/api/v1"                  // API版本前缀
	OidcUri                    = "/user/oidc/login"         // OIDC登录URI
	OidcProviderTypeMisskey    = "misskey"                  // OIDC提供者类型：Misskey
	OidcProviderTypeOauth2     = "oauth2"                   // OIDC提供者类型：GitHub
	DefaultCaptchaDevPasscode  = "dev_passcode"
	DefaultBaseUrl             = "http://localhost:3000" // 默认BaseUrl
	DefaultPasswordSalt        = "default_salt_114514"
	DefaultRssLimit            = 30
	DefaultSitemapLimit        = 5000
	TargetTypePost             = "post"
	TargetTypeComment          = "comment"
	WebdavPolicyProxy          = "proxy"
	WebdavPolicyRedirect       = "redirect"
	OrderByCreatedAt           = "created_at"    // 按创建时间排序
	OrderByUpdatedAt           = "updated_at"    // 按更新时间排序
	OrderByLikeCount           = "like_count"    // 按点赞数排序
	OrderByCommentCount        = "comment_count" // 按评论数排序
	OrderByViewCount           = "view_count"    // 按浏览量排序
	OrderByHeat                = "heat"
	MaxReplyDepthDefault       = 3  // 默认最大回复深度
	HeatFactorViewWeight       = 1  // 热度因子：浏览量权重
	HeatFactorLikeWeight       = 5  // 热度因子：点赞权重
	HeatFactorCommentWeight    = 10 // 热度因子：评论权重
	PageLimitDefault           = 20 // 默认分页大小
)

var (
	OrderByEnumPost    = []string{OrderByCreatedAt, OrderByUpdatedAt, OrderByLikeCount, OrderByCommentCount, OrderByViewCount, OrderByHeat} // 帖子可用的排序方式
	OrderByEnumComment = []string{OrderByCreatedAt, OrderByUpdatedAt, OrderByCommentCount}                                                  // 评论可用的排序方式
)
