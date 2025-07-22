package errs

import (
	"errors"
	"github.com/cloudwego/hertz/pkg/app"
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
var (
	ErrNotFound           = &ServiceError{Code: http.StatusNotFound, Message: "not found"}
	ErrInvalidCredentials = &ServiceError{Code: http.StatusUnauthorized, Message: "invalid credentials"}
	ErrConflict           = &ServiceError{Code: http.StatusConflict, Message: "resource conflict"}
	ErrInternalServer     = &ServiceError{Code: http.StatusInternalServerError, Message: "internal server error"}
	ErrBadRequest         = &ServiceError{Code: http.StatusBadRequest, Message: "invalid request parameters"}
	ErrForbidden          = &ServiceError{Code: http.StatusForbidden, Message: "access forbidden"}
)

// New 创建自定义错误
func New(code int, message string, err error) *ServiceError {
	return &ServiceError{
		Code:    code,
		Message: message,
		Err:     err,
	}
}

// Is 判断错误类型
func Is(err, target error) bool {
	return errors.Is(err, target)
}

// AsServiceError 将错误转换为ServiceError
func AsServiceError(err error) *ServiceError {
	var serviceErr *ServiceError
	if errors.As(err, &serviceErr) {
		return serviceErr
	}
	return ErrInternalServer
}

// HandleError 处理错误并返回HTTP状态码和消息
func HandleError(c *app.RequestContext, err *ServiceError) {

}
