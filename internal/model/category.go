package model

import "github.com/snowykami/neo-blog/internal/dto"

type Category struct {
	ID          uint   `gorm:"primaryKey"`
	Name        string `gorm:"type:text;not null;uniqueIndex"`
	Description string `gorm:"type:text"`
	Slug        string `gorm:"type:text;not null;uniqueIndex"`
	Posts       []Post `gorm:"foreignKey:CategoryID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
}

// ToDto 转换为 DTO 不带文章关联
func (c *Category) ToDto() *dto.CategoryDto {
	return &dto.CategoryDto{
		ID:          c.ID,
		Name:        c.Name,
		Description: c.Description,
		Slug:        c.Slug,
	}
}
