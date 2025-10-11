package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type userRepo struct{}

var User = &userRepo{}

func (user *userRepo) GetUserByUsername(username string) (*model.User, error) {
	if username == "" {
		return nil, errs.NewBadRequest("username_cannot_be_empty")
	}
	var userModel model.User
	if err := GetDB().Where("username = ?", username).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetUserByEmail(email string) (*model.User, error) {
	if email == "" {
		return nil, errs.NewBadRequest("email_cannot_be_empty")
	}
	var userModel model.User
	if err := GetDB().Where("email = ?", email).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetUserByID(id uint) (*model.User, error) {
	var userModel model.User
	if err := GetDB().Where("id = ?", id).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetUserByUsernameOrEmail(usernameOrEmail string) (*model.User, error) {
	if usernameOrEmail == "" {
		return nil, errs.NewBadRequest("username_cannot_be_empty")
	}
	var userModel model.User
	if err := GetDB().Where("username = ? OR email = ?", usernameOrEmail, usernameOrEmail).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) CreateUser(userModel *model.User) error {
	if err := GetDB().Create(userModel).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) UpdateUser(userModel *model.User) error {
	if err := GetDB().Updates(userModel).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) CheckUsernameExists(username string) (bool, error) {
	var count int64
	if err := GetDB().Model(&model.User{}).Where("username = ?", username).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (user *userRepo) CheckEmailExists(email string) (bool, error) {
	if email == "" {
		return false, errs.NewBadRequest("email_cannot_be_empty")
	}
	var count int64
	if err := GetDB().Model(&model.User{}).Where("email = ?", email).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (user *userRepo) CreateOrUpdateUserOpenID(userOpenID *model.UserOpenID) error {
	if err := GetDB().Save(userOpenID).Error; err != nil {
		return err
	}
	return nil
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
	if err := GetDB().Where("id = ?", id).Delete(&model.UserOpenID{}).Error; err != nil {
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
