package constant

type Role string

const (
	RoleUser   Role = "user"   // 普通用户 仅有阅读和评论权限
	RoleEditor Role = "editor" // 能够发布和管理自己内容的用户
	RoleAdmin  Role = "admin"
)

const (
	CaptchaTypeDisable         = "disable"   // 禁用验证码
	CaptchaTypeHCaptcha        = "hcaptcha"  // HCaptcha验证码
	CaptchaTypeTurnstile       = "turnstile" // Turnstile验证码
	CaptchaTypeReCaptcha       = "recaptcha" // ReCaptcha验证码
	ModeDev                    = "dev"
	ModeProd                   = "prod"
	KVKeyEmailVerificationCode = "email_verification_code:" // KV存储：邮箱验证码
	ApiPrefix                  = "/api/v1"                  // API版本前缀
	OidcUri                    = "/user/oidc/login"         // OIDC登录URI
	FileUriPrefix              = "/file/f"                  // 文件访问URI前缀
	PageHTMLUriPrefix          = "/page-html"               // HTML 页面静态文件访问URI前缀
	DefaultCaptchaDevPasscode  = "dev_passcode"
	DefaultBaseUrl             = "http://localhost:3000" // 默认BaseUrl
	DefaultPasswordSalt        = "default_salt_114514"
	DefaultRssLimit            = 30
	DefaultSitemapLimit        = 5000
	TargetTypePost             = "post"
	TargetTypePage             = "page"
	TargetTypeComment          = "comment"
	OrderByCreatedAt           = "created_at"    // 按创建时间排序
	OrderByUpdatedAt           = "updated_at"    // 按更新时间排序
	OrderByLikeCount           = "like_count"    // 按点赞数排序
	OrderByCommentCount        = "comment_count" // 按评论数排序
	OrderByViewCount           = "view_count"    // 按浏览量排序
	OrderByHeat                = "heat"
	MaxReplyDepthDefault       = 3          // 默认最大回复深度
	PageLimitDefault           = 20         // 默认分页大小
	DefaultMaxRequestBodySize  = 1000 << 20 // 默认请求体上限 1000MiB
)

// HTML 页面上传的默认上限与保留的版本数
const (
	DefaultPageHTMLMaxTotalSize = 100 << 20 // 单个版本解压后的总大小 100MiB
	DefaultPageHTMLMaxFiles     = 1000      // 单个版本的文件数
	DefaultPageHTMLMaxFileSize  = 50 << 20  // 单个文件 50MiB
	PageHTMLKeepVersions        = 5         // 每个页面保留最近的版本数（当前生效的版本始终保留）
)

var (
	OrderByEnumPost    = []string{OrderByCreatedAt, OrderByUpdatedAt, OrderByLikeCount, OrderByCommentCount, OrderByViewCount, OrderByHeat, "top"} // 帖子可用的排序方式
	OrderByEnumComment = []string{OrderByCreatedAt, OrderByUpdatedAt, OrderByCommentCount, OrderByLikeCount}                                       // 评论可用的排序方式
	OrderByEnumPage    = []string{OrderByCreatedAt, OrderByUpdatedAt, "nav_order", "title"}                                                        // 页面可用的排序方式
	OrderByEnumFile    = []string{OrderByCreatedAt, OrderByUpdatedAt, "name", "size"}                                                              // 文件可用的排序方式
	OrderByEnumUser    = []string{OrderByCreatedAt, OrderByUpdatedAt, "id", "username"}                                                            // 用户可用的排序方式
)

// 访客记录中的行为类型：访问之外的站内互动也记入同一条时间线
const (
	VisitActionVisit   = "visit"   // 访问页面
	VisitActionLike    = "like"    // 点赞文章或评论
	VisitActionComment = "comment" // 评论文章/页面，目标为评论时即回复
)

// 资产库列表范围与类型筛选
const (
	FileScopeMine = "mine"
	FileScopeAll  = "all"

	FileTypeImage = "image"
	FileTypeVideo = "video"
	FileTypeAudio = "audio"
	FileTypeOther = "other"
)

// 管理员用户列表的状态筛选
const (
	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"
)

// 个人 API Token：供外部 AI 工具（MCP）等以用户身份调用，权限为 Token 权限范围与用户角色的交集
const (
	APITokenPrefix = "nbp_" // Token 明文前缀，便于识别与密钥扫描

	ScopePostsRead    = "posts:read"    // 读取文章（含本人 / 管理员可见的草稿）
	ScopePostsWrite   = "posts:write"   // 创建文章、写入草稿；不会改动任何公开可见的内容
	ScopePostsPublish = "posts:publish" // 发布 / 取消发布，以及修改公开文章的元信息
	ScopeFilesWrite   = "files:write"   // 上传图片
)

// APITokenScopes 全部可选的 API Token 权限范围
var APITokenScopes = []string{ScopePostsRead, ScopePostsWrite, ScopePostsPublish, ScopeFilesWrite}
