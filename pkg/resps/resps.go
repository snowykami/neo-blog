package resps

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func Custom(c *app.RequestContext, status int, message string, data any) {
	c.JSON(status, utils.H{
		"status":  status,
		"message": message,
		"data":    data,
	})
	c.Abort()
	if status >= 400 {
		c.Set("error", message)
		logrus.Error(message)
	}
}

func getErrorDetail(error ...string) string {
	if len(error) > 0 {
		return error[0]
	}
	return ""
}

func Ok(c *app.RequestContext, message string, data any) {
	Custom(c, 200, message, data)
}

func Redirect(c *app.RequestContext, url string) {
	c.Redirect(302, []byte(url))
}

func BadRequest(c *app.RequestContext, message string, error ...string) {
	Custom(c, 400, message, utils.H{
		"error": getErrorDetail(error...),
	})
}

func Unauthorized(c *app.RequestContext, message string, error ...string) {
	Custom(c, 401, message, utils.H{
		"error": getErrorDetail(error...),
	})
}

func Forbidden(c *app.RequestContext, message string, error ...string) {
	Custom(c, 403, message, utils.H{
		"error": getErrorDetail(error...),
	})
}

func NotFound(c *app.RequestContext, message string, error ...string) {
	Custom(c, 404, message, utils.H{
		"error": getErrorDetail(error...),
	})
}

func InternalServerError(c *app.RequestContext, message string, error ...string) {
	Custom(c, 500, message, utils.H{
		"error": getErrorDetail(error...),
	})
}

func Error(c *app.RequestContext, err *errs.ServiceError) {
	Custom(c, err.Code, err.Message, err.Data)
}
