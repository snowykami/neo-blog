package migrations

import (
	"encoding/json"
	"slices"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

// aiAgent2026110901 迁移时的 AI 用户表快照，只用到性格档案（JSON 文本）
type aiAgent2026110901 struct {
	ID      uint `gorm:"primaryKey"`
	Profile string
}

func (aiAgent2026110901) TableName() string { return "ai_agents" }

// agentMentionTrigger 新增「评论里被 @ 」触发方式：给已有 AI 用户的性格档案补上这个触发，
// 否则老用户升级后仍然只在被回复时才会出现。没有 triggers 字段的档案（手工写入）保持原样不动。
func agentMentionTrigger() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110901_agent_mention_trigger",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&aiAgent2026110901{}) {
				return nil
			}
			var agents []aiAgent2026110901
			if err := tx.Where("profile LIKE ?", "%triggers%").Find(&agents).Error; err != nil {
				return err
			}
			for _, agent := range agents {
				var profile map[string]json.RawMessage
				if json.Unmarshal([]byte(agent.Profile), &profile) != nil {
					continue
				}
				raw, ok := profile["triggers"]
				if !ok {
					continue
				}
				var triggers []string
				if json.Unmarshal(raw, &triggers) != nil || slices.Contains(triggers, constant.AgentTriggerCommentMentioned) {
					continue
				}
				data, err := json.Marshal(append(triggers, constant.AgentTriggerCommentMentioned))
				if err != nil {
					return err
				}
				profile["triggers"] = data
				out, err := json.Marshal(profile)
				if err != nil {
					return err
				}
				if err := tx.Model(&aiAgent2026110901{}).Where("id = ?", agent.ID).Update("profile", string(out)).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
