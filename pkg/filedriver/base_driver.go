package filedriver

import (
	"fmt"

	"io"
	"os"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

type FileDriver interface {
	Save(ctx *app.RequestContext, path string, r io.Reader) error
	Open(ctx *app.RequestContext, path string) (io.ReadCloser, error)
	Delete(ctx *app.RequestContext, path string) error
	Stat(ctx *app.RequestContext, path string) (os.FileInfo, error)
	Get(ctx *app.RequestContext, path string)
	ListDir(ctx *app.RequestContext, path string) ([]os.FileInfo, error)
}

type DriverConfig struct {
	Type           string
	BasePath       string
	WebDavUrl      string
	WebDavUser     string
	WebDavPassword string
	WebDavPolicy   string
}

func GetFileDriverConfig() *DriverConfig {
	return &DriverConfig{
		Type:           utils.Env.Get(constant.EnvKeyFileDriverType, constant.FileDriverTypeLocal),
		BasePath:       utils.Env.Get(constant.EnvKeyFileBasepath, constant.DefaultFileBasePath),
		WebDavUrl:      utils.Env.Get(constant.EnvKeyFileWebdavUrl),
		WebDavUser:     utils.Env.Get(constant.EnvKeyFileWebdavUser),
		WebDavPassword: utils.Env.Get(constant.EnvKeyFileWebdavPassword),
		WebDavPolicy:   utils.Env.Get(constant.EnvKeyFileWebdavPolicy),
	}
}

func GetFileDriver(driverConfig *DriverConfig) (FileDriver, error) {
	switch driverConfig.Type {
	case constant.FileDriverTypeLocal:
		return NewLocalDriver(driverConfig), nil
	case constant.FileDriverTypeWebdav:
		return NewWebDAVClientDriver(driverConfig), nil
	default:
		return nil, fmt.Errorf("unsupported file driver type: %s", driverConfig.Type)
	}
}
