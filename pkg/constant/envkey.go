package constant

const (
	EnvKeyBaseUrl                          = "BASE_URL" // 环境变量：基础URL
	EnvKeyPasscode                         = "CAPTCHA_DEV_PASSCODE"
	EnvKeyCaptchaProvider                  = "CAPTCHA_PROVIDER"   // captcha提供者
	EnvKeyCaptchaSecreteKey                = "CAPTCHA_SECRET_KEY" // captcha站点密钥
	EnvKeyCaptchaUrl                       = "CAPTCHA_URL"        // 某些自托管的captcha的url
	EnvKeyCaptchaSiteKey                   = "CAPTCHA_SITE_KEY"   // captcha密钥key
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
	EnvKeyEnableEmailVerify                = "ENABLE_EMAIL_VERIFY"
	EnvKeyFileDriverType                   = "FILE_DRIVER_TYPE"
	EnvKeyFileBasepath                     = "FILE_BASEPATH"
	EnvKeyFileWebdavUrl                    = "FILE_WEBDAV_URL"
	EnvKeyFileWebdavPassword               = "FILE_WEBDAV_PASSWORD"
	EnvKeyFileWebdavPolicy                 = "FILE_WEBDAV_POLICY"
	EnvKeyFileWebdavUser                   = "FILE_WEBDAV_USER"
	EnvKeyLocationFormat                   = "LOCATION_FORMAT"                      // 环境变量：时区格式
	EnvKeyLogLevel                         = "LOG_LEVEL"                            // 环境变量：日志级别
	EnvKeyMode                             = "MODE"                                 // 环境变量：运行模式
	EnvKeyJwtSecrete                       = "JWT_SECRET"                           // 环境变量：JWT密钥
	EnvKeyPasswordSalt                     = "PASSWORD_SALT"                        // 环境变量：密码盐
	EnvKeyRssLimit                         = "RSS_LIMIT"                            // 环境变量：RSS限制
	EnvKeySitemapLimit                     = "SITEMAP_LIMIT"                        // 环境变量：站点地图限制
	EnvKeyTokenDuration                    = "TOKEN_DURATION"                       // 环境变量：令牌有效期
	EnvKeyMaxReplyDepth                    = "MAX_REPLY_DEPTH"                      // 环境变量：最大回复深度
	DefaultTokenDuration                   = 10                                     // Token有效时长
	DefaultRefreshTokenDuration            = 604800                                 // refresh token有效时长
	EnvKeyRefreshTokenDuration             = "REFRESH_TOKEN_DURATION"               // 环境变量：刷新令牌有效期
	EnvKeyRefreshTokenDurationWithRemember = "REFRESH_TOKEN_DURATION_WITH_REMEMBER" // 环境变量：记住我刷新令牌有效期
)
