package filedriver

import (
	"fmt"
	"github.com/LiteyukiStudio/spage/pkg/constants"
	"github.com/cloudwego/hertz/pkg/app"
	"io"
	"os"
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
	Type           string `mapstructure:"file.driver.type"`
	BasePath       string `mapstructure:"file.driver.base_path"`
	WebDavUrl      string `mapstructure:"file.driver.webdav.url"`
	WebDavUser     string `mapstructure:"file.driver.webdav.user"`
	WebDavPassword string `mapstructure:"file.driver.webdav.password"`
	WebDavPolicy   string `mapstructure:"file.driver.webdav.policy"` // proxy|redirect
}

func GetFileDriver(driverConfig *DriverConfig) (FileDriver, error) {
	switch driverConfig.Type {
	case constants.FileDriverLocal:
		return NewLocalDriver(driverConfig), nil
	case constants.FileDriverWebdav:
		return NewWebDAVClientDriver(driverConfig), nil
	default:
		return nil, fmt.Errorf("unsupported file driver type: %s", driverConfig.Type)
	}
}
