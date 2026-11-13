package service

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/ipregion"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type UserService struct{}

func NewUserService() *UserService {
	return &UserService{}
}

type oidcLoginState struct {
	Name         string
	RedirectBack string
	IsBind       bool
	Nonce        string // 与浏览器 Cookie 中的 nonce 对应，防止登录/绑定 CSRF
	UserID       uint   // 绑定操作的发起用户，回调时必须是同一用户
	CodeVerifier string // PKCE code_verifier，换取令牌时发送
}

const (
	oidcStateKeyPrefix = "oidc_state:"
	// 点击登录时才生成 state，有效期覆盖在第三方页面登录、授权的时间，与 nonce Cookie 一致
	oidcStateTTL = 10 * time.Minute
)

const (
	loginLimitWindow       = 15 * time.Minute
	loginIPLimit           = 30  // 同一 IP 在窗口内最多登录请求数
	loginAccountFailLimit  = 10  // 同一账号在窗口内最多失败次数
	verifyEmailIPLimit     = 10  // 同一 IP 每小时最多发送验证码次数
	verifyEmailUserLimit   = 5   // 同一已登录账号每小时最多发送验证码次数
	verifyEmailGlobalLimit = 300 // 全站每小时最多发送验证码次数，防止分布式代理耗尽 SMTP 配额
)

// EmailVerifyEnabled 是否开启邮箱验证（环境变量 ENABLE_EMAIL_VERIFY 优先，其次后台配置 enable_email_verify，默认开启）：
// 开启时注册、找回密码、改邮箱都要邮箱验证码
func EmailVerifyEnabled() bool {
	return config.Bool("enable_email_verify")
}

// UserLogin 用户登录
func (s *UserService) UserLogin(req *dto.UserLoginReq) (*dto.UserLoginResp, *errs.ServiceError) {
	// 防爆破：同一 IP 的登录请求和同一账号的失败次数都有上限
	if !utils.AllowRequest("login_ip:"+req.UserIP, loginIPLimit, loginLimitWindow) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	accountKey := "login_fail:" + strings.ToLower(req.Username)
	if utils.TooManyFailures(accountKey, loginAccountFailLimit) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	// 按照用户名或邮箱查找用户；用户不存在与密码错误返回相同错误，避免枚举用户
	user, err := repo.User.GetUserByUsernameOrEmail(req.Username)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("user")
	}
	if user == nil || err != nil || !utils.Password.VerifyPassword(req.Password, user.Password) {
		utils.RecordFailure(accountKey, loginLimitWindow)
		return nil, errs.NewBadRequest("invalid_credentials")
	}
	utils.ResetFailures(accountKey)
	// AI 用户不能密码登录，只由后端的 worker 以其身份行动；与密码错误返回相同错误，不暴露账号类型
	if user.IsAI {
		return nil, errs.NewBadRequest("invalid_credentials")
	}
	if user.Disabled {
		return nil, errs.NewForbidden("user_disabled")
	}
	// 签发双token并持久化会话状态
	sessionId := utils.Strings.GenerateRandomString(32)
	err = repo.Session.CreateSession(&model.Session{
		UserID:    user.ID,
		SessionID: sessionId,
		UserIP:    utils.NewIPRecord(req.UserIP),
	})
	if err != nil {
		return nil, errs.Internal("failed_to_create_target", err).WithResource("session")
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(user.ID, sessionId, req.RememberMe)

	if err != nil {
		logrus.Errorln("Failed to generate tokens:", err)
		return nil, errs.Internal("failed_to_create_target", err).WithResource("user")
	}
	resp := &dto.UserLoginResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user.ToPrivateDto(),
	}
	return resp, nil
}

// UserRegister 注册新用户
func (s *UserService) UserRegister(req *dto.UserRegisterReq) (*dto.UserRegisterResp, *errs.ServiceError) {
	if !tools.GetAllowRegister() {
		return nil, errs.NewForbidden("register_disabled")
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Nickname = strings.TrimSpace(req.Nickname)
	req.Email = strings.TrimSpace(req.Email)
	if !isValidUsername(req.Username) {
		return nil, errs.NewBadRequest("invalid_username")
	}
	if utf8.RuneCountInString(req.Nickname) > nicknameMaxLen {
		return nil, errs.NewBadRequest("invalid_nickname")
	}
	if !isValidPassword(req.Password) {
		return nil, errs.NewBadRequest("invalid_password_format")
	}
	if !isValidEmail(req.Email) {
		return nil, errs.NewBadRequest("invalid_email").WithField("email", req.Email)
	}
	// 先检查用户名与邮箱未被占用，避免输入已被占用的用户名时白白消耗一次性邮箱验证码
	if svcerr := checkUsernameEmailFree(req.Username, req.Email, 0); svcerr != nil {
		return nil, svcerr
	}
	// 开启邮箱验证时，注册必须验证邮箱所有权，防止抢注他人邮箱
	if EmailVerifyEnabled() && !utils.VerifyEmailCode(req.Email, req.VerifyCode) {
		return nil, errs.NewUnauthorized("invalid_verify_code")
	}
	hashedPassword, err := utils.Password.HashPassword(req.Password)
	if err != nil {
		return nil, errs.Internal("failed_to_create_target", err).WithResource("user")
	}
	newUser := &model.User{
		Username: req.Username,
		Nickname: req.Nickname,
		Email:    req.Email,
		Role:     constant.RoleUser,
		Password: hashedPassword,
	}
	err = repo.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(newUser).Error; err != nil {
			return err
		}
		if newUser.ID == 1 {
			newUser.Role = constant.RoleAdmin
			if err := tx.Model(newUser).UpdateColumn("role", constant.RoleAdmin).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, errs.NewConflict("username_or_email_already_exists")
		}
		return nil, errs.Internal("failed_to_create_target", err).WithResource("user")
	}
	repo.TouchCacheTags(repo.CacheTagUsers)
	SyncSearchUser(newUser.ID, false)
	// 生成访问令牌和刷新令牌并保存session
	sessionId := utils.Strings.GenerateRandomString(32)
	err = repo.Session.CreateSession(&model.Session{
		UserID:    newUser.ID,
		SessionID: sessionId,
		UserIP:    utils.NewIPRecord(req.UserIP),
	})
	if err != nil {
		return nil, errs.Internal("failed_to_create_target", err).WithResource("session")
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(newUser.ID, sessionId, false)

	if err != nil {
		return nil, errs.Internal("failed_to_create_target", err).WithResource("user")
	}
	resp := &dto.UserRegisterResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         newUser.ToPrivateDto(),
	}
	return resp, nil
}

func (s *UserService) RequestVerifyEmail(req *dto.VerifyEmailReq) (*dto.VerifyEmailResp, *errs.ServiceError) {
	if !EmailVerifyEnabled() {
		return nil, errs.NewForbidden("email_verify_disabled")
	}
	// 邮箱格式不对时不发送，也不占用冷却时间
	if !isValidEmail(req.Email) {
		return nil, errs.NewBadRequest("invalid_email").WithField("email", req.Email)
	}
	// 站点没有配置邮件服务：这是站点的设置而不是后端故障，按业务错误返回（不记入错误报告），前台据此提示联系管理员
	emailConfig := tools.GetEmailConfig()
	if !emailConfig.Usable() {
		return nil, errs.NewForbidden("email_service_unavailable")
	}
	// 同一邮箱按冷却时间限制发送频率，同一 IP / 账号与全站每小时都有上限，防止邮件轰炸与配额耗尽
	coolDown := time.Duration(tools.GetVerifyCodeCoolDown()) * time.Second
	emailKey := "verify_email:" + strings.ToLower(req.Email)
	if !utils.AllowRequest(emailKey, 1, coolDown) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	if req.UserID != 0 && !utils.AllowRequest("verify_email_user:"+strconv.FormatUint(uint64(req.UserID), 10), verifyEmailUserLimit, time.Hour) {
		utils.ResetFailures(emailKey)
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	if !utils.AllowRequest("verify_email_ip:"+req.UserIP, verifyEmailIPLimit, time.Hour) {
		utils.ResetFailures(emailKey)
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	if !utils.AllowRequest("verify_email_global_hour", verifyEmailGlobalLimit, time.Hour) {
		utils.ResetFailures(emailKey)
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	verifyCode := utils.RequestEmailVerify(req.Email)
	if utils.IsDevMode {
		logrus.Debugf("%s's verification code is %s", req.Email, verifyCode)
	}
	if serr := sendVerifyCodeEmail(emailConfig, req.Email, verifyCode, false); serr != nil {
		// 没发出去不算一次发送：清掉这个邮箱的冷却，用户可以立即重试（同一 IP 的每小时上限仍然计数）
		utils.ResetFailures(emailKey)
		return nil, serr
	}
	return &dto.VerifyEmailResp{Success: true}, nil
}

// ListOidcConfigs 已启用的第三方登录，只含展示信息，不产生任何状态；state 在点击登录时由 OidcAuthorize 生成
func (s *UserService) ListOidcConfigs() ([]dto.UserOidcConfigDto, *errs.ServiceError) {
	enabledOidcConfigs, err := repo.Oidc.ListOidcConfigs(true)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("oidc_config")
	}
	oidcConfigsDtos := make([]dto.UserOidcConfigDto, 0, len(enabledOidcConfigs))
	for _, oidcConfig := range enabledOidcConfigs {
		oidcConfigsDtos = append(oidcConfigsDtos, *oidcConfig.ToUserDto())
	}
	return oidcConfigsDtos, nil
}

// OidcAuthorize 用户点击第三方登录时生成一次性 state（含 PKCE code_verifier），返回跳转到身份提供商的地址。
// 页面上的登录按钮只是普通链接，不会因为页面停留太久而失效
func (s *UserService) OidcAuthorize(ctx context.Context, req *dto.OidcAuthorizeReq) (string, *errs.ServiceError) {
	if req.UserIP != "" && !utils.AllowRequest("oidc_auth_ip:"+req.UserIP, 30, time.Minute) {
		return "", errs.NewTooManyRequests("too_many_requests")
	}
	oidcConfig, serr := s.getOidcConfig(req.Name)
	if serr != nil {
		return "", serr
	}
	if !oidcConfig.Enabled {
		return "", errs.NewBadRequest("invalid_oidc_name")
	}
	// 绑定操作只能由已登录用户发起，并记录发起人
	if req.IsBind {
		userID, ok := ctxutils.GetCurrentUserID(ctx)
		if !ok {
			return "", errs.NewUnauthorized("login_required")
		}
		req.UserID = userID
	}
	state := utils.Strings.GenerateRandomString(32)
	loginState := oidcLoginState{
		Name:         oidcConfig.Name,
		RedirectBack: normalizeOidcRedirectBack(req.RedirectBack),
		IsBind:       req.IsBind,
		Nonce:        req.BrowserNonce,
		UserID:       req.UserID,
	}
	var authorizeUrl string
	if oidcConfig.Type == "misskey" {
		// Misskey 的 MiAuth：state 作为 session 拼在授权地址里，回调时以 session 参数带回
		authorizeUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint+"/"+state, map[string]string{
			"name":       tools.GetSiteName(),
			"icon":       tools.GetSiteIcon(),
			"callback":   oidcCallbackUrl(oidcConfig.Name),
			"permission": "read:account",
		})
	} else {
		// 常规 OAuth2/OIDC，附带 PKCE（S256）；不支持 PKCE 的提供商按规范会忽略这些参数
		loginState.CodeVerifier = utils.Strings.GenerateRandomString(64)
		authorizeUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint, map[string]string{
			"client_id":             oidcConfig.ClientID,
			"redirect_uri":          oidcCallbackUrl(oidcConfig.Name),
			"response_type":         "code",
			"scope":                 "openid email profile",
			"state":                 state,
			"code_challenge":        utils.Oidc.PkceChallenge(loginState.CodeVerifier),
			"code_challenge_method": "S256",
		})
	}
	// 存在共享状态中：多实例部署时回调落到任一实例都能校验
	if err := sharedstate.SetJSON(oidcStateKeyPrefix+state, loginState, oidcStateTTL); err != nil {
		return "", errs.Internal("failed_to_create_target", err)
	}
	return authorizeUrl, nil
}

// OidcErrorPageUrl 第三方登录失败时回到的前端登录页，错误码由前端翻译显示
func (s *UserService) OidcErrorPageUrl(redirectBack, errCode string) string {
	query := url.Values{
		"redirect_back": {normalizeOidcRedirectBack(redirectBack)},
		"oidc_error":    {errCode},
	}
	return constant.LoginPagePath + "?" + query.Encode()
}

// oidcCallbackUrl 身份提供商授权后回调的地址，发起授权和换取令牌时必须一致
func oidcCallbackUrl(name string) string {
	return tools.GetBaseUrl() + constant.ApiPrefix + constant.OidcUri + "/" + name
}

// normalizeOidcRedirectBack 只允许站内路径；浏览器会把 /\ 当作 //，同样视为外站
func normalizeOidcRedirectBack(redirectBack string) string {
	if redirectBack == "" ||
		!strings.HasPrefix(redirectBack, "/") ||
		strings.HasPrefix(redirectBack, "//") ||
		strings.HasPrefix(redirectBack, "/\\") ||
		strings.ContainsAny(redirectBack, "\r\n") {
		return "/"
	}
	return redirectBack
}

// viewUserDto 个人主页的用户信息：本人或管理员查看时包含邮箱，其他人只能看到公开信息
func viewUserDto(ctx context.Context, user *model.User) dto.UserDto {
	if ctxutils.IsOwnerOfTarget(ctx, user.ID) || ctxutils.IsAdmin(ctx) {
		return user.ToPrivateDto()
	}
	return user.ToProfileDto()
}

func (s *UserService) GetUser(ctx context.Context, req *dto.GetUserReq) (*dto.GetUserResp, *errs.ServiceError) {
	if req.UserID == 0 {
		return nil, errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	user, err := repo.User.GetUserByID(req.UserID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("user")
		}
		logrus.Errorln("Failed to get user by ID:", err)
		return nil, errs.Internal("failed_to_get_target", err).WithResource("user")
	}
	if user == nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("user")
	}
	return &dto.GetUserResp{
		User: viewUserDto(ctx, user),
	}, nil
}

func (s *UserService) GetUserByUsername(ctx context.Context, req *dto.GetUserByUsernameReq) (*dto.GetUserResp, *errs.ServiceError) {
	if req.Username == "" {
		return nil, errs.NewBadRequest("username_cannot_be_empty")
	}
	user, err := repo.User.GetUserByUsername(req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("user")
		}
		logrus.Errorln("Failed to get user by username:", err)
		return nil, errs.Internal("failed_to_get_target", err).WithResource("user")
	}
	if user == nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("user")
	}
	return &dto.GetUserResp{
		User: viewUserDto(ctx, user),
	}, nil
}

func (s *UserService) UpdateUser(req *dto.UpdateUserReq) (*dto.UpdateUserResp, *errs.ServiceError) {
	if req.Username != "" {
		req.Username = strings.TrimSpace(req.Username)
		if !isValidUsername(req.Username) {
			return nil, errs.NewBadRequest("invalid_username")
		}
		if u, err := repo.User.GetUserByUsername(req.Username); err == nil && u.ID != req.ID {
			return nil, errs.NewConflict("username_or_email_already_exists")
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.Internal("failed_to_check_target", err).WithResource("user")
		}
	}
	if req.Nickname != "" {
		req.Nickname = strings.TrimSpace(req.Nickname)
		if utf8.RuneCountInString(req.Nickname) > nicknameMaxLen {
			return nil, errs.NewBadRequest("invalid_nickname")
		}
	}
	// 时区只在公开当地时间时保存，关闭时一并清空，不留存用户不想公开的信息；按列更新才能写入空值
	var localTimeColumns map[string]any
	if req.ShowLocalTime != nil {
		timeZone := ""
		if *req.ShowLocalTime {
			var ok bool
			if timeZone, ok = utils.NormalizeTimeZone(req.TimeZone); !ok {
				return nil, errs.NewBadRequest("invalid_timezone")
			}
		}
		localTimeColumns = map[string]any{"show_local_time": *req.ShowLocalTime, "time_zone": timeZone}
	}
	// 性别同样允许清空，按列更新；未传表示不修改
	gender := ""
	if req.Gender != nil {
		var ok bool
		if gender, ok = normalizeGender(*req.Gender); !ok {
			return nil, errs.NewBadRequest("invalid_gender")
		}
	}
	user := &model.User{
		Model: gorm.Model{
			ID: req.ID,
		},
		Username:       req.Username,
		Nickname:       req.Nickname,
		AvatarUrl:      req.AvatarUrl,
		BackgroundUrl:  req.BackgroundUrl,
		PreferredColor: req.PreferredColor,
		Language:       req.Language,
		ShowIPLocation: req.ShowIPLocation,
		ShowLikes:      req.ShowLikes,
	}
	err := repo.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Updates(user).Error; err != nil {
			return err
		}
		if localTimeColumns != nil {
			if err := tx.Model(&model.User{}).Where("id = ?", req.ID).Updates(localTimeColumns).Error; err != nil {
				return err
			}
		}
		if req.Gender != nil {
			if err := tx.Model(&model.User{}).Where("id = ?", req.ID).Updates(map[string]any{"gender": gender}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("user")
		}
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, errs.NewConflict("username_or_email_already_exists")
		}
		logrus.Errorln("Failed to update user:", err)
		return nil, errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	repo.TouchCacheTags(repo.CacheTagUsers)
	if req.Username != "" || req.Nickname != "" {
		SyncSearchUser(req.ID, true)
	}
	return &dto.UpdateUserResp{}, nil
}

func (s *UserService) UpdatePassword(ctx context.Context, req *dto.UpdatePasswordReq) (bool, *errs.ServiceError) {
	if !isValidPassword(req.NewPassword) {
		return false, errs.NewBadRequest("invalid_password_format")
	}

	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return false, errs.NewUnauthorized("login_required")
	}
	if !utils.Password.VerifyPassword(req.OldPassword, currentUser.Password) {
		return false, errs.NewBadRequest("old_password_incorrect")
	}
	hashedPassword, err := utils.Password.HashPassword(req.NewPassword)
	if err != nil {
		logrus.Errorln("Failed to update password:", err)
		return false, errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	if err := repo.User.UpdateUserColumns(currentUser.ID, map[string]any{"password": hashedPassword}); err != nil {
		return false, errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	// 改密后其他设备上的登录全部失效，只保留当前会话
	currentSessionID, _ := ctx.Value("session_id").(string)
	if err := repo.Session.RevokeUserSessions(currentUser.ID, currentSessionID); err != nil {
		logrus.Errorln("Failed to revoke sessions:", err)
	}
	return true, nil
}

func (s *UserService) ResetPassword(req *dto.ResetPasswordReq, verifyCode string) (bool, *errs.ServiceError) {
	if !EmailVerifyEnabled() {
		return false, errs.NewForbidden("email_verify_disabled")
	}
	req.Email = strings.TrimSpace(req.Email)
	verifyCode = strings.TrimSpace(verifyCode)
	if req.Email == "" || verifyCode == "" {
		return false, errs.NewBadRequest("missing_email_or_verify_code")
	}
	if !isValidEmail(req.Email) {
		return false, errs.NewBadRequest("invalid_email").WithField("email", req.Email)
	}
	if !isValidPassword(req.NewPassword) {
		return false, errs.NewBadRequest("invalid_password_format")
	}
	if !utils.VerifyEmailCode(req.Email, verifyCode) {
		return false, errs.NewUnauthorized("invalid_verify_code")
	}
	// 查找用户
	user, err := repo.User.GetUserByEmail(req.Email)
	if err != nil {
		return false, errs.NewNotFound("user_not_found")
	}
	hashedPassword, err := utils.Password.HashPassword(req.NewPassword)
	if err != nil {
		return false, errs.Internal("failed_to_create_target", err).WithResource("user")
	}
	if err := repo.User.UpdateUserColumns(user.ID, map[string]any{"password": hashedPassword}); err != nil {
		return false, errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	// 重置密码后吊销该用户的全部会话
	if err := repo.Session.RevokeUserSessions(user.ID, ""); err != nil {
		logrus.Errorln("Failed to revoke sessions:", err)
	}
	return true, nil
}

func (s *UserService) UpdateEmail(ctx context.Context, email, verifyCode string) (bool, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return false, errs.NewUnauthorized("login_required")
	}
	if !EmailVerifyEnabled() {
		return false, errs.NewForbidden("email_verify_disabled")
	}
	email = strings.TrimSpace(email)
	verifyCode = strings.TrimSpace(verifyCode)
	if email == "" || verifyCode == "" {
		return false, errs.NewBadRequest("missing_email_or_verify_code")
	}
	if !isValidEmail(email) {
		return false, errs.NewBadRequest("invalid_email").WithField("email", email)
	}
	// 先检查邮箱未被其他账号占用，再消费一次性验证码
	if u, err := repo.User.GetUserByEmail(email); err == nil && u.ID != currentUser.ID {
		return false, errs.NewConflict("username_or_email_already_exists")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, errs.Internal("failed_to_check_target", err).WithResource("user")
	}
	if !utils.VerifyEmailCode(email, verifyCode) {
		return false, errs.NewUnauthorized("invalid_verify_code")
	}
	if err := repo.User.UpdateUserColumns(currentUser.ID, map[string]any{"email": email}); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return false, errs.NewConflict("username_or_email_already_exists")
		}
		return false, errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	return true, nil
}

func isValidPassword(password string) bool {
	if len(password) < 8 || len(password) > 32 {
		return false
	}
	return true
}

// 提及候选搜索的限流：同一用户每分钟最多这么多次，避免被拿来按字符枚举全站用户
const (
	userSearchRateLimit  = 30
	userSearchRateWindow = time.Minute
)

// SearchUsers 提及功能里的候选用户搜索：只给登录用户用（评论本身要登录），
// 只返回最小公开字段，排除已禁用账号与自己，避免成为用户名枚举工具
func (s *UserService) SearchUsers(ctx context.Context, req *dto.SearchUsersReq) ([]dto.UserBriefDto, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	if !utils.AllowRequest("user_search:"+strconv.FormatUint(uint64(currentUser.ID), 10), userSearchRateLimit, userSearchRateWindow) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	keyword := strings.TrimSpace(req.Query)
	if len([]rune(keyword)) < 1 {
		return []dto.UserBriefDto{}, nil
	}
	if len([]rune(keyword)) > 20 {
		keyword = string([]rune(keyword)[:20])
	}
	if users, ok := searchUsersMeili(ctx, keyword, currentUser.ID, req.Limit); ok {
		result := make([]dto.UserBriefDto, 0, len(users))
		for i := range users {
			result = append(result, users[i].ToBriefDto())
		}
		return result, nil
	}
	users, err := repo.User.SearchUsers(keyword, currentUser.ID, req.Limit)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("user")
	}
	result := make([]dto.UserBriefDto, 0, len(users))
	for i := range users {
		result = append(result, users[i].ToBriefDto())
	}
	return result, nil
}

// UserLogout 吊销用户当前登录会话
func (s *UserService) UserLogout(sessionID string) *errs.ServiceError {
	if sessionID == "" {
		return nil
	}
	if err := repo.Session.RevokeSession(sessionID); err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("session")
	}
	return nil
}

// GetUserLastIPLocation 查询用户最近一次会话的 IP 归属地（仅当用户开启公开 IP 归属地时允许查看）
func (s *UserService) GetUserLastIPLocation(userID uint) (*utils.IPData, *errs.ServiceError) {
	user, err := repo.User.GetUserByID(userID)
	if err != nil {
		return nil, errs.FromDB(err, "user", "failed_to_get_user")
	}
	if user.ShowIPLocation == nil || !*user.ShowIPLocation {
		return nil, errs.NewForbidden("ip_location_hidden")
	}
	session, err := repo.Session.GetLatestSessionByUserID(userID)
	if err != nil {
		return nil, errs.FromDB(err, "session", "failed_to_get_target")
	}
	reg := ipregion.Lookup(session.LatestIP())
	ipInfo := &utils.IPData{}
	if !reg.Reserved {
		ipInfo.Country = reg.Country
		ipInfo.CountryCode = reg.CountryCode
		ipInfo.Province = reg.Province
		ipInfo.City = reg.City
		ipInfo.ISP = reg.ISP
		if ipInfo.Province == ipInfo.Country {
			ipInfo.Province = ""
		}
		if ipInfo.City == ipInfo.Province {
			ipInfo.City = ""
		}
	}
	return ipInfo, nil
}
