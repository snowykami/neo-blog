package filedriver

import (
	"github.com/cloudwego/hertz/pkg/app"
	"io"
	"os"
	"path/filepath"
)

type LocalDriver struct {
	BasePath string
}

func NewLocalDriver(driverConfig *DriverConfig) *LocalDriver {
	return &LocalDriver{
		BasePath: driverConfig.BasePath,
	}
}

func (d *LocalDriver) fullPath(path string) string {
	return filepath.Join(d.BasePath, path)
}

func (d *LocalDriver) Save(ctx *app.RequestContext, path string, r io.Reader) error {
	full := d.fullPath(path)
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		return err
	}
	f, err := os.Create(full)
	if err != nil {
		return err
	}
	defer func(f *os.File) {
		err := f.Close()
		if err != nil {

		}
	}(f)
	_, err = io.Copy(f, r)
	return err
}

func (d *LocalDriver) Open(ctx *app.RequestContext, path string) (io.ReadCloser, error) {
	return os.Open(d.fullPath(path))
}

func (d *LocalDriver) Get(ctx *app.RequestContext, path string) {
	ctx.File(d.fullPath(path))
	ctx.Abort()
}

func (d *LocalDriver) Delete(ctx *app.RequestContext, path string) error {
	return os.Remove(d.fullPath(path))
}

func (d *LocalDriver) Stat(ctx *app.RequestContext, path string) (os.FileInfo, error) {
	return os.Stat(d.fullPath(path))
}

func (d *LocalDriver) ListDir(ctx *app.RequestContext, path string) ([]os.FileInfo, error) {
	entries, err := os.ReadDir(d.fullPath(path))
	if err != nil {
		return nil, err
	}
	infos := make([]os.FileInfo, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		infos = append(infos, info)
	}
	return infos, nil
}
