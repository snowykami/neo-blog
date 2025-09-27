package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
)

func GetIDParam(c *app.RequestContext) *dto.BindID {
	logrus.Debug("Getting ID param from context", c.Param("id"))
	param := &dto.BindID{}
	err := c.Bind(param)
	if err != nil {
		return &dto.BindID{
			Uint:   0,
			Uint64: 0,
			Int64:  0,
		}
	}
	return param
}
