package s3

import (
	"bytes"
	"context"
	"io"
	"time"
)

// S3FileInfo S3文件信息
type S3FileInfo struct {
	path    string
	name    string
	size    int64
	modTime time.Time
	isDir   bool
}

func (f *S3FileInfo) Path() string       { return f.path }
func (f *S3FileInfo) Name() string       { return f.name }
func (f *S3FileInfo) Size() int64        { return f.size }
func (f *S3FileInfo) ModTime() time.Time { return f.modTime }
func (f *S3FileInfo) IsDir() bool        { return f.isDir }

// S3ReadableFile S3可读文件
type S3ReadableFile struct {
	*S3FileInfo
	reader io.ReadSeeker
}

func (f *S3ReadableFile) Read(p []byte) (int, error) {
	return f.reader.Read(p)
}

func (f *S3ReadableFile) Seek(offset int64, whence int) (int64, error) {
	return f.reader.Seek(offset, whence)
}

func (f *S3ReadableFile) Close() error {
	// bytes.Reader 不需要关闭
	return nil
}

// S3WritableFile S3可写文件
type S3WritableFile struct {
	path     string
	buffer   *bytes.Buffer
	provider *S3StorageProvider
}

func (f *S3WritableFile) Write(p []byte) (int, error) {
	return f.buffer.Write(p)
}

func (f *S3WritableFile) Path() string {
	return f.path
}

func (f *S3WritableFile) Close() error {
	return f.Commit(context.Background())
}

func (f *S3WritableFile) Commit(ctx context.Context) error {
	// 这里需要将缓冲区的内容上传到S3
	return f.provider.Save(ctx, f.path, f.buffer)
}

func (f *S3WritableFile) Abort(ctx context.Context) error {
	f.buffer.Reset()
	return nil
}
