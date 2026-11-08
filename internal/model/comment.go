package model

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"

	"gorm.io/gorm"
)

type Comment struct {
	gorm.Model
	UserID     uint   `gorm:"index"`                           // 评论的用户ID
	User       User   `gorm:"foreignKey:UserID;references:ID"` // 关联的用户
	TargetID   uint   `gorm:"index"`                           // 目标ID
	TargetType string `gorm:"index"`                           // 目标类型，如 "post", "page"
	RootID     uint   `gorm:"index;default:0"`                 // 根评论ID,用于分组同一线程的评论
	ReplyID    uint   `gorm:"index"`                           // 回复的评论ID
	Content    string `gorm:"type:text"`                       // 评论内容
	Language   string `gorm:"type:varchar(16);default:''"`     // 评论语言：AI 翻译时识别后写入，内容被修改后清空，未知时为空
	Depth      int    `gorm:"default:0"`                       // 评论的层级深度,从0开始计数
	IsPrivate  bool   `gorm:"default:false"`                   // 是否为私密评论，私密评论只有评论者和被评论对象所有者可见
	RemoteAddr string `gorm:"type:text"`                       // 远程地址
	UserAgent  string `gorm:"type:text"`
	CommentLocation
	LikeCount      uint64
	CommentCount   uint64
	ShowClientInfo bool `gorm:"default:false"` // 是否显示客户端信息

	// 附件的文件 ID，按展示顺序保存；文件被删除后不再展示
	AttachmentIDs FileIDs `gorm:"type:text"`
	// 正文里被 @ 的用户 ID（去重、最多 3 个）。正文只存 @用户名 这样的纯文本，通知用这里的 ID，用户改名不影响已发出的通知
	MentionUserIDs UintIDs `gorm:"type:text"`
}

type CommentLocation struct {
	Country   string
	Province  string
	City      string
	Districts string
	ISP       string
	IDC       string
}

// UintIDs 以 JSON 文本存储的 uint 列表（附件文件、被 @ 的用户等）；为空时存 NULL
type UintIDs []uint

// FileIDs 附件的文件 ID 列表，按展示顺序保存
type FileIDs = UintIDs

func (f UintIDs) Value() (driver.Value, error) {
	if len(f) == 0 {
		return nil, nil
	}
	b, err := json.Marshal([]uint(f))
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (f *UintIDs) Scan(src any) error {
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
		return fmt.Errorf("cannot scan FileIDs from %T", src)
	}
	if len(data) == 0 {
		*f = nil
		return nil
	}
	return json.Unmarshal(data, f)
}
