package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type commentTranslationRepo struct{}

var CommentTranslation = &commentTranslationRepo{}

// Get 读取评论在某种目标语言下的译文
func (r *commentTranslationRepo) Get(commentID uint, targetLang string) (*model.CommentTranslation, error) {
	var translation model.CommentTranslation
	if err := GetDB().Where("comment_id = ? AND target_lang = ?", commentID, targetLang).First(&translation).Error; err != nil {
		return nil, err
	}
	return &translation, nil
}

// ListByTarget 批量读取一组评论在指定目标语言下的译文，按评论 ID 索引
func (r *commentTranslationRepo) ListByTarget(commentIDs []uint, targetLang string) (map[uint]model.CommentTranslation, error) {
	result := make(map[uint]model.CommentTranslation)
	if len(commentIDs) == 0 || targetLang == "" {
		return result, nil
	}
	var rows []model.CommentTranslation
	if err := GetDB().Where("comment_id IN ? AND target_lang = ?", commentIDs, targetLang).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.CommentID] = row
	}
	return result, nil
}

// Save 写入译文，同一评论同一目标语言已有译文时覆盖
func (r *commentTranslationRepo) Save(translation *model.CommentTranslation) error {
	return GetDB().Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "comment_id"}, {Name: "target_lang"}},
		DoUpdates: clause.AssignmentColumns([]string{"content_md5", "source_lang", "content", "created_at"}),
	}).Create(translation).Error
}

// DeleteStale 删除评论中与当前内容 MD5 不一致的全部译文（所有语言）
func (r *commentTranslationRepo) DeleteStale(commentID uint, contentMD5 string) error {
	return deleteStaleCommentTranslations(GetDB(), commentID, contentMD5)
}

func deleteStaleCommentTranslations(tx *gorm.DB, commentID uint, contentMD5 string) error {
	return tx.Where("comment_id = ? AND content_md5 <> ?", commentID, contentMD5).Delete(&model.CommentTranslation{}).Error
}

// deleteCommentTranslations 删除评论的全部译文
func deleteCommentTranslations(tx *gorm.DB, commentIDs []uint) error {
	if len(commentIDs) == 0 {
		return nil
	}
	return tx.Where("comment_id IN ?", commentIDs).Delete(&model.CommentTranslation{}).Error
}
