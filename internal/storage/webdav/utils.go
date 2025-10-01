package webdav

import (
	"bytes"
	"context"
	"io"
	"os"
	"time"
)

// WebDAVFileInfo WebDAV文件信息
type WebDAVFileInfo struct {
	path    string
	name    string
	size    int64
	modTime time.Time
	isDir   bool
}

func (f *WebDAVFileInfo) Path() string       { return f.path }
func (f *WebDAVFileInfo) Name() string       { return f.name }
func (f *WebDAVFileInfo) Size() int64        { return f.size }
func (f *WebDAVFileInfo) ModTime() time.Time { return f.modTime }
func (f *WebDAVFileInfo) IsDir() bool        { return f.isDir }

// WebDAVReadableFile WebDAV可读文件
type WebDAVReadableFile struct {
	*WebDAVFileInfo
	reader   io.ReadSeeker
	closer   func() error
	provider *WebDAVStorageProvider
}

func (f *WebDAVReadableFile) Read(p []byte) (int, error) {
	return f.reader.Read(p)
}

func (f *WebDAVReadableFile) Seek(offset int64, whence int) (int64, error) {
	return f.reader.Seek(offset, whence)
}

func (f *WebDAVReadableFile) Close() error {
	if f.closer != nil {
		return f.closer()
	}
	return nil
}

// WebDAVWritableFile WebDAV可写文件
type WebDAVWritableFile struct {
	path     string
	buffer   *bytes.Buffer
	provider *WebDAVStorageProvider
}

func (f *WebDAVWritableFile) Write(p []byte) (int, error) {
	return f.buffer.Write(p)
}

func (f *WebDAVWritableFile) Path() string {
	return f.path
}

func (f *WebDAVWritableFile) Close() error {
	return f.Commit(context.Background())
}

func (f *WebDAVWritableFile) Commit(ctx context.Context) error {
	return f.provider.Save(ctx, f.path, f.buffer)
}

func (f *WebDAVWritableFile) Abort(ctx context.Context) error {
	f.buffer.Reset()
	return nil
}

// WebDAVConfig WebDAV配置

// osFileInfoAdapter 适配器，将os.FileInfo转换为我们的FileInfo接口
type osFileInfoAdapter struct {
	fileInfo os.FileInfo
	path     string
}

func (a *osFileInfoAdapter) Path() string       { return a.path }
func (a *osFileInfoAdapter) Name() string       { return a.fileInfo.Name() }
func (a *osFileInfoAdapter) Size() int64        { return a.fileInfo.Size() }
func (a *osFileInfoAdapter) ModTime() time.Time { return a.fileInfo.ModTime() }
func (a *osFileInfoAdapter) IsDir() bool        { return a.fileInfo.IsDir() }
