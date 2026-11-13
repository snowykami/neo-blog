package s3

import (
	"bytes"
	"context"
	"errors"
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

// S3ReadableFile S3流式可读文件（不把整个对象读入内存；Seek 时按偏移重新发起范围读取）
type S3ReadableFile struct {
	*S3FileInfo
	body   io.ReadCloser
	offset int64
	reopen func(offset int64) (io.ReadCloser, error)
}

func (f *S3ReadableFile) Read(p []byte) (int, error) {
	if f.body == nil {
		return 0, io.EOF
	}
	n, err := f.body.Read(p)
	f.offset += int64(n)
	return n, err
}

func (f *S3ReadableFile) Seek(offset int64, whence int) (int64, error) {
	var next int64
	switch whence {
	case io.SeekStart:
		next = offset
	case io.SeekCurrent:
		next = f.offset + offset
	case io.SeekEnd:
		next = f.size + offset
	default:
		return 0, errors.New("s3: invalid whence")
	}
	if next < 0 {
		return 0, errors.New("s3: negative seek position")
	}
	if next == f.offset {
		return f.offset, nil
	}
	if f.body != nil {
		_ = f.body.Close()
		f.body = nil
	}
	if next >= f.size {
		f.offset = next
		return next, nil
	}
	if f.reopen == nil {
		return 0, errors.New("s3: stream is not seekable")
	}
	rc, err := f.reopen(next)
	if err != nil {
		return f.offset, err
	}
	f.body = rc
	f.offset = next
	return next, nil
}

func (f *S3ReadableFile) Close() error {
	if f.body != nil {
		err := f.body.Close()
		f.body = nil
		return err
	}
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
