package model

import (
	"gorm.io/gorm"
)

type File struct {
	gorm.Model
	Hash       string `gorm:"not null"`           // 文件哈希值 File hash
	UserID     uint   `gorm:"not null"`           // 上传者ID Uploader ID
	ProviderID uint   `gorm:"not null;default:1"` // 存储提供商ID Storage provider ID,默认是第一个
	Group      string // 分组名称
	Name       string // 文件名，为空显示未hash
	Size       int64  // 文件大小 File size
	MimeType   string // 文件 MIME 类型 File MIME type
}

func (f *File) ToDto() map[string]any {
	return map[string]any{
		"id":          f.ID,
		"hash":        f.Hash,
		"user_id":     f.UserID,
		"provider_id": f.ProviderID,
		"group":       f.Group,
		"name":        f.Name,
		"size":        f.Size,
		"created_at":  f.CreatedAt,
		"updated_at":  f.UpdatedAt,
		"mime_type":   f.MimeType,
	}
}

type StorageProviderModelAndDto struct {
	gorm.Model
	ID        uint   `gorm:"primaryKey" path:"id" json:"id"`                                            // 主键 ID
	Name      string `gorm:"not null" json:"name"`                                                      // 存储提供商名称 Storage provider name
	Type      string `gorm:"not null" json:"type"`                                                      // 存储提供商类型 local/webdav/s3/sftp等
	IsDefault bool   `gorm:"index:unique_default_partial,where:is_default;default:0" json:"is_default"` // 是否为默认存储提供者 Only one provider can be default
	StorageProviderConfig
}

// 这部分dto和model共用
type StorageProviderConfig struct {
	// for local & webdav storage provider
	BaseDir string `json:"base_dir"` // 本地存储目录 Local storage directory
	// for s3 storage provider
	S3Region          string `json:"s3_region"`            // S3区域 S3 region
	S3Bucket          string `json:"s3_bucket"`            // S3桶名 S3 bucket name
	S3Prefix          string `json:"s3_prefix"`            // S3对象前缀 S3 object prefix
	S3AccessKeyID     string `json:"s3_access_key_id"`     // AWS访问密钥ID AWS Access Key ID
	S3SecretAccessKey string `json:"s3_secret_access_key"` // AWS访问密钥 AWS Secret Access Key
	S3Endpoint        string `json:"s3_endpoint"`          // 自定义端点 Custom endpoint (for S3-compatible services)
	S3UsePathStyle    bool   `json:"s3_use_path_style"`    // 是否使用路径风格URL Whether to use path-style URLs
	S3BaseURL         string `json:"s3_base_url"`          // 用于生成公开访问URL的基础URL Base URL for generating public access URLs
	// for webdav only
	WebDAVBaseURL  string `json:"webdav_base_url"` // WebDAV服务器基础URL WebDAV server base URL
	WebDAVUsername string `json:"webdav_username"` // WebDAV用户名 WebDAV username
	WebDAVPassword string `json:"webdav_password"` // WebDAV密码 WebDAV password
	// for sftp only
}
