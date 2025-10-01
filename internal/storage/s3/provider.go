package s3

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

// S3Config S3配置
type S3Config struct {
	Region          string `json:"region"`            // AWS区域
	Bucket          string `json:"bucket"`            // S3存储桶名称
	AccessKeyID     string `json:"access_key_id"`     // AWS访问密钥ID
	SecretAccessKey string `json:"secret_access_key"` // AWS访问密钥
	Endpoint        string `json:"endpoint"`          // 自定义端点（用于兼容S3的存储服务）
	UsePathStyle    bool   `json:"use_path_style"`    // 是否使用路径风格URL
	BaseURL         string `json:"base_url"`          // 用于生成公开访问URL的基础URL
	Prefix          string `json:"prefix"`            // 对象键前缀
}

// S3StorageProvider S3存储提供者
type S3StorageProvider struct {
	cfg     model.StorageProviderModelAndDto
	client  *s3.Client
	bucket  string
	prefix  string
	baseURL string
}

// NewS3StorageProvider 创建S3存储提供者
// configMap参数包含必要的配置项
func NewS3StorageProvider(providerConfig model.StorageProviderModelAndDto) (storageprovider.StorageProvider, error) {
	cfg := &S3Config{

		Region:          providerConfig.S3Region,
		Bucket:          providerConfig.S3Bucket,
		AccessKeyID:     providerConfig.S3AccessKeyID,
		SecretAccessKey: providerConfig.S3SecretAccessKey,
		Endpoint:        providerConfig.S3Endpoint,
		UsePathStyle:    providerConfig.S3UsePathStyle,
		BaseURL:         providerConfig.S3BaseURL,
		Prefix:          providerConfig.S3Prefix,
	}

	if cfg.Region == "" {
		cfg.Region = "us-east-1" // 默认区域
	}
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("bucket is required for S3 provider")
	}

	// 创建AWS配置
	var awsCfg aws.Config
	var err error

	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		// 使用提供的凭证
		awsCfg, err = config.LoadDefaultConfig(context.TODO(),
			config.WithRegion(cfg.Region),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				cfg.AccessKeyID,
				cfg.SecretAccessKey,
				"",
			)),
		)
	} else {
		// 使用默认凭证链
		awsCfg, err = config.LoadDefaultConfig(context.TODO(),
			config.WithRegion(cfg.Region),
		)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	// 创建S3客户端
	var clientOptions []func(*s3.Options)
	if cfg.Endpoint != "" {
		clientOptions = append(clientOptions, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
			o.UsePathStyle = cfg.UsePathStyle
		})
	}

	client := s3.NewFromConfig(awsCfg, clientOptions...)

	return &S3StorageProvider{
		cfg:     providerConfig,
		client:  client,
		bucket:  cfg.Bucket,
		prefix:  cfg.Prefix,
		baseURL: cfg.BaseURL,
	}, nil
}

// Name 返回提供者名称
func (p *S3StorageProvider) Name() string {
	return "s3"
}

// fullKey 构建完整的对象键
func (p *S3StorageProvider) fullKey(filePath string) string {
	key := filePath
	if p.prefix != "" {
		key = path.Join(p.prefix, filePath)
	}
	return strings.TrimPrefix(key, "/")
}

// Save 保存文件到S3
func (p *S3StorageProvider) Save(ctx context.Context, filePath string, reader io.Reader) error {
	// 读取所有数据
	data, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("failed to read data: %w", err)
	}

	key := p.fullKey(filePath)

	_, err = p.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(data),
	})

	if err != nil {
		return fmt.Errorf("failed to upload file to S3: %w", err)
	}

	return nil
}

// Create 创建可写文件
func (p *S3StorageProvider) Create(ctx context.Context, filePath string) (storageprovider.WritableFile, error) {
	return &S3WritableFile{
		path:     filePath,
		buffer:   &bytes.Buffer{},
		provider: p,
	}, nil
}

// Open 打开文件进行读取
func (p *S3StorageProvider) Open(ctx context.Context, filePath string) (storageprovider.ReadableFile, error) {
	key := p.fullKey(filePath)

	result, err := p.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get object from S3: %w", err)
	}

	// 读取所有数据到内存
	data, err := io.ReadAll(result.Body)
	result.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("failed to read object data: %w", err)
	}

	// 获取文件信息
	info := &S3FileInfo{
		path:    filePath,
		name:    path.Base(filePath),
		size:    *result.ContentLength,
		modTime: *result.LastModified,
		isDir:   false,
	}

	return &S3ReadableFile{
		S3FileInfo: info,
		reader:     bytes.NewReader(data),
	}, nil
}

// OpenRange 打开文件的指定范围进行读取
func (p *S3StorageProvider) OpenRange(ctx context.Context, filePath string, offset, length int64) (storageprovider.ReadableFile, error) {
	key := p.fullKey(filePath)

	rangeHeader := fmt.Sprintf("bytes=%d-", offset)
	if length > 0 {
		rangeHeader = fmt.Sprintf("bytes=%d-%d", offset, offset+length-1)
	}

	result, err := p.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
		Range:  aws.String(rangeHeader),
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get object range from S3: %w", err)
	}

	// 读取所有数据到内存
	data, err := io.ReadAll(result.Body)
	result.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("failed to read object data: %w", err)
	}

	// 获取文件信息
	info := &S3FileInfo{
		path:    filePath,
		name:    path.Base(filePath),
		size:    int64(len(data)),
		modTime: *result.LastModified,
		isDir:   false,
	}

	return &S3ReadableFile{
		S3FileInfo: info,
		reader:     bytes.NewReader(data),
	}, nil
}

// Stat 获取文件信息
func (p *S3StorageProvider) Stat(ctx context.Context, filePath string) (storageprovider.FileInfo, error) {
	key := p.fullKey(filePath)

	result, err := p.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get object info from S3: %w", err)
	}

	return &S3FileInfo{
		path:    filePath,
		name:    path.Base(filePath),
		size:    *result.ContentLength,
		modTime: *result.LastModified,
		isDir:   false,
	}, nil
}

// Exists 检查文件是否存在
func (p *S3StorageProvider) Exists(ctx context.Context, filePath string) (bool, error) {
	_, err := p.Stat(ctx, filePath)
	if err != nil {
		// 检查是否是NoSuchKey错误
		var nsk *types.NoSuchKey
		if errors.As(err, &nsk) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Delete 删除文件
func (p *S3StorageProvider) Delete(ctx context.Context, filePath string) error {
	key := p.fullKey(filePath)

	_, err := p.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	})

	if err != nil {
		return fmt.Errorf("failed to delete object from S3: %w", err)
	}

	return nil
}

// Rename 重命名文件
func (p *S3StorageProvider) Rename(ctx context.Context, oldPath, newPath string) error {
	oldKey := p.fullKey(oldPath)
	newKey := p.fullKey(newPath)

	// S3中的重命名实际上是复制+删除操作
	copySource := fmt.Sprintf("%s/%s", p.bucket, oldKey)

	_, err := p.client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(p.bucket),
		Key:        aws.String(newKey),
		CopySource: aws.String(copySource),
	})

	if err != nil {
		return fmt.Errorf("failed to copy object in S3: %w", err)
	}

	// 删除原文件
	err = p.Delete(ctx, oldPath)
	if err != nil {
		return fmt.Errorf("failed to delete old object after rename: %w", err)
	}

	return nil
}

// List 列出目录内容
func (p *S3StorageProvider) List(ctx context.Context, prefix string) ([]storageprovider.FileInfo, error) {
	return p.ListWithFilter(ctx, prefix, nil)
}

// ListWithFilter 列出目录内容并应用过滤器
func (p *S3StorageProvider) ListWithFilter(ctx context.Context, prefix string, filter func(storageprovider.FileInfo) bool) ([]storageprovider.FileInfo, error) {
	listPrefix := p.fullKey(prefix)
	if listPrefix != "" && !strings.HasSuffix(listPrefix, "/") {
		listPrefix += "/"
	}

	var files []storageprovider.FileInfo
	paginator := s3.NewListObjectsV2Paginator(p.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(p.bucket),
		Prefix: aws.String(listPrefix),
	})

	for paginator.HasMorePages() {
		result, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list objects from S3: %w", err)
		}

		for _, obj := range result.Contents {
			// 计算相对路径
			relativePath := *obj.Key
			if p.prefix != "" {
				relativePath = strings.TrimPrefix(relativePath, p.prefix)
				relativePath = strings.TrimPrefix(relativePath, "/")
			}

			info := &S3FileInfo{
				path:    relativePath,
				name:    path.Base(relativePath),
				size:    *obj.Size,
				modTime: *obj.LastModified,
				isDir:   false,
			}

			// 应用过滤器
			if filter == nil || filter(info) {
				files = append(files, info)
			}
		}
	}

	return files, nil
}

// GetURL 生成文件访问URL
func (p *S3StorageProvider) GetURL(ctx context.Context, filePath string, expires time.Duration) (string, error) {
	// 如果配置了基础URL，使用它来生成公开访问链接
	if p.baseURL != "" {
		baseURL := strings.TrimSuffix(p.baseURL, "/")
		key := p.fullKey(filePath)
		return fmt.Sprintf("%s/%s", baseURL, key), nil
	}

	// 生成预签名URL
	key := p.fullKey(filePath)

	presignClient := s3.NewPresignClient(p.client)
	result, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expires
	})

	if err != nil {
		return "", fmt.Errorf("failed to generate presigned URL: %w", err)
	}

	return result.URL, nil
}

func (p *S3StorageProvider) IsDefault() bool {
	return p.cfg.IsDefault
}

func (p *S3StorageProvider) IsProxy() bool {
	return false
}
