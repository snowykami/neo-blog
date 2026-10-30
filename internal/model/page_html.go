package model

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"

	"gorm.io/gorm"
)

// PageHTMLVersion HTML 页面上传的一个版本：静态文件解压到存储的 page-html/{页面ID}/{Key}/ 下，始终经后端代理访问
type PageHTMLVersion struct {
	gorm.Model
	PageID     uint          `gorm:"index;not null"`
	UserID     uint          // 上传者
	Version    int           `gorm:"not null"`                              // 页面内递增的版本号，用于展示
	Key        string        `gorm:"type:varchar(40);uniqueIndex;not null"` // 访问路径中的版本标识，随机生成且不可猜测
	ProviderID uint          // 文件所在的存储提供者
	Entry      string        `gorm:"type:text;not null"` // 入口文件（相对路径）
	SourceName string        `gorm:"type:text"`          // 上传时的原始文件名
	TotalSize  int64         // 解压后的总大小
	Files      PageHTMLFiles `gorm:"type:text"` // 文件清单：只允许访问清单内的文件
}

// PageHTMLFile 版本内的一个文件
type PageHTMLFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// PageHTMLFiles 以 JSON 文本存储的文件清单
type PageHTMLFiles []PageHTMLFile

func (f PageHTMLFiles) Value() (driver.Value, error) {
	b, err := json.Marshal([]PageHTMLFile(f))
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (f *PageHTMLFiles) Scan(src any) error {
	var data []byte
	switch v := src.(type) {
	case nil:
		*f = nil
		return nil
	case string:
		data = []byte(v)
	case []byte:
		data = v
	default:
		return fmt.Errorf("cannot scan PageHTMLFiles from %T", src)
	}
	if len(data) == 0 {
		*f = nil
		return nil
	}
	return json.Unmarshal(data, f)
}

// HasFile 文件是否在清单内（路径区分大小写，与上传时一致）
func (v *PageHTMLVersion) HasFile(path string) (PageHTMLFile, bool) {
	for _, file := range v.Files {
		if file.Path == path {
			return file, true
		}
	}
	return PageHTMLFile{}, false
}
