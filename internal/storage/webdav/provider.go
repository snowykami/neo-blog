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
	baseURL       string // 保存基础URL
	baseDir       string
	baseAccessURL string // 用于生成访问URL
}

// NewWebDAVStorageProvider 创建WebDAV存储提供者
func NewWebDAVStorageProvider(providerConfig model.StorageProviderModelAndDto) (storageprovider.StorageProvider, error) {

	if providerConfig.WebDAVBaseURL == "" {
		return nil, fmt.Errorf("base_url is required for WebDAV provider")
	}

	client := gowebdav.NewClient(providerConfig.WebDAVBaseURL, providerConfig.WebDAVUsername, providerConfig.WebDAVPassword)

	return &WebDAVStorageProvider{
		config:  providerConfig,
		client:  client,
		baseURL: providerConfig.WebDAVBaseURL,
		baseDir: providerConfig.BaseDir,
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

// Save 保存文件
func (p *WebDAVStorageProvider) Save(ctx context.Context, filePath string, reader io.Reader) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("failed to read data: %w", err)
	}

	fullPath := p.fullPath(filePath)
	err = p.client.Write(fullPath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write file %s: %w", fullPath, err)
	}

	return nil
}

// Open 打开文件进行读取
func (p *WebDAVStorageProvider) Open(ctx context.Context, filePath string) (storageprovider.ReadableFile, error) {
	fullPath := p.fullPath(filePath)

	data, err := p.client.Read(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", fullPath, err)
	}

	// 获取文件信息
	info, err := p.Stat(ctx, filePath)
	if err != nil {
		// 如果无法获取stat信息，创建基本信息
		info = &WebDAVFileInfo{
			path:    filePath,
			name:    path.Base(filePath),
			size:    int64(len(data)),
			modTime: time.Now(),
			isDir:   false,
		}
	}

	reader := bytes.NewReader(data)

	return &WebDAVReadableFile{
		WebDAVFileInfo: info.(*WebDAVFileInfo),
		reader:         reader,
		provider:       p,
	}, nil
}

// OpenRange 打开文件的指定范围进行读取
func (p *WebDAVStorageProvider) OpenRange(ctx context.Context, filePath string, offset, length int64) (storageprovider.ReadableFile, error) {
	// WebDAV 不直接支持范围读取，我们先读取整个文件然后进行范围切片
	file, err := p.Open(ctx, filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file for range reading: %w", err)
	}
	defer file.Close()

	// 移动到指定偏移量
	_, err = file.Seek(offset, io.SeekStart)
	if err != nil {
		return nil, fmt.Errorf("failed to seek to offset %d: %w", offset, err)
	}

	// 如果指定了长度，只读取指定长度的数据
	var data []byte
	if length > 0 {
		data = make([]byte, length)
		n, err := io.ReadFull(file, data)
		if err != nil && err != io.ErrUnexpectedEOF {
			return nil, fmt.Errorf("failed to read range data: %w", err)
		}
		data = data[:n]
	} else {
		// 读取从偏移量到文件结尾的所有数据
		data, err = io.ReadAll(file)
		if err != nil {
			return nil, fmt.Errorf("failed to read range data: %w", err)
		}
	}

	// 创建新的文件信息，更新大小
	info := &WebDAVFileInfo{
		path:    filePath,
		name:    path.Base(filePath),
		size:    int64(len(data)),
		modTime: file.ModTime(),
		isDir:   false,
	}

	reader := bytes.NewReader(data)

	return &WebDAVReadableFile{
		WebDAVFileInfo: info,
		reader:         reader,
		provider:       p,
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
	baseURL := strings.TrimSuffix(p.baseURL, "/")
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
