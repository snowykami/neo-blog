package errs

import (
	"errors"
	"net/http"
)

// ServiceError 业务错误结构
type ServiceError struct {
	Code    int    // 错误代码
	Message string // 错误消息
	Err     error  // 原始错误
}

func (e *ServiceError) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}

// 常见业务错误
// var (
// 	ErrNotFound           = &ServiceError{Code: http.StatusNotFound, Message: "not_found"}
// 	ErrInvalidCredentials = &ServiceError{Code: http.StatusUnauthorized, Message: "invalid_credentials"}
// 	ErrConflict           = &ServiceError{Code: http.StatusConflict, Message: "resource_conflict"}
// 	ErrInternalServer     = &ServiceError{Code: http.StatusInternalServerError, Message: "internal_server_error"}
// 	ErrBadRequest         = &ServiceError{Code: http.StatusBadRequest, Message: "invalid_request_parameters"}
// 	ErrUnauthorized       = &ServiceError{Code: http.StatusUnauthorized, Message: "unauthorized_access"}
// 	ErrForbidden          = &ServiceError{Code: http.StatusForbidden, Message: "access_forbidden"}
// )

// New 创建自定义错误
func New(code int, message string, err error) *ServiceError {
	return &ServiceError{
		Code:    code,
		Message: message,
		Err:     err,
	}
}

func NewUnauthorized(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusUnauthorized,
		Message: error,
	}
}

func NewForbidden(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusForbidden,
		Message: error,
	}
}

func NewNotFound(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusNotFound,
		Message: error,
	}
}

func NewBadRequest(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusBadRequest,
		Message: error,
	}
}

func NewConflict(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusConflict,
		Message: error,
	}
}

func NewIAmATeapot(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusTeapot,
		Message: error,
	}
}

func NewInternalServer(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusInternalServerError,
		Message: error,
	}
}

// Is 判断错误类型
func Is(err, target error) bool {
	return errors.Is(err, target)
}
