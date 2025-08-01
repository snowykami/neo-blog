package resps

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
)

func Custom(c *app.RequestContext, status int, message string, data any) {
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
