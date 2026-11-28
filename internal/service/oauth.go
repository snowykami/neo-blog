package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

const (
	oauthAuthCodeTTL          = 10 * time.Minute
	oauthAccessTokenTTL       = time.Hour
	oauthRefreshTokenTTL      = 30 * 24 * time.Hour
	oauthTouchInterval        = time.Minute
	oauthAuthCodeKeyPrefix    = "oauth_code:"
	oauthAuthCodeUsedPrefix   = "oauth_code_used:"
	oauthRegisterIPRateLimit  = 20
	oauthRegisterGlobalLimit  = 200
	oauthTokenIPRateLimit     = 120
	oauthTokenClientRateLimit = 60
	oauthRateLimitWindow      = time.Minute
	oauthClientNameMaxRunes   = 100
	oauthRedirectURIMaxCount  = 10
	oauthRedirectURIMaxBytes  = 512
)

var forbiddenCustomSchemes = map[string]bool{
	"http":       true,
	"https":      true,
	"javascript": true,
	"data":       true,
	"vbscript":   true,
	"blob":       true,
	"file":       true,
	"about":      true,
	"mailto":     true,
	"tel":        true,
	"ws":         true,
	"wss":        true,
	"ftp":        true,
}

var reservedNonPublicCIDRs = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
}

// OAuthProtocolError 标准 RFC 6749 / RFC 7591 协议错误响应（不包裹 resps 外壳）
type OAuthProtocolError struct {
	Status          int
	Code            string
	Description     string
	WWWAuthenticate string
	RetryAfter      string
}

// OAuthBasicCredentials 解析后的 HTTP Basic 客户端凭证
type OAuthBasicCredentials struct {
	ClientID     string
	ClientSecret string
}

type oauthAuthCodeState struct {
	ClientID            string    `json:"client_id"`
	FamilyID            string    `json:"family_id"`
	RedirectURI         string    `json:"redirect_uri"`
	Resource            string    `json:"resource,omitempty"`
	UserID              uint      `json:"user_id"`
	Scopes              []string  `json:"scopes"`
	CodeChallenge       string    `json:"code_challenge"`
	CodeChallengeMethod string    `json:"code_challenge_method"`
	CreatedAt           time.Time `json:"created_at"`
}

type OAuthService struct{}

func NewOAuthService() *OAuthService {
	return &OAuthService{}
}

func oauthProtocolErr(status int, code, desc string) *OAuthProtocolError {
	return &OAuthProtocolError{Status: status, Code: code, Description: desc}
}

func oauthInvalidClientErr(usedBasic bool) *OAuthProtocolError {
	e := &OAuthProtocolError{
		Status:      http.StatusUnauthorized,
		Code:        "invalid_client",
		Description: "Client authentication failed",
	}
	if usedBasic {
		e.WWWAuthenticate = `Basic realm="neo-blog"`
	}
	return e
}

func oauthRateLimitErr(desc string) *OAuthProtocolError {
	return &OAuthProtocolError{
		Status:      http.StatusTooManyRequests,
		Code:        "temporarily_unavailable",
		Description: desc,
		RetryAfter:  "60",
	}
}

func randomHexToken(prefix string, numBytes int) (string, error) {
	raw := make([]byte, numBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(raw), nil
}

func hashAPIToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// EffectiveOAuthScopes 将候选 Scope 限制在公开支持的 APITokenScopes 与用户当前角色允许范围的交集内（保持标准顺序并去重）
func EffectiveOAuthScopes(requested []string, role constant.Role) []string {
	out := make([]string, 0, len(requested))
	for _, s := range constant.APITokenScopes {
		if slices.Contains(requested, s) && RoleAllowsScope(role, s) {
			out = append(out, s)
		}
	}
	return out
}

// ProtectedResourceMetadata 生成 RFC 9728 OAuth 受保护资源元数据
func (s *OAuthService) ProtectedResourceMetadata(baseURL string) *dto.OAuthProtectedResourceMetadata {
	baseURL = strings.TrimRight(baseURL, "/")
	scopes := slices.Clone(constant.APITokenScopes)
	return &dto.OAuthProtectedResourceMetadata{
		Resource:               baseURL + "/api/v1/mcp",
		AuthorizationServers:   []string{baseURL},
		ScopesSupported:        scopes,
		BearerMethodsSupported: []string{"header"},
	}
}

// AuthorizationServerMetadata 生成 RFC 8414 OAuth 授权服务器元数据
func (s *OAuthService) AuthorizationServerMetadata(baseURL string) *dto.OAuthAuthorizationServerMetadata {
	baseURL = strings.TrimRight(baseURL, "/")
	scopes := slices.Clone(constant.APITokenScopes)
	return &dto.OAuthAuthorizationServerMetadata{
		Issuer:                                     baseURL,
		AuthorizationEndpoint:                      baseURL + "/oauth/authorize",
		TokenEndpoint:                              baseURL + "/api/v1/oauth/token",
		RegistrationEndpoint:                       baseURL + "/api/v1/oauth/register",
		RevocationEndpoint:                         baseURL + "/api/v1/oauth/revoke",
		ResponseTypesSupported:                     []string{"code"},
		GrantTypesSupported:                        []string{"authorization_code", "refresh_token"},
		TokenEndpointAuthMethodsSupported:          []string{"none", "client_secret_post", "client_secret_basic"},
		CodeChallengeMethodsSupported:              []string{"S256"},
		ScopesSupported:                            scopes,
		AuthorizationResponseIssParameterSupported: true,
	}
}

// RegisterClient 动态客户端注册（RFC 7591）
func (s *OAuthService) RegisterClient(clientIP string, req *dto.OAuthClientRegistrationReq) (*dto.OAuthClientRegistrationResp, *OAuthProtocolError) {
	if !allowOAuthRegister(clientIP) {
		return nil, oauthRateLimitErr("Dynamic client registration is temporarily rate limited")
	}
	if req == nil {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_client_metadata", "Client registration payload is required")
	}

	authMethod := strings.TrimSpace(req.TokenEndpointAuthMethod)
	if authMethod == "" {
		authMethod = model.OAuthAuthMethodClientSecretBasic
	}
	switch authMethod {
	case model.OAuthAuthMethodNone, model.OAuthAuthMethodClientSecretBasic, model.OAuthAuthMethodClientSecretPost:
	default:
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_client_metadata", "Unsupported token_endpoint_auth_method")
	}
	isPublic := authMethod == model.OAuthAuthMethodNone

	redirectURIs, ok := validateDCRRedirectURIs(req.RedirectURIs, isPublic)
	if !ok {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_redirect_uri", "At least one valid loopback HTTP, HTTPS, or public-client custom-scheme redirect_uri is required")
	}

	grantTypes, ok := normalizeDCRGrantTypes(req.GrantTypes)
	if !ok {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_client_metadata", "Supported grant_types are authorization_code and refresh_token")
	}
	responseTypes, ok := normalizeDCRResponseTypes(req.ResponseTypes)
	if !ok {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_client_metadata", "Supported response_types is code")
	}

	allowedScopes := slices.Clone(constant.APITokenScopes)
	if rawScope := strings.TrimSpace(req.Scope); rawScope != "" {
		parsed, valid := parseKnownOAuthScopes(rawScope)
		if !valid || len(parsed) == 0 {
			return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_client_metadata", "Requested scope contains unsupported values")
		}
		allowedScopes = parsed
	}

	clientName := strings.TrimSpace(req.ClientName)
	clientURI := strings.TrimSpace(req.ClientURI)
	logoURI := strings.TrimSpace(req.LogoURI)
	if utf8.RuneCountInString(clientName) > oauthClientNameMaxRunes || hasControlChars(clientName) ||
		!validOptionalPublicHTTPSURI(clientURI) || !validOptionalPublicHTTPSURI(logoURI) {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_client_metadata", "Client presentation metadata is invalid")
	}
	if clientName == "" {
		clientName = "MCP Client"
	}

	clientID, err := randomHexToken(constant.OAuthClientIDPrefix, 16)
	if err != nil {
		return nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to generate client_id")
	}

	var plainSecret string
	var secretHashPtr *string
	var secretExpiresAt *int64
	if !isPublic {
		plainSecret, err = randomHexToken(constant.OAuthClientSecretPrefix, 32)
		if err != nil {
			return nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to generate client_secret")
		}
		h := hashAPIToken(plainSecret)
		secretHashPtr = &h
		zero := int64(0)
		secretExpiresAt = &zero
	}

	now := time.Now().UTC()
	scopeStr := strings.Join(allowedScopes, " ")
	client := &model.OAuthClient{
		CreatedAt:               now,
		UpdatedAt:               now,
		ClientID:                clientID,
		ClientSecretHash:        secretHashPtr,
		ClientName:              clientName,
		ClientURI:               clientURI,
		LogoURI:                 logoURI,
		RedirectURIs:            redirectURIs,
		GrantTypes:              grantTypes,
		TokenEndpointAuthMethod: authMethod,
		Scope:                   scopeStr,
	}
	if err := repo.OAuth.CreateClient(client); err != nil {
		logrus.WithError(err).Error("Failed to save OAuth client")
		return nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to persist OAuth client")
	}

	return &dto.OAuthClientRegistrationResp{
		ClientID:                client.ClientID,
		ClientSecret:            plainSecret,
		ClientIDIssuedAt:        now.Unix(),
		ClientSecretExpiresAt:   secretExpiresAt,
		RedirectURIs:            redirectURIs,
		TokenEndpointAuthMethod: authMethod,
		GrantTypes:              grantTypes,
		ResponseTypes:           responseTypes,
		ClientName:              clientName,
		ClientURI:               clientURI,
		LogoURI:                 logoURI,
		Scope:                   scopeStr,
	}, nil
}

// GetAuthorizeInfo 校验授权参数并返回客户端信息与当前用户可授予的权限范围（供前端授权确认页展示）
func (s *OAuthService) GetAuthorizeInfo(ctx context.Context, baseURL string, req *dto.OAuthAuthorizeInfoReq) (*dto.OAuthAuthorizeInfoResp, *errs.ServiceError) {
	user, svcerr := requireCookieHumanUser(ctx)
	if svcerr != nil {
		return nil, svcerr
	}
	if req == nil {
		return nil, errs.NewBadRequest(respsErrInvalidParam)
	}
	validated, svcerr := validateAuthorizeCommon(
		baseURL,
		req.ClientID,
		req.RedirectURI,
		req.ResponseType,
		req.Scope,
		req.CodeChallenge,
		req.CodeChallengeMethod,
		req.Resource,
		user.Role,
	)
	if svcerr != nil {
		return nil, svcerr
	}
	return &dto.OAuthAuthorizeInfoResp{
		ClientID:          validated.client.ClientID,
		ClientName:        validated.client.ClientName,
		ClientURI:         validated.client.ClientURI,
		LogoURI:           validated.client.LogoURI,
		RedirectURI:       validated.redirectURI,
		CallbackTarget:    describeCallbackTarget(validated.redirectURI),
		RequestedScopes:   validated.requestedScopes,
		GrantedScopes:     validated.grantedScopes,
		UnavailableScopes: validated.unavailableScopes,
	}, nil
}

// DecideAuthorize 处理用户在授权确认页上的「允许」或「拒绝」操作。
// 无论同意或拒绝都必须先校验 client_id 与 redirect_uri 合法性，严防拒绝分支被滥用为开放重定向器。
func (s *OAuthService) DecideAuthorize(ctx context.Context, baseURL string, req *dto.OAuthAuthorizeDecisionReq) (*dto.OAuthAuthorizeDecisionResp, *errs.ServiceError) {
	user, svcerr := requireCookieHumanUser(ctx)
	if svcerr != nil {
		return nil, svcerr
	}
	if req == nil {
		return nil, errs.NewBadRequest(respsErrInvalidParam)
	}
	baseURL = strings.TrimRight(baseURL, "/")

	client, redirectURI, svcerr := validateClientAndRedirectURI(req.ClientID, req.RedirectURI)
	if svcerr != nil {
		return nil, svcerr
	}
	state := strings.TrimSpace(req.State)
	if len(state) > 512 || hasControlChars(state) {
		return nil, errs.NewBadRequest("invalid_oauth_state")
	}

	if !req.Approve {
		params := url.Values{
			"error": {"access_denied"},
			"iss":   {baseURL},
		}
		if state != "" {
			params.Set("state", state)
		}
		return &dto.OAuthAuthorizeDecisionResp{
			RedirectURL: appendRedirectQuery(redirectURI, params),
		}, nil
	}

	validated, svcerr := validateAuthorizeWithClient(
		client,
		redirectURI,
		baseURL,
		req.ResponseType,
		req.Scope,
		req.CodeChallenge,
		req.CodeChallengeMethod,
		req.Resource,
		user.Role,
	)
	if svcerr != nil {
		return nil, svcerr
	}

	finalScopes := validated.grantedScopes
	if req.Scopes != nil {
		selected := make([]string, 0, len(req.Scopes))
		for _, sName := range constant.APITokenScopes {
			if slices.Contains(req.Scopes, sName) && slices.Contains(validated.grantedScopes, sName) {
				selected = append(selected, sName)
			}
		}
		if len(selected) == 0 {
			return nil, errs.NewBadRequest("scopes_required")
		}
		// 若前端提交了不在候选授权集内的 scope，拒绝请求
		for _, raw := range req.Scopes {
			if !slices.Contains(validated.grantedScopes, raw) {
				return nil, errs.NewForbidden("scope_not_allowed_for_role").WithField("scopes", raw)
			}
		}
		finalScopes = selected
	}

	plainCode, err := randomHexToken(constant.OAuthAuthCodePrefix, 32)
	if err != nil {
		return nil, errs.Internal("failed_to_create_target", err)
	}
	familyID, err := randomHexToken("nbf_", 16)
	if err != nil {
		return nil, errs.Internal("failed_to_create_target", err)
	}
	codeState := oauthAuthCodeState{
		ClientID:            client.ClientID,
		FamilyID:            familyID,
		RedirectURI:         redirectURI,
		Resource:            validated.normalizedResource,
		UserID:              user.ID,
		Scopes:              finalScopes,
		CodeChallenge:       validated.codeChallenge,
		CodeChallengeMethod: "S256",
		CreatedAt:           time.Now().UTC(),
	}
	if err := sharedstate.SetJSON(oauthAuthCodeKeyPrefix+hashAPIToken(plainCode), codeState, oauthAuthCodeTTL); err != nil {
		return nil, errs.Internal("failed_to_create_target", err)
	}

	params := url.Values{
		"code": {plainCode},
		"iss":  {baseURL},
	}
	if state != "" {
		params.Set("state", state)
	}
	return &dto.OAuthAuthorizeDecisionResp{
		RedirectURL: appendRedirectQuery(redirectURI, params),
	}, nil
}

// ExchangeToken 处理 POST /api/v1/oauth/token（支持 authorization_code 与 refresh_token 两种授权类型）
func (s *OAuthService) ExchangeToken(
	clientIP string,
	baseURL string,
	basic *OAuthBasicCredentials,
	hasOtherAuthHeader bool,
	req *dto.OAuthTokenReq,
) (*dto.OAuthTokenResp, *OAuthProtocolError) {
	if req == nil {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_request", "Token request payload is required")
	}
	client, perr := authenticateOAuthClient(clientIP, basic, hasOtherAuthHeader, req.ClientID, req.ClientSecret)
	if perr != nil {
		return nil, perr
	}

	switch strings.TrimSpace(req.GrantType) {
	case "authorization_code":
		return s.exchangeAuthorizationCode(client, baseURL, req)
	case "refresh_token":
		return s.exchangeRefreshToken(client, baseURL, req)
	case "":
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_request", "grant_type is required")
	default:
		return nil, oauthProtocolErr(http.StatusBadRequest, "unsupported_grant_type", "Supported grant_types are authorization_code and refresh_token")
	}
}

func (s *OAuthService) exchangeAuthorizationCode(
	client *model.OAuthClient,
	baseURL string,
	req *dto.OAuthTokenReq,
) (*dto.OAuthTokenResp, *OAuthProtocolError) {
	if !slices.Contains(client.GrantTypes, "authorization_code") {
		return nil, oauthProtocolErr(http.StatusBadRequest, "unauthorized_client", "Client is not authorized for authorization_code")
	}
	plainCode := strings.TrimSpace(req.Code)
	redirectURI := strings.TrimSpace(req.RedirectURI)
	codeVerifier := strings.TrimSpace(req.CodeVerifier)
	if plainCode == "" || redirectURI == "" || codeVerifier == "" {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_request", "code, redirect_uri, and code_verifier are required")
	}
	if !strings.HasPrefix(plainCode, constant.OAuthAuthCodePrefix) {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Invalid authorization code")
	}

	normalizedResource, resourceOK := validateOptionalResource(baseURL, req.Resource)
	if !resourceOK {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_target", "Requested resource is not valid for this MCP server")
	}

	codeHash := hashAPIToken(plainCode)
	var codeState oauthAuthCodeState
	found, err := sharedstate.TakeJSON(oauthAuthCodeKeyPrefix+codeHash, &codeState)
	if err != nil {
		logrus.WithError(err).Error("Failed to consume OAuth authorization code")
		return nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to verify authorization code")
	}
	if !found {
		// OAuth 2.1 §4.1.2：若同一授权码已被消费过又被重放提交，立即吊销该授权码已派生出的全部令牌
		if usedFamily, used, _ := sharedstate.Current().Get(oauthAuthCodeUsedPrefix + codeHash); used && usedFamily != "" {
			if revErr := repo.OAuth.RevokeFamily(usedFamily, time.Now().UTC()); revErr != nil {
				logrus.WithError(revErr).Warn("Failed to revoke OAuth token family after authorization code replay")
			}
		}
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Authorization code is invalid, expired, or already used")
	}
	// 先登记已消费标记，确保即使后续任何重放都能定位到 family_id
	_ = sharedstate.Current().Set(oauthAuthCodeUsedPrefix+codeHash, codeState.FamilyID, oauthAuthCodeTTL)

	if codeState.ClientID != client.ClientID ||
		subtle.ConstantTimeCompare([]byte(codeState.RedirectURI), []byte(redirectURI)) != 1 ||
		codeState.CodeChallengeMethod != "S256" ||
		!verifyPKCES256(codeVerifier, codeState.CodeChallenge) {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Authorization code validation failed")
	}
	if codeState.Resource != "" && normalizedResource != "" && codeState.Resource != normalizedResource {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_target", "Requested resource does not match the authorized resource")
	}

	user, err := repo.User.GetUserByID(codeState.UserID)
	if err != nil || user == nil || user.Disabled || user.IsAI {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Resource owner account is unavailable")
	}
	effectiveScopes := EffectiveOAuthScopes(codeState.Scopes, user.Role)
	if len(effectiveScopes) == 0 {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "User role no longer permits the authorized scopes")
	}

	now := time.Now().UTC()
	issueRefresh := slices.Contains(client.GrantTypes, "refresh_token")
	resp, tokenRow, perr := buildIssuedOAuthTokenRow(user.ID, client.ClientID, codeState.FamilyID, effectiveScopes, issueRefresh, now)
	if perr != nil {
		return nil, perr
	}
	if err := repo.OAuth.CreateToken(tokenRow); err != nil {
		logrus.WithError(err).Error("Failed to persist OAuth token")
		return nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to issue OAuth token")
	}
	return resp, nil
}

func (s *OAuthService) exchangeRefreshToken(
	client *model.OAuthClient,
	baseURL string,
	req *dto.OAuthTokenReq,
) (*dto.OAuthTokenResp, *OAuthProtocolError) {
	if !slices.Contains(client.GrantTypes, "refresh_token") {
		return nil, oauthProtocolErr(http.StatusBadRequest, "unauthorized_client", "Client is not authorized for refresh_token")
	}
	plainRefresh := strings.TrimSpace(req.RefreshToken)
	if plainRefresh == "" {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_request", "refresh_token is required")
	}
	if !strings.HasPrefix(plainRefresh, constant.OAuthRefreshTokenPrefix) {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Invalid refresh token")
	}
	if _, resourceOK := validateOptionalResource(baseURL, req.Resource); !resourceOK {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_target", "Requested resource is not valid for this MCP server")
	}

	now := time.Now().UTC()
	refreshHash := hashAPIToken(plainRefresh)
	tok, err := repo.OAuth.GetTokenByRefreshHash(refreshHash)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Refresh token is invalid or expired")
		}
		logrus.WithError(err).Error("Failed to query OAuth refresh token")
		return nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to verify refresh token")
	}
	if tok.ClientID != client.ClientID {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Refresh token does not belong to this client")
	}
	if tok.RefreshConsumedAt != nil {
		if revErr := repo.OAuth.RevokeFamily(tok.FamilyID, now); revErr != nil {
			logrus.WithError(revErr).Warn("Failed to revoke OAuth token family on refresh replay")
		}
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Refresh token has already been used")
	}
	if tok.RevokedAt != nil || tok.RefreshExpiresAt == nil || !tok.RefreshExpiresAt.After(now) {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Refresh token is expired or revoked")
	}

	user, err := repo.User.GetUserByID(tok.UserID)
	if err != nil || user == nil || user.Disabled || user.IsAI {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Resource owner account is unavailable")
	}

	targetScopes := tok.Scopes
	if rawScope := strings.TrimSpace(req.Scope); rawScope != "" {
		parsed, valid := parseKnownOAuthScopes(rawScope)
		if !valid || len(parsed) == 0 {
			return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_scope", "Requested scope is invalid")
		}
		for _, item := range parsed {
			if !slices.Contains(tok.Scopes, item) {
				return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_scope", "Requested scope exceeds the originally granted scope")
			}
		}
		targetScopes = parsed
	}
	effectiveScopes := EffectiveOAuthScopes(targetScopes, user.Role)
	if len(effectiveScopes) == 0 {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "User role no longer permits the requested scopes")
	}

	resp, newRow, perr := buildIssuedOAuthTokenRow(user.ID, client.ClientID, tok.FamilyID, effectiveScopes, true, now)
	if perr != nil {
		return nil, perr
	}
	replayed, err := repo.OAuth.RotateRefreshToken(tok, newRow, now)
	if err != nil {
		logrus.WithError(err).Error("Failed to rotate OAuth refresh token")
		return nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to rotate refresh token")
	}
	if replayed {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_grant", "Refresh token is invalid, expired, or already used")
	}
	return resp, nil
}

// RevokeToken 处理 POST /api/v1/oauth/revoke（RFC 7009）
func (s *OAuthService) RevokeToken(
	clientIP string,
	basic *OAuthBasicCredentials,
	hasOtherAuthHeader bool,
	req *dto.OAuthRevokeReq,
) *OAuthProtocolError {
	if req == nil {
		return oauthProtocolErr(http.StatusBadRequest, "invalid_request", "Revocation request payload is required")
	}
	plainToken := strings.TrimSpace(req.Token)
	if plainToken == "" {
		return oauthProtocolErr(http.StatusBadRequest, "invalid_request", "token is required")
	}
	client, perr := authenticateOAuthClient(clientIP, basic, hasOtherAuthHeader, req.ClientID, req.ClientSecret)
	if perr != nil {
		return perr
	}
	if strings.HasPrefix(plainToken, constant.OAuthAccessTokenPrefix) || strings.HasPrefix(plainToken, constant.OAuthRefreshTokenPrefix) {
		if err := repo.OAuth.RevokeByClientAndHash(client.ClientID, hashAPIToken(plainToken), time.Now().UTC()); err != nil {
			logrus.WithError(err).Error("Failed to revoke OAuth token")
			return oauthProtocolErr(http.StatusInternalServerError, "server_error", "Token revocation failed")
		}
	}
	return nil
}

// AuthenticateAccessToken 校验 OAuth Access Token 明文（nbo_...），返回所属用户 ID 与当前生效的权限上下文
func (s *OAuthService) AuthenticateAccessToken(raw string) (uint, *ctxutils.APITokenInfo, *errs.ServiceError) {
	if !strings.HasPrefix(raw, constant.OAuthAccessTokenPrefix) || len(raw) <= len(constant.OAuthAccessTokenPrefix) {
		return 0, nil, errs.NewUnauthorized("invalid_api_token")
	}
	tok, err := repo.OAuth.GetTokenByAccessHash(hashAPIToken(raw))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil, errs.NewUnauthorized("invalid_api_token")
		}
		logrus.WithError(err).Error("Failed to get OAuth access token")
		return 0, nil, errs.Internal("failed_to_get_target", err)
	}
	now := time.Now().UTC()
	if tok.RevokedAt != nil || !tok.AccessExpiresAt.After(now) {
		return 0, nil, errs.NewUnauthorized("invalid_api_token")
	}
	user, err := repo.User.GetUserByID(tok.UserID)
	if err != nil || user == nil || user.Disabled || user.IsAI {
		return 0, nil, errs.NewUnauthorized("invalid_api_token")
	}
	clientName := "MCP OAuth"
	if client, err := repo.OAuth.GetClientByClientID(tok.ClientID); err == nil && client != nil && client.ClientName != "" {
		clientName = client.ClientName
	}
	if err := repo.OAuth.TouchLastUsed(tok.ID, now, oauthTouchInterval); err != nil {
		logrus.WithError(err).Warn("Failed to touch OAuth token last_used_at")
	}
	return user.ID, &ctxutils.APITokenInfo{
		ID:           0,
		OAuthTokenID: tok.ID,
		Name:         clientName,
		Scopes:       EffectiveOAuthScopes(tok.Scopes, user.Role),
	}, nil
}

// ---- 内部校验与协议辅助函数 ----

const respsErrInvalidParam = "invalid_param"

type validatedAuthorizeParams struct {
	client             *model.OAuthClient
	redirectURI        string
	codeChallenge      string
	normalizedResource string
	requestedScopes    []string
	grantedScopes      []string
	unavailableScopes  []string
}

func requireCookieHumanUser(ctx context.Context) (*model.User, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return nil, errs.NewUnauthorized("login_required")
	}
	if _, viaToken := ctxutils.GetAPIToken(ctx); viaToken || currentUser.IsAI || currentUser.Disabled {
		return nil, errs.NewForbidden("permission_denied")
	}
	return currentUser, nil
}

func validateClientAndRedirectURI(clientID, redirectURI string) (*model.OAuthClient, string, *errs.ServiceError) {
	clientID = strings.TrimSpace(clientID)
	redirectURI = strings.TrimSpace(redirectURI)
	if clientID == "" || redirectURI == "" {
		return nil, "", errs.NewBadRequest("invalid_oauth_request")
	}
	client, err := repo.OAuth.GetClientByClientID(clientID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", errs.NewNotFound("oauth_client_not_found")
		}
		logrus.WithError(err).Error("Failed to query OAuth client")
		return nil, "", errs.Internal("failed_to_get_target", err)
	}
	if !slices.Contains(client.GrantTypes, "authorization_code") {
		return nil, "", errs.NewForbidden("oauth_grant_type_forbidden")
	}
	if !isRedirectURIAllowedForClient(client, redirectURI) {
		return nil, "", errs.NewBadRequest("invalid_redirect_uri")
	}
	return client, redirectURI, nil
}

func validateAuthorizeCommon(
	baseURL, clientID, redirectURI, responseType, rawScope, codeChallenge, codeChallengeMethod, resource string,
	role constant.Role,
) (*validatedAuthorizeParams, *errs.ServiceError) {
	client, matchedRedirectURI, svcerr := validateClientAndRedirectURI(clientID, redirectURI)
	if svcerr != nil {
		return nil, svcerr
	}
	return validateAuthorizeWithClient(client, matchedRedirectURI, baseURL, responseType, rawScope, codeChallenge, codeChallengeMethod, resource, role)
}

func validateAuthorizeWithClient(
	client *model.OAuthClient,
	redirectURI string,
	baseURL string,
	responseType string,
	rawScope string,
	codeChallenge string,
	codeChallengeMethod string,
	resource string,
	role constant.Role,
) (*validatedAuthorizeParams, *errs.ServiceError) {
	if strings.TrimSpace(responseType) != "code" {
		return nil, errs.NewBadRequest("unsupported_response_type")
	}
	challenge := strings.TrimSpace(codeChallenge)
	if strings.TrimSpace(codeChallengeMethod) != "S256" || !validPKCEChallenge(challenge) {
		return nil, errs.NewBadRequest("pkce_s256_required")
	}
	normalizedResource, resourceOK := validateOptionalResource(baseURL, resource)
	if !resourceOK {
		return nil, errs.NewBadRequest("invalid_oauth_resource")
	}

	clientAllowed := constant.APITokenScopes
	if strings.TrimSpace(client.Scope) != "" {
		if parsed, ok := parseKnownOAuthScopes(client.Scope); ok && len(parsed) > 0 {
			clientAllowed = parsed
		}
	}

	var requested []string
	if strings.TrimSpace(rawScope) == "" {
		requested = slices.Clone(clientAllowed)
	} else {
		parsed, ok := parseKnownOAuthScopes(rawScope)
		if !ok || len(parsed) == 0 {
			return nil, errs.NewBadRequest("invalid_scope")
		}
		for _, item := range parsed {
			if !slices.Contains(clientAllowed, item) {
				return nil, errs.NewBadRequest("invalid_scope")
			}
		}
		requested = parsed
	}

	granted := make([]string, 0, len(requested))
	unavailable := make([]string, 0)
	for _, sName := range requested {
		if RoleAllowsScope(role, sName) {
			granted = append(granted, sName)
		} else {
			unavailable = append(unavailable, sName)
		}
	}
	if len(granted) == 0 {
		return nil, errs.NewForbidden("scope_not_allowed_for_role")
	}

	return &validatedAuthorizeParams{
		client:             client,
		redirectURI:        redirectURI,
		codeChallenge:      challenge,
		normalizedResource: normalizedResource,
		requestedScopes:    requested,
		grantedScopes:      granted,
		unavailableScopes:  unavailable,
	}, nil
}

func buildIssuedOAuthTokenRow(
	userID uint,
	clientID string,
	familyID string,
	scopes []string,
	withRefresh bool,
	now time.Time,
) (*dto.OAuthTokenResp, *model.OAuthToken, *OAuthProtocolError) {
	plainAccess, err := randomHexToken(constant.OAuthAccessTokenPrefix, 32)
	if err != nil {
		return nil, nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to generate access_token")
	}
	accessHash := hashAPIToken(plainAccess)
	accessExp := now.Add(oauthAccessTokenTTL)

	var plainRefresh string
	var refreshHashPtr *string
	var refreshExpPtr *time.Time
	if withRefresh {
		plainRefresh, err = randomHexToken(constant.OAuthRefreshTokenPrefix, 32)
		if err != nil {
			return nil, nil, oauthProtocolErr(http.StatusInternalServerError, "server_error", "Failed to generate refresh_token")
		}
		rh := hashAPIToken(plainRefresh)
		re := now.Add(oauthRefreshTokenTTL)
		refreshHashPtr = &rh
		refreshExpPtr = &re
	}

	row := &model.OAuthToken{
		CreatedAt:        now,
		UpdatedAt:        now,
		UserID:           userID,
		ClientID:         clientID,
		FamilyID:         familyID,
		Scopes:           slices.Clone(scopes),
		AccessTokenHash:  accessHash,
		AccessExpiresAt:  accessExp,
		RefreshTokenHash: refreshHashPtr,
		RefreshExpiresAt: refreshExpPtr,
	}
	resp := &dto.OAuthTokenResp{
		AccessToken:  plainAccess,
		TokenType:    "Bearer",
		ExpiresIn:    int64(oauthAccessTokenTTL / time.Second),
		RefreshToken: plainRefresh,
		Scope:        strings.Join(scopes, " "),
	}
	return resp, row, nil
}

func authenticateOAuthClient(
	clientIP string,
	basic *OAuthBasicCredentials,
	hasOtherAuthHeader bool,
	bodyClientID string,
	bodyClientSecret string,
) (*model.OAuthClient, *OAuthProtocolError) {
	trimmedBodyID := strings.TrimSpace(bodyClientID)
	usedBasic := basic != nil

	clientID := trimmedBodyID
	clientSecret := bodyClientSecret
	if usedBasic {
		clientID = strings.TrimSpace(basic.ClientID)
		clientSecret = basic.ClientSecret
	}

	if !allowOAuthTokenAttempt(clientIP, clientID) {
		return nil, oauthRateLimitErr("OAuth token endpoint is temporarily rate limited")
	}
	if hasOtherAuthHeader {
		return nil, oauthInvalidClientErr(true)
	}
	if usedBasic && bodyClientSecret != "" {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_request", "Multiple client authentication mechanisms must not be used")
	}
	if usedBasic && trimmedBodyID != "" && trimmedBodyID != clientID {
		return nil, oauthProtocolErr(http.StatusBadRequest, "invalid_request", "Mismatched client_id between Authorization header and request body")
	}
	if clientID == "" {
		return nil, oauthInvalidClientErr(usedBasic)
	}

	client, err := repo.OAuth.GetClientByClientID(clientID)
	if err != nil || client == nil {
		return nil, oauthInvalidClientErr(usedBasic)
	}

	switch client.TokenEndpointAuthMethod {
	case model.OAuthAuthMethodNone:
		if usedBasic || clientSecret != "" || bodyClientSecret != "" || client.ClientSecretHash != nil {
			return nil, oauthInvalidClientErr(usedBasic)
		}
		return client, nil
	case model.OAuthAuthMethodClientSecretBasic, model.OAuthAuthMethodClientSecretPost:
		emitBasicChallenge := usedBasic || client.TokenEndpointAuthMethod == model.OAuthAuthMethodClientSecretBasic
		if clientSecret == "" || client.ClientSecretHash == nil {
			return nil, oauthInvalidClientErr(emitBasicChallenge)
		}
		actualHash := hashAPIToken(clientSecret)
		if subtle.ConstantTimeCompare([]byte(*client.ClientSecretHash), []byte(actualHash)) != 1 {
			return nil, oauthInvalidClientErr(emitBasicChallenge)
		}
		return client, nil
	default:
		return nil, oauthInvalidClientErr(usedBasic)
	}
}

func allowOAuthRegister(clientIP string) bool {
	if utils.IsDevMode {
		return true
	}
	ipKey := "oauth_reg_ip:" + cmpOrUnknown(clientIP)
	if !utils.AllowRequest(ipKey, oauthRegisterIPRateLimit, oauthRateLimitWindow) {
		return false
	}
	return utils.AllowRequest("oauth_reg_global", oauthRegisterGlobalLimit, oauthRateLimitWindow)
}

func allowOAuthTokenAttempt(clientIP, clientID string) bool {
	if utils.IsDevMode {
		return true
	}
	ip := cmpOrUnknown(clientIP)
	if !utils.AllowRequest("oauth_tok_ip:"+ip, oauthTokenIPRateLimit, oauthRateLimitWindow) {
		return false
	}
	return utils.AllowRequest("oauth_tok_id:"+ip+":"+hashAPIToken(clientID), oauthTokenClientRateLimit, oauthRateLimitWindow)
}

func cmpOrUnknown(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return "unknown"
	}
	return ip
}

func parseKnownOAuthScopes(raw string) ([]string, bool) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return nil, false
	}
	selected := make(map[string]bool, len(fields))
	for _, token := range fields {
		if !slices.Contains(constant.APITokenScopes, token) {
			return nil, false
		}
		selected[token] = true
	}
	ordered := make([]string, 0, len(selected))
	for _, s := range constant.APITokenScopes {
		if selected[s] {
			ordered = append(ordered, s)
		}
	}
	return ordered, true
}

func normalizeDCRGrantTypes(values []string) ([]string, bool) {
	if values == nil {
		return []string{"authorization_code", "refresh_token"}, true
	}
	if len(values) == 0 {
		return nil, false
	}
	hasCode := false
	hasRefresh := false
	for _, v := range values {
		switch strings.TrimSpace(v) {
		case "authorization_code":
			hasCode = true
		case "refresh_token":
			hasRefresh = true
		default:
			return nil, false
		}
	}
	if !hasCode {
		return nil, false
	}
	if hasRefresh {
		return []string{"authorization_code", "refresh_token"}, true
	}
	return []string{"authorization_code"}, true
}

func normalizeDCRResponseTypes(values []string) ([]string, bool) {
	if values == nil {
		return []string{"code"}, true
	}
	if len(values) == 0 {
		return nil, false
	}
	for _, v := range values {
		if strings.TrimSpace(v) != "code" {
			return nil, false
		}
	}
	return []string{"code"}, true
}

func validateDCRRedirectURIs(values []string, allowCustomScheme bool) ([]string, bool) {
	if len(values) == 0 || len(values) > oauthRedirectURIMaxCount {
		return nil, false
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, raw := range values {
		if raw == "" || strings.TrimSpace(raw) != raw {
			return nil, false
		}
		if !isValidOAuthRedirectURI(raw, allowCustomScheme) {
			return nil, false
		}
		if !seen[raw] {
			seen[raw] = true
			out = append(out, raw)
		}
	}
	return out, len(out) > 0
}

func isValidOAuthRedirectURI(raw string, allowCustomScheme bool) bool {
	if raw == "" || len(raw) > oauthRedirectURIMaxBytes || strings.Contains(raw, "#") || strings.Contains(raw, "*") {
		return false
	}
	for _, r := range raw {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Fragment != "" || u.User != nil {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	switch scheme {
	case "http":
		if u.Host == "" || u.Opaque != "" || !validURLPort(u) {
			return false
		}
		return isLoopbackHost(strings.ToLower(u.Hostname()))
	case "https":
		if u.Host == "" || u.Opaque != "" || !validURLPort(u) {
			return false
		}
		host := strings.ToLower(u.Hostname())
		return isLoopbackHost(host) || isPublicHostnameOrIP(host)
	default:
		if !allowCustomScheme || forbiddenCustomSchemes[scheme] || !isValidCustomScheme(scheme) {
			return false
		}
		// 原生桌面客户端自定义 URI Scheme（如 cursor://anysphere.cursor-mcp/oauth/callback、vscode://...、com.example.app:/cb）
		return u.Opaque == "" && (u.Host != "" || strings.HasPrefix(u.Path, "/"))
	}
}

func isValidCustomScheme(scheme string) bool {
	if len(scheme) < 2 || len(scheme) > 32 {
		return false
	}
	if scheme[0] < 'a' || scheme[0] > 'z' {
		return false
	}
	for i := 1; i < len(scheme); i++ {
		ch := scheme[i]
		if !((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '+' || ch == '.' || ch == '-') {
			return false
		}
	}
	return true
}

func validURLPort(u *url.URL) bool {
	portText := u.Port()
	if portText == "" {
		return true
	}
	port, err := strconv.Atoi(portText)
	return err == nil && port >= 1 && port <= 65535
}

func isLoopbackHost(hostname string) bool {
	return hostname == "127.0.0.1" || hostname == "::1" || hostname == "localhost"
}

func isIPv4LoopbackEquivalent(a, b string) bool {
	return (a == "127.0.0.1" || a == "localhost") && (b == "127.0.0.1" || b == "localhost")
}

func isPublicHostnameOrIP(hostname string) bool {
	if addr, err := netip.ParseAddr(hostname); err == nil {
		addr = addr.Unmap()
		if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() ||
			addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() ||
			addr.IsMulticast() || addr.IsUnspecified() {
			return false
		}
		for _, prefix := range reservedNonPublicCIDRs {
			if prefix.Contains(addr) {
				return false
			}
		}
		return true
	}
	if len(hostname) > 253 || strings.ContainsAny(hostname, ":%") ||
		strings.HasPrefix(hostname, ".") || strings.HasSuffix(hostname, ".") {
		return false
	}
	for _, suffix := range []string{".localhost", ".local", ".internal", ".home.arpa"} {
		if strings.HasSuffix(hostname, suffix) {
			return false
		}
	}
	labels := strings.Split(hostname, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) < 1 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			ch := label[i]
			if !((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-') {
				return false
			}
		}
	}
	tld := labels[len(labels)-1]
	if len(tld) < 2 {
		return false
	}
	if strings.HasPrefix(tld, "xn--") {
		return len(tld) > 4
	}
	for i := 0; i < len(tld); i++ {
		if tld[i] < 'a' || tld[i] > 'z' {
			return false
		}
	}
	return true
}

func validOptionalPublicHTTPSURI(raw string) bool {
	if raw == "" {
		return true
	}
	if len(raw) > oauthRedirectURIMaxBytes || strings.Contains(raw, "#") {
		return false
	}
	for _, r := range raw {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	u, err := url.Parse(raw)
	if err != nil || strings.ToLower(u.Scheme) != "https" || u.Host == "" || u.User != nil || !validURLPort(u) {
		return false
	}
	return isPublicHostnameOrIP(strings.ToLower(u.Hostname()))
}

// isRedirectURIAllowedForClient 校验授权请求中的 redirect_uri：
//  1. 优先与已注册列表做常量时间精确匹配；
//  2. 若为公共客户端（token_endpoint_auth_method == "none"）且为 Loopback HTTP，按 RFC 8252 §7.3 允许同路径与同查询串的动态端口匹配。
func isRedirectURIAllowedForClient(client *model.OAuthClient, redirectURI string) bool {
	if !isValidOAuthRedirectURI(redirectURI, client.IsPublic()) {
		return false
	}
	for _, registered := range client.RedirectURIs {
		if subtle.ConstantTimeCompare([]byte(registered), []byte(redirectURI)) == 1 {
			return true
		}
	}
	if !client.IsPublic() {
		return false
	}
	reqU, err := url.Parse(redirectURI)
	if err != nil || strings.ToLower(reqU.Scheme) != "http" || !validURLPort(reqU) {
		return false
	}
	reqHost := strings.ToLower(reqU.Hostname())
	if !isLoopbackHost(reqHost) {
		return false
	}
	for _, registered := range client.RedirectURIs {
		regU, regErr := url.Parse(registered)
		if regErr != nil || strings.ToLower(regU.Scheme) != "http" {
			continue
		}
		regHost := strings.ToLower(regU.Hostname())
		hostMatches := regHost == reqHost || isIPv4LoopbackEquivalent(regHost, reqHost)
		if hostMatches && normalizeEmptyPath(regU.Path) == normalizeEmptyPath(reqU.Path) && regU.RawQuery == reqU.RawQuery {
			return true
		}
	}
	return false
}

func normalizeEmptyPath(p string) string {
	if p == "" {
		return "/"
	}
	return p
}

func describeCallbackTarget(redirectURI string) string {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return redirectURI
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme == "http" || scheme == "https" {
		return fmt.Sprintf("%s://%s", scheme, u.Host)
	}
	if u.Host != "" {
		return fmt.Sprintf("%s://%s", scheme, u.Host)
	}
	return scheme + "://"
}

func validateOptionalResource(baseURL, rawResource string) (string, bool) {
	trimmed := strings.TrimSpace(rawResource)
	if trimmed == "" {
		return "", true
	}
	normReq, ok := canonicalizeResourceURI(trimmed)
	if !ok {
		return "", false
	}
	normBase, ok := canonicalizeResourceURI(baseURL)
	if !ok {
		return "", false
	}
	normMCP := strings.TrimRight(normBase, "/") + "/api/v1/mcp"
	if normReq == normMCP || normReq == normBase {
		return normReq, true
	}
	return "", false
}

func canonicalizeResourceURI(raw string) (string, bool) {
	if raw == "" || strings.Contains(raw, "#") {
		return "", false
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	hostname := strings.ToLower(u.Hostname())
	port := u.Port()
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host = host + ":" + port
	}
	cleanPath := strings.TrimRight(u.Path, "/")
	return scheme + "://" + host + cleanPath, true
}

func validPKCEChallenge(challenge string) bool {
	if len(challenge) != 43 {
		return false
	}
	for i := 0; i < len(challenge); i++ {
		ch := challenge[i]
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func verifyPKCES256(verifier, challenge string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	for i := 0; i < len(verifier); i++ {
		ch := verifier[i]
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') ||
			ch == '-' || ch == '.' || ch == '_' || ch == '~') {
			return false
		}
	}
	sum := sha256.Sum256([]byte(verifier))
	expected := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(expected), []byte(challenge)) == 1
}

func appendRedirectQuery(redirectURI string, params url.Values) string {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return ""
	}
	q := u.Query()
	for k, vals := range params {
		for _, v := range vals {
			q.Set(k, v)
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func hasControlChars(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}
