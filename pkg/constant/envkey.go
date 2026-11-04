package constant

const (
	EnvKeyBaseUrl                          = "BASE_URL"              // 环境变量：基础URL
	EnvKeyMusicTTMLURL                     = "MUSIC_TTML_URL_PREFIX" // 环境变量：自定义 TTML 歌词源地址（设置后优先于后台配置）
	EnvKeyPasscode                         = "CAPTCHA_DEV_PASSCODE"
	EnvKeyCaptchaProvider                  = "CAPTCHA_PROVIDER"   // captcha提供者
	EnvKeyCaptchaSecreteKey                = "CAPTCHA_SECRET_KEY" // captcha站点密钥
	EnvKeyCaptchaSiteKey                   = "CAPTCHA_SITE_KEY"   // captcha密钥key
	EnvKeyDBURL                            = "DB_URL"             // 环境变量：数据库连接地址（如 postgres://user:pass@host:5432/db 或 sqlite://./data/data.db），设置后忽略其他 DB_* 变量
	EnvKeyDBDriver                         = "DB_DRIVER"          // 环境变量：数据库驱动
	EnvKeyDBPath                           = "DB_PATH"            // 环境变量：数据库文件路径（仅适用于SQLite）
	EnvKeyDBHost                           = "DB_HOST"            // 环境变量：数据库主机（仅适用于PostgreSQL）
	EnvKeyDBPort                           = "DB_PORT"            // 环境变量：数据库端口（仅适用于PostgreSQL）
	EnvKeyDBUser                           = "DB_USER"            // 环境变量：数据库用户（仅适用于PostgreSQL）
	EnvKeyDBPassword                       = "DB_PASSWORD"        // 环境变量：数据库密码（仅适用于PostgreSQL）
	EnvKeyDBName                           = "DB_NAME"            // 环境变量：数据库名称（仅适用于PostgreSQL）
	EnvKeyDBSslMode                        = "DB_SSLMODE"         // 环境变量：数据库SSL模式（仅适用于PostgreSQL）
	EnvKeyEmailAddress                     = "EMAIL_ADDRESS"
	EnvKeyEmailEnable                      = "EMAIL_ENABLE"
	EnvKeyEmailHost                        = "EMAIL_HOST"
	EnvKeyEmailPort                        = "EMAIL_PORT"
	EnvKeyEmailUsername                    = "EMAIL_USERNAME"
	EnvKeyEmailPassword                    = "EMAIL_PASSWORD"
	EnvKeyEmailSsl                         = "EMAIL_SSL"
	EnvKeyEnableRegister                   = "ENABLE_REGISTER"
	EnvKeyEnableRegisterFromOidc           = "ENABLE_REGISTER_FROM_OIDC"
	EnvKeyEnableEmailVerify                = "ENABLE_EMAIL_VERIFY"
	EnvKeyLogLevel                         = "LOG_LEVEL"                            // 环境变量：日志级别
	EnvKeyMode                             = "MODE"                                 // 环境变量：运行模式
	EnvKeyJwtSecrete                       = "JWT_SECRET"                           // 环境变量：JWT密钥
	EnvKeyPasswordSalt                     = "PASSWORD_SALT"                        // 环境变量：密码盐
	EnvKeyRssLimit                         = "RSS_LIMIT"                            // 环境变量：RSS 输出的文章数（设置后优先于后台配置）
	EnvKeySitemapLimit                     = "SITEMAP_LIMIT"                        // 环境变量：站点地图每类条目的数量上限（设置后优先于后台配置）
	EnvKeyTokenDuration                    = "TOKEN_DURATION"                       // 环境变量：令牌有效期
	EnvKeyMaxReplyDepth                    = "MAX_REPLY_DEPTH"                      // 环境变量：最大回复深度
	EnvKeyRefreshTokenDuration             = "REFRESH_TOKEN_DURATION"               // 环境变量：刷新令牌有效期
	EnvKeyRefreshTokenDurationWithRemember = "REFRESH_TOKEN_DURATION_WITH_REMEMBER" // 环境变量：记住我刷新令牌有效期
	EnvKeyMaxRequestBodySize               = "MAX_REQUEST_BODY_SIZE"                // 环境变量：请求体（上传文件）大小上限，单位字节
	EnvKeyIP2RegionV6Path                  = "IP2REGION_V6_PATH"                    // 环境变量：ip2region IPv6 数据文件路径（可选，未设置时 IPv6 回退在线查询）
	EnvKeyPageHTMLOrigin                   = "PAGE_HTML_ORIGIN"                     // 环境变量：托管 HTML 页面的独立无 Cookie 源（如 https://html.example-usercontent.com），设置后 iframe 放开 allow-same-origin
	EnvKeyPageHTMLMaxTotalSize             = "PAGE_HTML_MAX_TOTAL_SIZE"             // 环境变量：HTML 页面单个版本解压后的总大小上限，单位字节
	EnvKeyPageHTMLMaxFiles                 = "PAGE_HTML_MAX_FILES"                  // 环境变量：HTML 页面单个版本的文件数上限
	EnvKeyPageHTMLMaxFileSize              = "PAGE_HTML_MAX_FILE_SIZE"              // 环境变量：HTML 页面单个文件的大小上限，单位字节
	EnvKeyRedisURL                         = "REDIS_URL"                            // 环境变量：Redis 地址（如 redis://:password@redis:6379/0），未设置时为单实例模式；多副本部署必须设置
	EnvKeyRedisKeyPrefix                   = "REDIS_KEY_PREFIX"                     // 环境变量：Redis 键前缀，多个应用共用一个 Redis 时区分，默认 neo-blog:
	EnvKeyAIAgentWorkers                   = "AI_AGENT_WORKERS"                     // 环境变量：每个实例执行 AI 用户任务的 worker 数（并发），默认 2，设为 0 时本实例不执行
)
