package webdav

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/studio-b12/gowebdav"
)

// WebDAVStorageProvider WebDAV存储提供者
type WebDAVStorageProvider struct {
	config        model.StorageProviderModelAndDto
	client        *gowebdav.Client
	endpoint      string // 保存基础URL
	baseDir       string
	baseAccessURL string // 用于生成访问URL
}

// NewWebDAVStorageProvider 创建WebDAV存储提供者
func NewWebDAVStorageProvider(providerConfig model.StorageProviderModelAndDto) (storageprovider.StorageProvider, error) {

	if providerConfig.WebDAVEndpoint == "" {
		return nil, fmt.Errorf("base_url is required for WebDAV provider")
	}

	client := gowebdav.NewClient(providerConfig.WebDAVEndpoint, providerConfig.WebDAVUsername, providerConfig.WebDAVPassword)

	return &WebDAVStorageProvider{
		config:   providerConfig,
		client:   client,
		endpoint: providerConfig.WebDAVEndpoint,
		baseDir:  providerConfig.BaseDir,
	}, nil
}

// Name 返回提供者名称
func (p *WebDAVStorageProvider) Name() string {
	return "webdav"
}

// fullPath 构建完整路径
func (p *WebDAVStorageProvider) fullPath(filePath string) string {
	if p.baseDir == "" {
		return filePath
	}
	return path.Join(p.baseDir, filePath)
}

// Save 保存文件（流式上传，不整包读入内存）
func (p *WebDAVStorageProvider) Save(ctx context.Context, filePath string, reader io.Reader) error {
	fullPath := p.fullPath(filePath)
	if rs, ok := reader.(io.ReadSeeker); ok {
		if cur, err := rs.Seek(0, io.SeekCurrent); err == nil {
			if end, err := rs.Seek(0, io.SeekEnd); err == nil {
				if _, err := rs.Seek(cur, io.SeekStart); err == nil {
					if err := p.client.WriteStreamWithLength(fullPath, rs, end-cur, 0644); err != nil {
						return fmt.Errorf("failed to write file %s: %w", fullPath, err)
					}
					return nil
				}
			}
		}
	}
	if err := p.client.WriteStream(fullPath, reader, 0644); err != nil {
		return fmt.Errorf("failed to write file %s: %w", fullPath, err)
	}
	return nil
}

// Open 打开文件进行流式读取
func (p *WebDAVStorageProvider) Open(ctx context.Context, filePath string) (storageprovider.ReadableFile, error) {
	fullPath := p.fullPath(filePath)

	info, err := p.Stat(ctx, filePath)
	if err != nil {
		return nil, err
	}
	stream, err := p.client.ReadStream(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", fullPath, err)
	}
	fileInfo := info.(*WebDAVFileInfo)

	return &WebDAVReadableFile{
		WebDAVFileInfo: fileInfo,
		body:           stream,
		reopen: func(offset int64) (io.ReadCloser, error) {
			return p.client.ReadStreamRange(fullPath, offset, fileInfo.size-offset)
		},
	}, nil
}

// OpenRange 打开文件的指定范围进行流式读取
func (p *WebDAVStorageProvider) OpenRange(ctx context.Context, filePath string, offset, length int64) (storageprovider.ReadableFile, error) {
	fullPath := p.fullPath(filePath)

	statInfo, err := p.Stat(ctx, filePath)
	if err != nil {
		return nil, err
	}
	readLen := length
	if readLen <= 0 || offset+readLen > statInfo.Size() {
		readLen = statInfo.Size() - offset
	}
	if readLen < 0 {
		readLen = 0
	}
	var stream io.ReadCloser
	if readLen == 0 {
		stream = io.NopCloser(bytes.NewReader(nil))
	} else {
		stream, err = p.client.ReadStreamRange(fullPath, offset, readLen)
		if err != nil {
			return nil, fmt.Errorf("failed to read file range %s: %w", fullPath, err)
		}
	}

	info := &WebDAVFileInfo{
		path:    filePath,
		name:    path.Base(filePath),
		size:    readLen,
		modTime: statInfo.ModTime(),
		isDir:   false,
	}

	return &WebDAVReadableFile{
		WebDAVFileInfo: info,
		body:           stream,
		reopen: func(relOffset int64) (io.ReadCloser, error) {
			rem := readLen - relOffset
			if rem <= 0 {
				return io.NopCloser(bytes.NewReader(nil)), nil
			}
			return p.client.ReadStreamRange(fullPath, offset+relOffset, rem)
		},
	}, nil
}

// Stat 获取文件信息
func (p *WebDAVStorageProvider) Stat(ctx context.Context, filePath string) (storageprovider.FileInfo, error) {
	fullPath := p.fullPath(filePath)

	fileInfo, err := p.client.Stat(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file %s: %w", fullPath, err)
	}

	return &WebDAVFileInfo{
		path:    filePath,
		name:    fileInfo.Name(),
		size:    fileInfo.Size(),
		modTime: fileInfo.ModTime(),
		isDir:   fileInfo.IsDir(),
	}, nil
}

// Exists 检查文件是否存在
func (p *WebDAVStorageProvider) Exists(ctx context.Context, filePath string) (bool, error) {
	_, err := p.Stat(ctx, filePath)
	if err != nil {
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "404") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Delete 删除文件
func (p *WebDAVStorageProvider) Delete(ctx context.Context, filePath string) error {
	fullPath := p.fullPath(filePath)
	err := p.client.Remove(fullPath)
	if err != nil {
		return fmt.Errorf("failed to delete file %s: %w", fullPath, err)
	}
	return nil
}

// Rename 重命名文件
func (p *WebDAVStorageProvider) Rename(ctx context.Context, oldPath, newPath string) error {
	oldFullPath := p.fullPath(oldPath)
	newFullPath := p.fullPath(newPath)

	err := p.client.Rename(oldFullPath, newFullPath, false)
	if err != nil {
		return fmt.Errorf("failed to rename file from %s to %s: %w", oldFullPath, newFullPath, err)
	}
	return nil
}

// List 列出目录内容
func (p *WebDAVStorageProvider) List(ctx context.Context, prefix string) ([]storageprovider.FileInfo, error) {
	return p.ListWithFilter(ctx, prefix, nil)
}

// ListWithFilter 列出目录内容并应用过滤器
func (p *WebDAVStorageProvider) ListWithFilter(ctx context.Context, prefix string, filter func(storageprovider.FileInfo) bool) ([]storageprovider.FileInfo, error) {
	fullPath := p.fullPath(prefix)

	fileInfos, err := p.client.ReadDir(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to list directory %s: %w", fullPath, err)
	}

	var files []storageprovider.FileInfo
	for _, fileInfo := range fileInfos {
		// 构建相对路径
		relativePath := path.Join(prefix, fileInfo.Name())

		info := &WebDAVFileInfo{
			path:    relativePath,
			name:    fileInfo.Name(),
			size:    fileInfo.Size(),
			modTime: fileInfo.ModTime(),
			isDir:   fileInfo.IsDir(),
		}

		// 应用过滤器
		if filter == nil || filter(info) {
			files = append(files, info)
		}
	}

	return files, nil
}

// GetURL 生成文件访问URL, webdav不需要过期时间
func (p *WebDAVStorageProvider) GetURL(ctx context.Context, filePath string, expires time.Duration) (string, error) {
	// 如果配置了访问URL基础路径，使用它来生成直接访问链接
	if p.baseAccessURL != "" {
		baseURL := strings.TrimSuffix(p.baseAccessURL, "/")
		fullPath := p.fullPath(filePath)
		if !strings.HasPrefix(fullPath, "/") {
			fullPath = "/" + fullPath
		}
		return baseURL + fullPath, nil
	}

	// 否则返回WebDAV URL（可能需要认证）
	// 注意：这种情况下客户端可能需要提供认证信息
	baseURL := strings.TrimSuffix(p.endpoint, "/")
	fullPath := p.fullPath(filePath)
	if !strings.HasPrefix(fullPath, "/") {
		fullPath = "/" + fullPath
	}
	return baseURL + fullPath, nil
}

// CreateWritableFile 创建可写文件
func (p *WebDAVStorageProvider) CreateWritableFile(path string) storageprovider.WritableFile {
	return &WebDAVWritableFile{
		path:     path,
		buffer:   &bytes.Buffer{},
		provider: p,
	}
}

func (p *WebDAVStorageProvider) IsDefault() bool {
	return p.config.IsDefault
}

func (p *WebDAVStorageProvider) IsProxy() bool {
	return true
}
