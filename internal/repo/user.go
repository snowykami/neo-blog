package repo

import "github.com/snowykami/neo-blog/internal/model"

type userRepo struct{}

var User = &userRepo{}

func (user *userRepo) GetUserByUsername(username string) (*model.User, error) {
	var userModel model.User
	if err := GetDB().Where("username = ?", username).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetUserByEmail(email string) (*model.User, error) {
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
	var userOpenID model.UserOpenID
	if err := GetDB().Where("issuer = ? AND sub = ?", issuer, sub).First(&userOpenID).Error; err != nil {
		return nil, err
	}
	return &userOpenID, nil
}
