package resps

import (
	"errors"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 响应结构：{status, message, data}；出错时另有 error（见 errs.Body）：reason 为错误原因枚举，code 为具体错误码（同 message），
// 以及可选的 resource / field / value / detail。服务器内部错误的具体原因只写日志，不返回给客户端

func Custom(c *app.RequestContext, status int, message string, data any) {
	if status >= 400 {
		writeError(c, errs.New(status, message, nil), data)
		return
	}
	c.JSON(status, utils.H{
		"status":  status,
		"message": message,
		"data":    data,
	})
	c.Abort()
}

func Ok(c *app.RequestContext, message string, data any) {
	Custom(c, 200, message, data)
}

func Redirect(c *app.RequestContext, url string) {
	c.Redirect(302, []byte(url))
}

func BadRequest(c *app.RequestContext, message string) {
	Custom(c, 400, message, nil)
}

func Unauthorized(c *app.RequestContext, message string) {
	Custom(c, 401, message, nil)
}

func Forbidden(c *app.RequestContext, message string) {
	Custom(c, 403, message, nil)
}

func NotFound(c *app.RequestContext, message string) {
	Custom(c, 404, message, nil)
}

func InternalServerError(c *app.RequestContext, message string) {
	Custom(c, 500, message, nil)
}

// InternalError 服务器内部错误：原始错误只写日志，客户端只收到 internal_server_error；业务错误按原样返回
func InternalError(c *app.RequestContext, err error) {
	var svcerr *errs.ServiceError
	if errors.As(err, &svcerr) {
		Error(c, svcerr)
		return
	}
	Error(c, errs.Internal(ErrInternalServerError, err))
}

func Error(c *app.RequestContext, err *errs.ServiceError) {
	writeError(c, err, nil)
}

func writeError(c *app.RequestContext, err *errs.ServiceError, data any) {
	c.JSON(err.Code, utils.H{
		"status":  err.Code,
		"message": err.Message,
		"data":    data,
		"error":   err.Body(),
	})
	c.Abort()
	c.Set("error", err.Message)
	entry := logrus.WithField("path", string(c.Path())).WithField("status", err.Code)
	if err.Err != nil {
		entry = entry.WithError(err.Err)
	}
	switch {
	case err.Code >= 500:
		entry.Error(err.Message)
	case err.Err != nil:
		entry.Warn(err.Message)
	default:
		entry.Info(err.Message)
	}
}
