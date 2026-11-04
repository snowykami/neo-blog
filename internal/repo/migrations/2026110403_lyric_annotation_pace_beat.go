package migrations

import (
	"bytes"
	"encoding/json"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// lyricAnnotation2026110403 迁移时的歌词标注表快照，只含用到的列
type lyricAnnotation2026110403 struct {
	ID       uint
	Data     string
	EditedAt *time.Time
}

func (lyricAnnotation2026110403) TableName() string { return "lyric_annotations" }

// lyricAnnotationPaceBeat 全曲特效节奏的默认值由 medium 改为 beat（跟随音乐节拍），空值的含义随之改变：
//   - 管理员编辑过、全曲节奏为空（当时即 medium）的，写成 "medium"，保留管理员的选择
//   - 模型生成的，去掉模型按「轻快程度」给出的全曲节奏，改为跟随节拍
//
// 短语的节奏不变（为空本来就是沿用全曲）
func lyricAnnotationPaceBeat() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110403_lyric_annotation_pace_beat",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&lyricAnnotation2026110403{}) {
				return nil
			}
			var records []lyricAnnotation2026110403
			if err := tx.Select("id, data, edited_at").Find(&records).Error; err != nil {
				return err
			}
			for _, record := range records {
				data, changed, err := migrateLyricAnnotationPace(record.Data, record.EditedAt != nil)
				if err != nil || !changed {
					// 无法解析的旧数据保持原样（读取时同样会被忽略）
					continue
				}
				if err := tx.Model(&lyricAnnotation2026110403{}).Where("id = ?", record.ID).UpdateColumn("data", data).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}

// migrateLyricAnnotationPace 返回迁移后的数据与是否有改动；更早的记录只有 lines 数组，编辑过的转成对象再写入节奏
func migrateLyricAnnotationPace(raw string, edited bool) (string, bool, error) {
	trimmed := bytes.TrimSpace([]byte(raw))
	if len(trimmed) > 0 && trimmed[0] == '[' {
		if !edited {
			return raw, false, nil
		}
		data, err := json.Marshal(map[string]json.RawMessage{"lines": trimmed, "pace": json.RawMessage(`"medium"`)})
		return string(data), err == nil, err
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &object); err != nil {
		return raw, false, err
	}
	var pace string
	if value, ok := object["pace"]; ok {
		_ = json.Unmarshal(value, &pace)
	}
	switch {
	case edited && pace == "":
		object["pace"] = json.RawMessage(`"medium"`)
	case !edited && pace != "":
		delete(object, "pace")
	default:
		return raw, false, nil
	}
	data, err := json.Marshal(object)
	return string(data), err == nil, err
}
