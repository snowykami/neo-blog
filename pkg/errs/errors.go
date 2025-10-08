package errs

import (
	"errors"
	"net/http"

	"github.com/cloudwego/hertz/pkg/common/utils"
)

// ServiceError 业务错误结构
type ServiceError struct {
	Code    int      // 错误代码
	Message string   // 错误消息
	Data    *utils.H // 额外数据
	Err     error    // 原始错误
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
func New(code int, message string, err error, data *utils.H) *ServiceError {
	return &ServiceError{
		Code:    code,
		Message: message,
		Err:     err,
		Data:    data,
	}
}

func NewUnauthorized(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusUnauthorized,
		Message: "unauthorized",
		Data:    &utils.H{"error": error},
	}
}

func NewForbidden(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusForbidden,
		Message: "forbidden",
		Data:    &utils.H{"error": error},
	}
}

func NewNotFound(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusNotFound,
		Message: "not_found",
		Data:    &utils.H{"error": error},
	}
}

func NewBadRequest(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusBadRequest,
		Message: "bad_request",
		Data:    &utils.H{"error": error},
	}
}

func NewConflict(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusConflict,
		Message: "conflict",
		Data:    &utils.H{"error": error},
	}
}

func NewIAmATeapot(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusTeapot,
		Message: "i_am_a_teapot",
		Data:    &utils.H{"error": error},
	}
}

func NewInternalServer(error string) *ServiceError {
	return &ServiceError{
		Code:    http.StatusInternalServerError,
		Message: "internal_server_error",
		Data:    &utils.H{"error": error},
	}
}

// Is 判断错误类型
func Is(err, target error) bool {
	return errors.Is(err, target)
}
