package resps

// 通用响应码，与 pkg/errs 中的错误码同为 snake_case，前端按 Response.error_details 翻译
const (
	Success                = "success"
	ErrParamInvalid        = "invalid_request_parameters"
	ErrUnauthorized        = "login_required"
	ErrForbidden           = "permission_denied"
	ErrNotFound            = "target_not_found"
	ErrInternalServerError = "internal_server_error"

	ErrInvalidCredentials = "invalid_credentials"
)
