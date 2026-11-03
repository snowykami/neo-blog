package errs

import (
	"errors"
	"net/http"

	"gorm.io/gorm"
)

// Reason 错误原因（枚举），决定 HTTP 状态码；前端优先按具体错误码翻译，没有对应文案时按原因显示通用提示
type Reason string

const (
	ReasonInvalidArgument  Reason = "invalid_argument"  // 400 参数不合法
	ReasonUnauthenticated  Reason = "unauthenticated"   // 401 未登录或凭据无效
	ReasonPermissionDenied Reason = "permission_denied" // 403 无权操作
	ReasonNotFound         Reason = "not_found"         // 404 资源不存在
	ReasonAlreadyExists    Reason = "already_exists"    // 409 唯一字段重复
	ReasonConflict         Reason = "conflict"          // 409 与当前状态冲突
	ReasonTooManyRequests  Reason = "too_many_requests" // 429 请求过于频繁
	ReasonUnavailable      Reason = "unavailable"       // 503 未配置或依赖的服务不可用
	ReasonInternal         Reason = "internal"          // 500 服务器内部错误，具体原因只写日志
)

var reasonStatus = map[Reason]int{
	ReasonInvalidArgument:  http.StatusBadRequest,
	ReasonUnauthenticated:  http.StatusUnauthorized,
	ReasonPermissionDenied: http.StatusForbidden,
	ReasonNotFound:         http.StatusNotFound,
	ReasonAlreadyExists:    http.StatusConflict,
	ReasonConflict:         http.StatusConflict,
	ReasonTooManyRequests:  http.StatusTooManyRequests,
	ReasonUnavailable:      http.StatusServiceUnavailable,
	ReasonInternal:         http.StatusInternalServerError,
}

// ReasonOf 按 HTTP 状态码推断错误原因（兼容只给出状态码的旧写法）
func ReasonOf(status int) Reason {
	switch status {
	case http.StatusBadRequest:
		return ReasonInvalidArgument
	case http.StatusUnauthorized:
		return ReasonUnauthenticated
	case http.StatusForbidden:
		return ReasonPermissionDenied
	case http.StatusNotFound:
		return ReasonNotFound
	case http.StatusConflict:
		return ReasonConflict
	case http.StatusTooManyRequests:
		return ReasonTooManyRequests
	case http.StatusServiceUnavailable:
		return ReasonUnavailable
	}
	if status >= 500 {
		return ReasonInternal
	}
	return ReasonInvalidArgument
}

// ServiceError 业务错误。返回给客户端的只有 Reason、Message（错误码）、Resource、Field、Value、Detail；
// 原始错误 Err 只写日志，不能把数据库、文件路径等内部信息放进其他字段
type ServiceError struct {
	Code     int    // HTTP 状态码
	Message  string // 错误码（具体原因，如 slug_already_exists），前端据此翻译
	Reason   Reason // 错误原因（枚举）
	Resource string // 出错的资源类型，如 label、post
	Field    string // 出错的字段，如 slug
	Value    any    // 出错字段的取值：只放用户自己提交的内容
	Detail   string // 补充说明：只放确定可以公开的文字
	Err      error  // 原始错误，只写日志
}

func (e *ServiceError) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}

func (e *ServiceError) Unwrap() error {
	return e.Err
}

// Body 返回给客户端的错误详情
type Body struct {
	Reason   Reason `json:"reason"`
	Code     string `json:"code"`
	Resource string `json:"resource,omitempty"`
	Field    string `json:"field,omitempty"`
	Value    any    `json:"value,omitempty"`
	Detail   string `json:"detail,omitempty"`
}

func (e *ServiceError) Body() Body {
	return Body{Reason: e.Reason, Code: e.Message, Resource: e.Resource, Field: e.Field, Value: e.Value, Detail: e.Detail}
}

// WithResource 标明出错的资源类型（前端显示为「标签不存在」等）
func (e *ServiceError) WithResource(resource string) *ServiceError {
	e.Resource = resource
	return e
}

// WithField 标明出错的字段与用户提交的值
func (e *ServiceError) WithField(field string, value any) *ServiceError {
	e.Field, e.Value = field, value
	return e
}

// WithDetail 附加可以公开的补充说明
func (e *ServiceError) WithDetail(detail string) *ServiceError {
	e.Detail = detail
	return e
}

// WithCause 记录原始错误，只写日志
func (e *ServiceError) WithCause(err error) *ServiceError {
	e.Err = err
	return e
}

// NewReason 按错误原因创建，code 为具体错误码（为空时同原因）
func NewReason(reason Reason, code string) *ServiceError {
	if code == "" {
		code = string(reason)
	}
	status, ok := reasonStatus[reason]
	if !ok {
		status = http.StatusInternalServerError
	}
	return &ServiceError{Code: status, Message: code, Reason: reason}
}

// New 按 HTTP 状态码创建自定义错误
func New(code int, message string, err error) *ServiceError {
	return &ServiceError{Code: code, Message: message, Reason: ReasonOf(code), Err: err}
}

func NewBadRequest(code string) *ServiceError   { return NewReason(ReasonInvalidArgument, code) }
func NewUnauthorized(code string) *ServiceError { return NewReason(ReasonUnauthenticated, code) }
func NewForbidden(code string) *ServiceError    { return NewReason(ReasonPermissionDenied, code) }
func NewNotFound(code string) *ServiceError     { return NewReason(ReasonNotFound, code) }
func NewConflict(code string) *ServiceError     { return NewReason(ReasonConflict, code) }
func NewTooManyRequests(code string) *ServiceError {
	return NewReason(ReasonTooManyRequests, code)
}
func NewUnavailable(code string) *ServiceError    { return NewReason(ReasonUnavailable, code) }
func NewInternalServer(code string) *ServiceError { return NewReason(ReasonInternal, code) }

// Internal 内部错误：只返回错误码，原始错误写日志
func Internal(code string, err error) *ServiceError {
	return NewInternalServer(code).WithCause(err)
}

// AlreadyExists 唯一字段重复，如标签的 slug「aigc」已存在；value 为用户提交的值
func AlreadyExists(resource, field string, value any) *ServiceError {
	return NewReason(ReasonAlreadyExists, field+"_already_exists").WithResource(resource).WithField(field, value)
}

// FromDB 把数据库错误转为业务错误：记录不存在为 not_found，唯一约束冲突为 already_exists（不知道具体字段），
// 其他为内部错误（只写日志）。internalCode 为内部错误时的错误码，如 failed_to_create_target
func FromDB(err error, resource, internalCode string) *ServiceError {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return NewNotFound("target_not_found").WithResource(resource)
	case errors.Is(err, gorm.ErrDuplicatedKey):
		return NewReason(ReasonAlreadyExists, "target_already_exists").WithResource(resource)
	}
	return Internal(internalCode, err).WithResource(resource)
}

// Is 判断错误类型
func Is(err, target error) bool {
	return errors.Is(err, target)
}
