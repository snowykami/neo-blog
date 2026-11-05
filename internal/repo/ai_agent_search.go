package repo

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/model"
)

// likeEscaper 转义 LIKE 模式中的通配符，关键词按字面匹配
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// SearchAgents 查找用户名、昵称或性格档案（原型、人设等）中包含任一关键词的 AI 用户，不区分大小写，按创建顺序
func (r *aiAgentRepo) SearchAgents(keywords []string, limit int) ([]model.AIAgent, error) {
	db := GetDB().Model(&model.AIAgent{}).Joins("JOIN users ON users.id = ai_agents.user_id AND users.deleted_at IS NULL")
	conds := make([]string, 0, len(keywords))
	args := make([]any, 0, len(keywords)*3)
	for _, keyword := range keywords {
		like := "%" + likeEscaper.Replace(strings.ToLower(keyword)) + "%"
		conds = append(conds, `LOWER(users.username) LIKE ? ESCAPE '\' OR LOWER(users.nickname) LIKE ? ESCAPE '\' OR LOWER(ai_agents.profile) LIKE ? ESCAPE '\'`)
		args = append(args, like, like, like)
	}
	var agents []model.AIAgent
	if len(conds) == 0 {
		return agents, nil
	}
	err := db.Where("("+strings.Join(conds, ") OR (")+")", args...).Preload("User").Order("ai_agents.id ASC").Limit(limit).Find(&agents).Error
	return agents, err
}
