package v1

import (
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/resps"
)

const maxOAuthPayloadBytes = 64 << 10 // 64 KiB 硬上限，防止流式超大包 OOM

type OAuthController struct {
	service *service.OAuthService
}

var OAuth = NewOAuthController()

func NewOAuthController() *OAuthController {
	return &OAuthController{service: service.NewOAuthService()}
}

func resolveExternalBaseURL(c *app.RequestContext) string {
	return tools.ResolveExternalBaseURL(
		string(c.GetHeader("X-Forwarded-Proto")),
		string(c.GetHeader("X-Forwarded-Host")),
		cmp.Or(string(c.Host()), string(c.GetHeader("Host"))),
		strings.EqualFold(string(c.URI().Scheme()), "https"),
	)
}

func writeOAuthJSON(c *app.RequestContext, status int, payload any) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(status, payload)
}

func writeOAuthProtocolError(c *app.RequestContext, perr *service.OAuthProtocolError) {
	if perr.WWWAuthenticate != "" {
		c.Header("WWW-Authenticate", perr.WWWAuthenticate)
	}
	if perr.RetryAfter != "" {
		c.Header("Retry-After", perr.RetryAfter)
	}
	writeOAuthJSON(c, perr.Status, dto.OAuthErrorResp{
		Error:            perr.Code,
		ErrorDescription: perr.Description,
	})
}

// ProtectedResourceMetadata GET /.well-known/oauth-protected-resource（及子路径）
func (o *OAuthController) ProtectedResourceMetadata(_ context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, o.service.ProtectedResourceMetadata(resolveExternalBaseURL(c)))
}

// AuthorizationServerMetadata GET /.well-known/oauth-authorization-server（及子路径）
func (o *OAuthController) AuthorizationServerMetadata(_ context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, o.service.AuthorizationServerMetadata(resolveExternalBaseURL(c)))
}

// Register POST /api/v1/oauth/register（RFC 7591 动态客户端注册）
func (o *OAuthController) Register(_ context.Context, c *app.RequestContext) {
	mediaType, _, err := mime.ParseMediaType(string(c.GetHeader("Content-Type")))
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		writeOAuthJSON(c, http.StatusBadRequest, dto.OAuthErrorResp{
			Error:            "invalid_client_metadata",
			ErrorDescription: "Content-Type must be application/json",
		})
		return
	}
	rawBody, ok := readBoundedBody(c, maxOAuthPayloadBytes)
	if !ok || len(bytes.TrimSpace(rawBody)) == 0 {
		writeOAuthJSON(c, http.StatusBadRequest, dto.OAuthErrorResp{
			Error:            "invalid_client_metadata",
			ErrorDescription: "Request body is empty or exceeds maximum allowed size",
		})
		return
	}
	var req dto.OAuthClientRegistrationReq
	if !decodeSingleJSONValue(rawBody, &req) {
		writeOAuthJSON(c, http.StatusBadRequest, dto.OAuthErrorResp{
			Error:            "invalid_client_metadata",
			ErrorDescription: "Malformed JSON payload",
		})
		return
	}
	resp, perr := o.service.RegisterClient(c.ClientIP(), &req)
	if perr != nil {
		writeOAuthProtocolError(c, perr)
		return
	}
	writeOAuthJSON(c, http.StatusCreated, resp)
}

// AuthorizeInfo GET /api/v1/oauth/authorize/info（仅允许浏览器 Cookie 会话，供前端授权确认页调用）
func (o *OAuthController) AuthorizeInfo(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	if len(bytes.TrimSpace(c.GetHeader("Authorization"))) > 0 {
		resps.Forbidden(c, "permission_denied")
		return
	}
	var req dto.OAuthAuthorizeInfoReq
	if err := c.BindQuery(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := o.service.GetAuthorizeInfo(ctx, resolveExternalBaseURL(c), &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

// Authorize POST /api/v1/oauth/authorize（仅允许浏览器 Cookie 会话，签发一次性授权码或返回拒绝跳转地址）
func (o *OAuthController) Authorize(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	// 严禁携带 Authorization 头调用，防止借用 Bearer 头绕过 UseCookieCSRF 的 Origin 校验
	if len(bytes.TrimSpace(c.GetHeader("Authorization"))) > 0 {
		resps.Forbidden(c, "permission_denied")
		return
	}
	rawBody, ok := readBoundedBody(c, maxOAuthPayloadBytes)
	if !ok || len(bytes.TrimSpace(rawBody)) == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	var req dto.OAuthAuthorizeDecisionReq
	if !decodeSingleJSONValue(rawBody, &req) {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := o.service.DecideAuthorize(ctx, resolveExternalBaseURL(c), &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

// Token POST /api/v1/oauth/token（同时支持 application/x-www-form-urlencoded 与 application/json，严格输出 RFC 6749 JSON）
func (o *OAuthController) Token(_ context.Context, c *app.RequestContext) {
	var req dto.OAuthTokenReq
	if perr := parseOAuthTokenRequest(c, &req); perr != nil {
		writeOAuthProtocolError(c, perr)
		return
	}
	basic, hasOtherAuth := parseOAuthBasicAuth(c)
	resp, perr := o.service.ExchangeToken(c.ClientIP(), resolveExternalBaseURL(c), basic, hasOtherAuth, &req)
	if perr != nil {
		writeOAuthProtocolError(c, perr)
		return
	}
	writeOAuthJSON(c, http.StatusOK, resp)
}

// Revoke POST /api/v1/oauth/revoke（RFC 7009 吊销访问令牌或刷新令牌）
func (o *OAuthController) Revoke(_ context.Context, c *app.RequestContext) {
	var req dto.OAuthRevokeReq
	if perr := parseOAuthRevokeRequest(c, &req); perr != nil {
		writeOAuthProtocolError(c, perr)
		return
	}
	basic, hasOtherAuth := parseOAuthBasicAuth(c)
	if perr := o.service.RevokeToken(c.ClientIP(), basic, hasOtherAuth, &req); perr != nil {
		writeOAuthProtocolError(c, perr)
		return
	}
	writeOAuthJSON(c, http.StatusOK, map[string]any{})
}

func parseOAuthTokenRequest(c *app.RequestContext, dst *dto.OAuthTokenReq) *service.OAuthProtocolError {
	rawBody, ok := readBoundedBody(c, maxOAuthPayloadBytes)
	if !ok || len(bytes.TrimSpace(rawBody)) == 0 {
		return &service.OAuthProtocolError{
			Status:      http.StatusBadRequest,
			Code:        "invalid_request",
			Description: "Token request body is empty or exceeds maximum allowed size",
		}
	}
	mediaType, _, _ := mime.ParseMediaType(string(c.GetHeader("Content-Type")))
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "application/json":
		if !decodeSingleJSONValue(rawBody, dst) {
			return &service.OAuthProtocolError{
				Status:      http.StatusBadRequest,
				Code:        "invalid_request",
				Description: "Malformed JSON request body",
			}
		}
		return nil
	case "", "application/x-www-form-urlencoded":
		vals, ok := parseStrictURLEncodedForm(rawBody)
		if !ok {
			return &service.OAuthProtocolError{
				Status:      http.StatusBadRequest,
				Code:        "invalid_request",
				Description: "Invalid or duplicate form parameters",
			}
		}
		dst.GrantType = vals.Get("grant_type")
		dst.ClientID = vals.Get("client_id")
		dst.ClientSecret = vals.Get("client_secret")
		dst.Code = vals.Get("code")
		dst.RedirectURI = vals.Get("redirect_uri")
		dst.CodeVerifier = vals.Get("code_verifier")
		dst.RefreshToken = vals.Get("refresh_token")
		dst.Scope = vals.Get("scope")
		dst.Resource = vals.Get("resource")
		return nil
	default:
		return &service.OAuthProtocolError{
			Status:      http.StatusBadRequest,
			Code:        "invalid_request",
			Description: "Content-Type must be application/x-www-form-urlencoded or application/json",
		}
	}
}

func parseOAuthRevokeRequest(c *app.RequestContext, dst *dto.OAuthRevokeReq) *service.OAuthProtocolError {
	rawBody, ok := readBoundedBody(c, maxOAuthPayloadBytes)
	if !ok || len(bytes.TrimSpace(rawBody)) == 0 {
		return &service.OAuthProtocolError{
			Status:      http.StatusBadRequest,
			Code:        "invalid_request",
			Description: "Revocation request body is empty or exceeds maximum allowed size",
		}
	}
	mediaType, _, _ := mime.ParseMediaType(string(c.GetHeader("Content-Type")))
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "application/json":
		if !decodeSingleJSONValue(rawBody, dst) {
			return &service.OAuthProtocolError{
				Status:      http.StatusBadRequest,
				Code:        "invalid_request",
				Description: "Malformed JSON request body",
			}
		}
		return nil
	case "", "application/x-www-form-urlencoded":
		vals, ok := parseStrictURLEncodedForm(rawBody)
		if !ok {
			return &service.OAuthProtocolError{
				Status:      http.StatusBadRequest,
				Code:        "invalid_request",
				Description: "Invalid or duplicate form parameters",
			}
		}
		dst.Token = vals.Get("token")
		dst.TokenTypeHint = vals.Get("token_type_hint")
		dst.ClientID = vals.Get("client_id")
		dst.ClientSecret = vals.Get("client_secret")
		return nil
	default:
		return &service.OAuthProtocolError{
			Status:      http.StatusBadRequest,
			Code:        "invalid_request",
			Description: "Content-Type must be application/x-www-form-urlencoded or application/json",
		}
	}
}

// parseStrictURLEncodedForm 解析表单并按 RFC 6749 §3.2 拒绝重复参数名
func parseStrictURLEncodedForm(raw []byte) (url.Values, bool) {
	vals, err := url.ParseQuery(string(raw))
	if err != nil {
		return nil, false
	}
	for _, list := range vals {
		if len(list) > 1 {
			return nil, false
		}
	}
	return vals, true
}

// parseOAuthBasicAuth 按 RFC 6749 §2.3.1 解析 Authorization: Basic（支持百分号编码解码）
func parseOAuthBasicAuth(c *app.RequestContext) (*service.OAuthBasicCredentials, bool) {
	raw := strings.TrimSpace(string(c.GetHeader("Authorization")))
	if raw == "" {
		return nil, false
	}
	if len(raw) <= 6 || !strings.EqualFold(raw[:6], "Basic ") {
		return nil, true
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw[6:]))
	if err != nil {
		return nil, true
	}
	idPart, secretPart, found := strings.Cut(string(decoded), ":")
	if !found {
		return nil, true
	}
	clientID, idErr := url.PathUnescape(idPart)
	clientSecret, secErr := url.PathUnescape(secretPart)
	if idErr != nil || secErr != nil {
		return nil, true
	}
	return &service.OAuthBasicCredentials{
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}, false
}

// ensure json package referenced via decodeSingleJSONValue in visit.go
var _ = json.Unmarshal
