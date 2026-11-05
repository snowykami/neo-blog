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
	OidcAuthorizeUri           = "/user/oidc/authorize"     // 点击第三方登录时访问，生成 state 后跳转到身份提供商
	LoginPagePath              = "/auth/login"              // 前端登录页，第三方登录失败时带上错误码回到这里
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

// 访问记录的用户归属来源：登录前的匿名访问在登录后补记到该用户，访问时已登录的记录为空
const (
	VisitUserSourceBrowser     = "browser"     // 同一浏览器（访客 Cookie）之后登录了该用户
	VisitUserSourceFingerprint = "fingerprint" // 按浏览器指纹与 IP 段推断为同一人
)

// 访问的可信度结论：由浏览器信号、请求头与 IP 归属地的一致性检测得出
const (
	VisitTrustTrusted = "trusted" // 各项信号互相吻合
	VisitTrustProxy   = "proxy"   // IP 与时区、语言矛盾或属于机房，多半经过代理
	VisitTrustSpoofed = "spoofed" // 浏览器自报信息互相矛盾
	VisitTrustBot     = "bot"     // 存在自动化特征，不计入浏览量与访客数
	VisitTrustUnknown = "unknown" // 开启请勿追踪或缺少浏览器信号
)

// 页面内事件类型，由兼容 Plausible 的上报接口写入
const (
	VisitEventOutbound = "outbound"  // 点击外链
	VisitEventDownload = "download"  // 下载文件
	VisitEventWebVital = "web_vital" // Web Vitals 性能指标
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

	ScopeAIAgentsRead  = "ai_agents:read"  // 查找、读取 AI 用户的资料、性格档案与运行记录（仅管理员）
	ScopeAIAgentsWrite = "ai_agents:write" // 按导入文件新建或更新 AI 用户、试运行（仅管理员）
)

// APITokenScopes 全部可选的 API Token 权限范围
var APITokenScopes = []string{ScopePostsRead, ScopePostsWrite, ScopePostsPublish, ScopeFilesWrite, ScopeAIAgentsRead, ScopeAIAgentsWrite}

// AI 用户：由 Agent 驱动、与普通用户同权限的账号（users.is_ai = true）
const (
	// 以下权限范围只授予执行中的 AI 用户运行，不出现在个人 API Token 的可选范围里
	ScopeCommentsWrite = "comments:write" // 发表评论 / 回复
	ScopeLikesWrite    = "likes:write"    // 点赞 / 取消点赞
	ScopeProfileWrite  = "profile:write"  // 修改自己的昵称、头像、背景、主题色

	AIAgentTierAmbient = "ambient" // 氛围型：一次调用给出操作列表
	AIAgentTierExpert  = "expert"  // 专业型：可多步阅读（只读工具）后给出操作列表

	AIAgentStatusActive = "active"
	AIAgentStatusPaused = "paused"

	AgentRunKindBrowse = "browse"  // 时间引擎唤醒，主动浏览
	AgentRunKindEvent  = "event"   // 事件触发：新文章、被回复
	AgentRunKindDryRun = "dry_run" // 后台试运行：只输出操作列表，不执行

	AgentTriggerBrowse         = "browse"
	AgentTriggerPostPublished  = "post.published"
	AgentTriggerCommentReplied = "comment.replied"
	AgentTriggerDryRun         = "dry_run"

	AgentRunStatusQueued  = "queued"
	AgentRunStatusLeased  = "leased"
	AgentRunStatusDone    = "done"
	AgentRunStatusSkipped = "skipped"
	AgentRunStatusFailed  = "failed"

	AgentActionLike          = "like"
	AgentActionComment       = "comment"
	AgentActionReply         = "reply"
	AgentActionUpdateProfile = "update_profile"
	AgentActionSetAvatar     = "set_avatar"

	AgentMemoryKindEpisode   = "episode"   // 情景记忆：一次互动
	AgentMemoryKindMilestone = "milestone" // 里程碑：如成为熟人
)
