package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// user2026110502 迁移时的用户表快照，只用到性别列
type user2026110502 struct {
	ID     uint `gorm:"primaryKey"`
	Gender string
}

func (user2026110502) TableName() string { return "users" }

// clearUnknownGender 性别改为「male / female / 自定义文字，空表示不填」：注册、新建用户和新建 AI 用户时写入的占位值 unknown 改为不填。
// 只处理系统写入的小写 unknown，用户自己填写的内容（包括大小写不同的 Unknown）原样保留
func clearUnknownGender() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110502_clear_unknown_gender",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&user2026110502{}) || !tx.Migrator().HasColumn(&user2026110502{}, "gender") {
				return nil
			}
			return tx.Model(&user2026110502{}).Where("gender = ?", "unknown").Update("gender", "").Error
		},
	}
}
