package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
)

type aiPromptRepo struct{}

var AIPrompt = &aiPromptRepo{}

// ListVisible 平台指令与指定用户的个人指令；平台指令在前，同组按创建顺序
func (r *aiPromptRepo) ListVisible(userID uint) ([]model.AIPrompt, error) {
	var prompts []model.AIPrompt
	err := GetDB().
		Where("scope = ? OR (scope = ? AND user_id = ?)", model.AIPromptScopePlatform, model.AIPromptScopeUser, userID).
		Order("CASE WHEN scope = 'platform' THEN 0 ELSE 1 END, id ASC").
		Find(&prompts).Error
	return prompts, err
}

func (r *aiPromptRepo) Get(id uint) (*model.AIPrompt, error) {
	var prompt model.AIPrompt
	err := GetDB().First(&prompt, id).Error
	return &prompt, err
}

func (r *aiPromptRepo) Create(prompt *model.AIPrompt) error {
	return GetDB().Create(prompt).Error
}

func (r *aiPromptRepo) Save(prompt *model.AIPrompt) error {
	return GetDB().Save(prompt).Error
}

func (r *aiPromptRepo) Delete(id uint) error {
	return GetDB().Delete(&model.AIPrompt{}, id).Error
}

// seedDefaultAIPrompts 首次启动（表中没有任何指令，含已删除的）时写入默认平台指令；管理员删除后不会再次写入
func seedDefaultAIPrompts() error {
	var count int64
	if err := GetDB().Unscoped().Model(&model.AIPrompt{}).Count(&count).Error; err != nil || count > 0 {
		return err
	}
	prompts := make([]model.AIPrompt, len(model.DefaultAIPrompts))
	for i, p := range model.DefaultAIPrompts {
		p.Scope = model.AIPromptScopePlatform
		prompts[i] = p
	}
	return GetDB().Create(&prompts).Error
}
