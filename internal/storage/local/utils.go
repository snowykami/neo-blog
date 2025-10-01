package local

import (
	"context"
	"io"
	"os"
	"time"

	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

// LocalFileInfo 本地文件信息实现
type LocalFileInfo struct {
	path    string
	name    string
	size    int64
	modTime time.Time
	isDir   bool
}

func (f *LocalFileInfo) Path() string       { return f.path }
func (f *LocalFileInfo) Name() string       { return f.name }
func (f *LocalFileInfo) Size() int64        { return f.size }
func (f *LocalFileInfo) ModTime() time.Time { return f.modTime }
func (f *LocalFileInfo) IsDir() bool        { return f.isDir }

// LocalReadableFile 本地可读文件
type LocalReadableFile struct {
	*os.File
	fileInfo  *LocalFileInfo
	rangeSize int64     // 用于范围读取时的大小限制
	reader    io.Reader // 用于限制读取长度
}

func (f *LocalReadableFile) Path() string { return f.fileInfo.Path() }
func (f *LocalReadableFile) Name() string { return f.fileInfo.Name() }
func (f *LocalReadableFile) Size() int64 {
	if f.rangeSize > 0 {
		return f.rangeSize
	}
	return f.fileInfo.Size()
}
func (f *LocalReadableFile) ModTime() time.Time { return f.fileInfo.ModTime() }
func (f *LocalReadableFile) IsDir() bool        { return f.fileInfo.IsDir() }

func (f *LocalReadableFile) Read(p []byte) (int, error) {
	if f.reader != nil {
		return f.reader.Read(p)
	}
	return f.File.Read(p)
}

// LocalWritableFile 本地可写文件
type LocalWritableFile struct {
	*os.File
	path      string
	committed bool
	aborted   bool
}

func (f *LocalWritableFile) Path() string { return f.path }

func (f *LocalWritableFile) Commit(ctx context.Context) error {
	if f.aborted {
		return storageprovider.ErrNotSupported // 文件已被取消
	}
	if f.committed {
		return nil // 已经提交过了
	}

	err := f.Sync() // 强制写入磁盘
	if err != nil {
		return err
	}

	f.committed = true
	return f.Close()
}

func (f *LocalWritableFile) Abort(ctx context.Context) error {
	if f.committed {
		return storageprovider.ErrNotSupported // 文件已提交，无法取消
	}

	f.aborted = true
	fileName := f.File.Name()
	f.Close()

	// 删除未完成的文件
	return os.Remove(fileName)
}

func (f *LocalWritableFile) Close() error {
	if f.File != nil {
		return f.File.Close()
	}
	return nil
}

// LocalStorageProvider 本地存储提供者
