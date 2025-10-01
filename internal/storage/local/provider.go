package local

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

type LocalStorageProvider struct {
	baseDir string
	config  model.StorageProviderModelAndDto
}

// NewLocalStorageProvider 创建本地存储提供者
// 需要提供baseDir参数，指定存储的基础目录
func NewLocalStorageProvider(providerConfig model.StorageProviderModelAndDto) (storageprovider.StorageProvider, error) {
	return &LocalStorageProvider{
		baseDir: providerConfig.BaseDir,
		config:  providerConfig,
	}, nil
}

func (p *LocalStorageProvider) getFullPath(path string) string {
	// 清理路径，防止目录遍历攻击
	cleanPath := filepath.Clean(path)
	if strings.HasPrefix(cleanPath, "..") {
		cleanPath = strings.TrimPrefix(cleanPath, "..")
		cleanPath = strings.TrimPrefix(cleanPath, "/")
	}
	return filepath.Join(p.baseDir, cleanPath)
}

// Save 保存文件
func (p *LocalStorageProvider) Save(ctx context.Context, path string, reader io.Reader) error {
	fullPath := p.getFullPath(path)

	// 确保目录存在
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	file, err := os.Create(fullPath)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = io.Copy(file, reader)
	return err
}

// Create 创建可写文件
func (p *LocalStorageProvider) Create(ctx context.Context, path string) (storageprovider.WritableFile, error) {
	fullPath := p.getFullPath(path)

	// 确保目录存在
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	file, err := os.Create(fullPath)
	if err != nil {
		return nil, err
	}

	return &LocalWritableFile{
		File: file,
		path: path,
	}, nil
}

// Open 打开文件
func (p *LocalStorageProvider) Open(ctx context.Context, path string) (storageprovider.ReadableFile, error) {
	fullPath := p.getFullPath(path)
	file, err := os.Open(fullPath)
	if err != nil {
		return nil, err
	}

	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}

	fileInfo := &LocalFileInfo{
		path:    path,
		name:    stat.Name(),
		size:    stat.Size(),
		modTime: stat.ModTime(),
		isDir:   stat.IsDir(),
	}

	return &LocalReadableFile{
		File:     file,
		fileInfo: fileInfo,
	}, nil
}

// OpenRange 范围打开文件
func (p *LocalStorageProvider) OpenRange(ctx context.Context, path string, offset, length int64) (storageprovider.ReadableFile, error) {
	fullPath := p.getFullPath(path)
	file, err := os.Open(fullPath)
	if err != nil {
		return nil, err
	}

	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}

	// 定位到指定偏移量
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		file.Close()
		return nil, err
	}

	fileInfo := &LocalFileInfo{
		path:    path,
		name:    stat.Name(),
		size:    stat.Size(),
		modTime: stat.ModTime(),
		isDir:   stat.IsDir(),
	}

	var reader io.Reader = file
	rangeSize := length

	if length > 0 {
		// 限制读取长度
		reader = io.LimitReader(file, length)
		rangeSize = length
	} else if length == -1 {
		// 读到文件末尾
		rangeSize = stat.Size() - offset
	}

	return &LocalReadableFile{
		File:      file,
		fileInfo:  fileInfo,
		rangeSize: rangeSize,
		reader:    reader,
	}, nil
}

// Stat 获取文件信息
func (p *LocalStorageProvider) Stat(ctx context.Context, path string) (storageprovider.FileInfo, error) {
	fullPath := p.getFullPath(path)
	stat, err := os.Stat(fullPath)
	if err != nil {
		return nil, err
	}

	return &LocalFileInfo{
		path:    path,
		name:    stat.Name(),
		size:    stat.Size(),
		modTime: stat.ModTime(),
		isDir:   stat.IsDir(),
	}, nil
}

// Exists 检查文件是否存在
func (p *LocalStorageProvider) Exists(ctx context.Context, path string) (bool, error) {
	fullPath := p.getFullPath(path)
	_, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Delete 删除文件
func (p *LocalStorageProvider) Delete(ctx context.Context, path string) error {
	fullPath := p.getFullPath(path)
	return os.Remove(fullPath)
}

// Rename 重命名文件
func (p *LocalStorageProvider) Rename(ctx context.Context, oldPath, newPath string) error {
	oldFullPath := p.getFullPath(oldPath)
	newFullPath := p.getFullPath(newPath)
	return os.Rename(oldFullPath, newFullPath)
}

// List 列出文件
func (p *LocalStorageProvider) List(ctx context.Context, prefix string) ([]storageprovider.FileInfo, error) {
	fullPath := p.getFullPath(prefix)

	// 如果是文件，返回单个文件信息
	if stat, err := os.Stat(fullPath); err == nil && !stat.IsDir() {
		fileInfo := &LocalFileInfo{
			path:    prefix,
			name:    stat.Name(),
			size:    stat.Size(),
			modTime: stat.ModTime(),
			isDir:   false,
		}
		return []storageprovider.FileInfo{fileInfo}, nil
	}

	// 如果是目录，列出目录内容
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var files []storageprovider.FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		relativePath := filepath.Join(prefix, entry.Name())
		// 确保使用正斜杠作为路径分隔符，保持跨平台一致性
		relativePath = filepath.ToSlash(relativePath)

		fileInfo := &LocalFileInfo{
			path:    relativePath,
			name:    info.Name(),
			size:    info.Size(),
			modTime: info.ModTime(),
			isDir:   info.IsDir(),
		}
		files = append(files, fileInfo)
	}

	return files, nil
}

// ListWithFilter 带过滤器的文件列表
func (p *LocalStorageProvider) ListWithFilter(ctx context.Context, prefix string, filter func(storageprovider.FileInfo) bool) ([]storageprovider.FileInfo, error) {
	files, err := p.List(ctx, prefix)
	if err != nil {
		return nil, err
	}

	var filtered []storageprovider.FileInfo
	for _, file := range files {
		if filter(file) {
			filtered = append(filtered, file)
		}
	}

	return filtered, nil
}

// GetURL 生成访问URL（本地存储不支持）
func (p *LocalStorageProvider) GetURL(ctx context.Context, path string, expires time.Duration) (string, error) {
	return "", storageprovider.ErrNotSupported
}

// Name 返回提供者名称
func (p *LocalStorageProvider) Name() string {
	return "local"
}

func (p *LocalStorageProvider) IsDefault() bool {
	return p.config.IsDefault
}

func (p *LocalStorageProvider) IsProxy() bool {
	return true // 本地存储必须代理文件
}
