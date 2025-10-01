package storageprovider

import (
	"context"
	"errors"
	"io"
	"time"
)

var (
	ErrNotSupported = errors.New("operation not supported")
)

// FileInfo 文件基础信息
type FileInfo interface {
	Path() string       // 文件路径
	Name() string       // 文件名
	Size() int64        // 文件大小
	ModTime() time.Time // 修改时间
	IsDir() bool        // 是否为目录
}

// ReadableFile 可读文件，支持流式读取
type ReadableFile interface {
	FileInfo
	io.ReadSeekCloser // 支持读取、定位和关闭
}

type WritableFile interface {
	io.WriteCloser
	Path() string
	Commit(ctx context.Context) error
	Abort(ctx context.Context) error
}

// StorageProvider 存储提供者接口
type StorageProvider interface {
	// 基础操作
	Save(ctx context.Context, path string, reader io.Reader) error

	// 流式读取
	Open(ctx context.Context, path string) (ReadableFile, error)
	OpenRange(ctx context.Context, path string, offset, length int64) (ReadableFile, error)

	// 文件操作
	Stat(ctx context.Context, path string) (FileInfo, error)
	Exists(ctx context.Context, path string) (bool, error)
	Delete(ctx context.Context, path string) error
	Rename(ctx context.Context, oldPath, newPath string) error

	// 目录操作
	List(ctx context.Context, prefix string) ([]FileInfo, error)
	ListWithFilter(ctx context.Context, prefix string, filter func(FileInfo) bool) ([]FileInfo, error)

	// 生成访问URL
	GetURL(ctx context.Context, path string, expires time.Duration) (string, error)

	// 获取提供者名称
	Name() string
	IsDefault() bool
	IsProxy() bool // 是否后端代理文件，本地储存必须代理
}

// 工厂函数类型
type ProviderFactory func(config map[string]any) (StorageProvider, error)

// 配置选项
type Config struct {
	Provider string         `json:"provider"` // local, s3, webdav等
	BaseDir  string         `json:"base_dir"` // 基础目录
	BaseURL  string         `json:"base_url"` // 访问基础URL
	Options  map[string]any `json:"options"`  // 提供者特定配置
}
