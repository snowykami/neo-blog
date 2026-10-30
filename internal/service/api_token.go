package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

const (
	apiTokenSecretLength  = 40          // 前缀之后的随机部分长度（62 进制，约 238 位熵）
	apiTokenPrefixLength  = 12          // 列表中展示的明文开头长度
	apiTokenNameMaxLength = 64          // 名称最大长度（字符）
	apiTokenMaxActive     = 20          // 每个用户最多同时有效的 Token 数
	apiTokenTouchInterval = time.Minute // 最近使用时间的最小记录间隔
)

// APITokenService 个人 API Token：创建、列出、吊销与认证
type APITokenService struct{}

func NewAPITokenService() *APITokenService {
	return &APITokenService{}
}

// HashAPIToken Token 明文的哈希；明文为高熵随机串，直接使用 SHA-256 即可
func HashAPIToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// RoleAllowsScope 角色能否使用某个权限范围：读取与上传图片对所有登录用户开放，写入与发布文章需要编辑及以上角色
func RoleAllowsScope(role constant.Role, scope string) bool {
	switch scope {
	case constant.ScopePostsRead, constant.ScopeFilesWrite:
		return true
	case constant.ScopePostsWrite, constant.ScopePostsPublish:
		return role == constant.RoleAdmin || role == constant.RoleEditor
	}
	return false
}

// EffectiveScopes Token 实际生效的权限范围：Token 的权限范围与用户当前角色的交集
// 用户被降级后，已有 Token 随之失去超出角色的权限
func EffectiveScopes(scopes []string, role constant.Role) []string {
	result := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		if RoleAllowsScope(role, scope) && !slices.Contains(result, scope) {
			result = append(result, scope)
		}
	}
	return result
}

// normalizeAPITokenScopes 校验并按固定顺序去重，未知的权限范围直接拒绝
func normalizeAPITokenScopes(scopes []string) ([]string, *errs.ServiceError) {
	for _, scope := range scopes {
		if !slices.Contains(constant.APITokenScopes, scope) {
			return nil, errs.NewBadRequest("invalid_api_token_scopes")
		}
	}
	result := make([]string, 0, len(scopes))
	for _, scope := range constant.APITokenScopes {
		if slices.Contains(scopes, scope) {
			result = append(result, scope)
		}
	}
	if len(result) == 0 {
		return nil, errs.NewBadRequest("invalid_api_token_scopes")
	}
	return result, nil
}

// Create 创建 Token，明文只在返回值中出现一次；Token 本身不能再创建 Token
func (s *APITokenService) Create(ctx context.Context, req *dto.CreateAPITokenReq) (*dto.CreateAPITokenResp, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	if _, viaToken := ctxutils.GetAPIToken(ctx); viaToken {
		return nil, errs.NewForbidden("permission_denied")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > apiTokenNameMaxLength {
		return nil, errs.NewBadRequest("invalid_api_token_name")
	}
	scopes, svcerr := normalizeAPITokenScopes(req.Scopes)
	if svcerr != nil {
		return nil, svcerr
	}
	for _, scope := range scopes {
		if !RoleAllowsScope(currentUser.Role, scope) {
			return nil, errs.NewForbidden("api_token_scope_not_allowed")
		}
	}
	now := time.Now()
	if req.ExpiresAt != nil && !req.ExpiresAt.After(now) {
		return nil, errs.NewBadRequest("invalid_api_token_expiry")
	}
	count, err := repo.APIToken.CountActiveByUser(currentUser.ID, now)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if count >= apiTokenMaxActive {
		return nil, errs.NewBadRequest("too_many_api_tokens")
	}

	raw := constant.APITokenPrefix + utils.Strings.GenerateRandomString(apiTokenSecretLength)
	token := &model.APIToken{
		UserID:    currentUser.ID,
		Name:      name,
		TokenHash: HashAPIToken(raw),
		Prefix:    raw[:apiTokenPrefixLength],
		Scopes:    strings.Join(scopes, ","),
		ExpiresAt: req.ExpiresAt,
	}
	if err := repo.APIToken.Create(token); err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	return &dto.CreateAPITokenResp{APIToken: token.ToDto(), Token: raw}, nil
}

// List 当前用户自己的 Token
func (s *APITokenService) List(ctx context.Context) (*dto.ListAPITokenResp, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	tokens, err := repo.APIToken.ListByUser(currentUser.ID)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := &dto.ListAPITokenResp{APITokens: make([]*dto.APITokenDto, 0, len(tokens))}
	for i := range tokens {
		result.APITokens = append(result.APITokens, tokens[i].ToDto())
	}
	return result, nil
}

// Revoke 吊销 Token：本人或管理员可操作，吊销后立即失效，记录保留用于版本历史溯源
func (s *APITokenService) Revoke(ctx context.Context, id uint) *errs.ServiceError {
	if id == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	token, err := repo.APIToken.GetByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errs.NewNotFound("target_not_found")
		}
		return errs.NewInternalServer("failed_to_get_target")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, token.UserID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	if err := repo.APIToken.Revoke(id, time.Now()); err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

// Authenticate 校验 Token 明文，返回所属用户 ID 与生效的 Token 信息
// 已吊销、已过期、用户不存在或被禁用时一律返回 invalid_api_token，不区分具体原因
func (s *APITokenService) Authenticate(raw string) (uint, *ctxutils.APITokenInfo, *errs.ServiceError) {
	invalid := errs.NewUnauthorized("invalid_api_token")
	if !strings.HasPrefix(raw, constant.APITokenPrefix) {
		return 0, nil, invalid
	}
	token, err := repo.APIToken.GetByHash(HashAPIToken(raw))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil, invalid
		}
		return 0, nil, errs.NewInternalServer("failed_to_get_target")
	}
	now := time.Now()
	if token.IsRevoked() || token.IsExpired(now) {
		return 0, nil, invalid
	}
	user, err := repo.User.GetUserByID(token.UserID)
	if err != nil || user.Disabled {
		return 0, nil, invalid
	}
	_ = repo.APIToken.TouchLastUsed(token.ID, now, apiTokenTouchInterval)
	return user.ID, &ctxutils.APITokenInfo{
		ID:     token.ID,
		Name:   token.Name,
		Scopes: EffectiveScopes(token.ScopeList(), user.Role),
	}, nil
}
