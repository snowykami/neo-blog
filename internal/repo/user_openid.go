package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func (user *userRepo) CreateOrUpdateUserOpenID(userOpenID *model.UserOpenID) error {
	if err := GetDB().Save(userOpenID).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) GetUserOpenIDByID(id uint) (*model.UserOpenID, error) {
	if id == 0 {
		return nil, errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	var userOpenID model.UserOpenID
	if err := GetDB().Preload("User").Where("id = ?", id).First(&userOpenID).Error; err != nil {
		return nil, err
	}
	return &userOpenID, nil
}

func (user *userRepo) GetUserOpenIDByIssuerAndSub(issuer, sub string) (*model.UserOpenID, error) {
	if issuer == "" || sub == "" {
		return nil, errs.NewBadRequest("invalid_credentials")
	}
	var userOpenID model.UserOpenID
	if err := GetDB().Preload("User").Where("issuer = ? AND sub = ?", issuer, sub).First(&userOpenID).Error; err != nil {
		return nil, err
	}
	return &userOpenID, nil
}

func (user *userRepo) DeleteUserOpenID(id uint) error {
	if err := GetDB().Unscoped().Where("id = ?", id).Delete(&model.UserOpenID{}).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) UpdateUserOpenID(userOpenID *model.UserOpenID) error {
	if userOpenID.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	if err := GetDB().Updates(userOpenID).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) ListUserOpenIDsByUserID(userID uint) ([]model.UserOpenID, error) {
	var userOpenIDs []model.UserOpenID
	if err := GetDB().Where("user_id = ?", userID).Find(&userOpenIDs).Error; err != nil {
		return nil, err
	}
	return userOpenIDs, nil
}
