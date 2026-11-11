package migrations

import (
	"bytes"
	"encoding/json"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// lyricAnnotation2026111120 迁移时的歌词标注表快照，只含用到的列
type lyricAnnotation2026111120 struct {
	ID      uint
	Data    string
	Phrases int `gorm:"not null;default:0"`
}

func (lyricAnnotation2026111120) TableName() string { return "lyric_annotations" }

// lyricAnnotationPhrasesBatch 回填时每批读取的记录数（Data 是大字段，不一次读出全部）
const lyricAnnotationPhrasesBatch = 200

// lyricAnnotationPhrases 歌词标注新增短语数列 phrases（后台歌词特效列表只读短列、不再读 Data），并按已有的 Data 回填：
// 新版 Data 为对象（lines 在其中），更早的为 lines 数组；无法解析的记为 0（读取时同样没有短语）
func lyricAnnotationPhrases() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111120_lyric_annotation_phrases",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&lyricAnnotation2026111120{}) {
				return nil
			}
			if !tx.Migrator().HasColumn(&lyricAnnotation2026111120{}, "phrases") {
				if err := tx.Migrator().AddColumn(&lyricAnnotation2026111120{}, "Phrases"); err != nil {
					return err
				}
			}
			var lastID uint
			for {
				var records []lyricAnnotation2026111120
				if err := tx.Select("id, data").Where("id > ?", lastID).Order("id").Limit(lyricAnnotationPhrasesBatch).Find(&records).Error; err != nil {
					return err
				}
				for _, record := range records {
					if count := countLyricAnnotationPhrases(record.Data); count > 0 {
						if err := tx.Model(&lyricAnnotation2026111120{}).Where("id = ?", record.ID).UpdateColumn("phrases", count).Error; err != nil {
							return err
						}
					}
				}
				if len(records) < lyricAnnotationPhrasesBatch {
					return nil
				}
				lastID = records[len(records)-1].ID
			}
		},
	}
}

// countLyricAnnotationPhrases 标注数据中各行短语的总数
func countLyricAnnotationPhrases(raw string) int {
	type line struct {
		Phrases []json.RawMessage `json:"phrases"`
	}
	var lines []line
	trimmed := bytes.TrimSpace([]byte(raw))
	if len(trimmed) > 0 && trimmed[0] == '[' {
		if json.Unmarshal(trimmed, &lines) != nil {
			return 0
		}
	} else {
		var object struct {
			Lines []line `json:"lines"`
		}
		if json.Unmarshal(trimmed, &object) != nil {
			return 0
		}
		lines = object.Lines
	}
	count := 0
	for _, l := range lines {
		count += len(l.Phrases)
	}
	return count
}
