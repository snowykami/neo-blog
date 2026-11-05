package migrations

import (
	"encoding/json"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// aiAgent2026110503 迁移时的 AI 用户表快照，只用到性格档案（JSON 文本）
type aiAgent2026110503 struct {
	ID      uint `gorm:"primaryKey"`
	Profile string
}

func (aiAgent2026110503) TableName() string { return "ai_agents" }

const (
	expertToneBefore2026110503 = "礼貌、具体，先肯定再补充，不说教"
	expertToneAfter2026110503  = "具体、直给，像懂行的网友顺手补一句，不说教"
)

// agentExpertTone 专业型的默认语气「先肯定再补充」会让模型把每条评论写成「肯定—转折—建议」的固定三段式，AI 味很重。
// 只替换仍是旧默认值的档案，管理员改过的语气原样保留
func agentExpertTone() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110503_agent_expert_tone",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&aiAgent2026110503{}) {
				return nil
			}
			var agents []aiAgent2026110503
			if err := tx.Where("profile LIKE ?", "%先肯定再补充%").Find(&agents).Error; err != nil {
				return err
			}
			for _, agent := range agents {
				var profile map[string]json.RawMessage
				if json.Unmarshal([]byte(agent.Profile), &profile) != nil {
					continue
				}
				var tone string
				if json.Unmarshal(profile["tone"], &tone) != nil || tone != expertToneBefore2026110503 {
					continue
				}
				profile["tone"], _ = json.Marshal(expertToneAfter2026110503)
				data, err := json.Marshal(profile)
				if err != nil {
					return err
				}
				if err := tx.Model(&aiAgent2026110503{}).Where("id = ?", agent.ID).Update("profile", string(data)).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
