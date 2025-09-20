package filedriver

import (
	"bytes"
	"fmt"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"

	"io"
	"os"
	"path"

	"github.com/studio-b12/gowebdav"
)

type WebDAVClientDriver struct {
	client   *gowebdav.Client
	config   *DriverConfig
	BasePath string
}

func NewWebDAVClientDriver(driverConfig *DriverConfig) *WebDAVClientDriver {
	c := gowebdav.NewClient(driverConfig.WebDavUrl, driverConfig.WebDavUser, driverConfig.WebDavPassword)
	return &WebDAVClientDriver{client: c, BasePath: driverConfig.BasePath, config: driverConfig}
}

func (d *WebDAVClientDriver) fullPath(p string) string {
	if d.BasePath == "" {
		return p
	}
	return path.Join(d.BasePath, p)
}

func (d *WebDAVClientDriver) Save(ctx *app.RequestContext, p string, r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	return d.client.Write(d.fullPath(p), data, 0644)
}

func (d *WebDAVClientDriver) Open(ctx *app.RequestContext, p string) (io.ReadCloser, error) {
	data, err := d.client.Read(d.fullPath(p))
	if err != nil {
		return nil, err
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (d *WebDAVClientDriver) Get(ctx *app.RequestContext, p string) {
	if d.config.WebDavPolicy == constant.WebdavPolicyRedirect {
		ctx.Redirect(302, []byte(d.config.WebDavUrl+d.fullPath(p)))
		return
	} else {
		data, err := d.client.Read(d.fullPath(p))
		if err != nil {
			resps.InternalServerError(ctx, err.Error())
			return
		}
		ctx.SetBodyStream(bytes.NewReader(data), len(data))
		ctx.Response.Header.Set("Content-Type", "application/octet-stream")
		ctx.Response.Header.Set("Content-Length", fmt.Sprintf("%d", len(data)))
	}
}

func (d *WebDAVClientDriver) Delete(ctx *app.RequestContext, p string) error {
	return d.client.Remove(d.fullPath(p))
}

func (d *WebDAVClientDriver) Stat(ctx *app.RequestContext, p string) (os.FileInfo, error) {
	return d.client.Stat(d.fullPath(p))
}

func (d *WebDAVClientDriver) ListDir(ctx *app.RequestContext, p string) ([]os.FileInfo, error) {
	return d.client.ReadDir(d.fullPath(p))
}
