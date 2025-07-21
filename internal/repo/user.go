package repo

import "github.com/snowykami/neo-blog/internal/model"

type userRepo struct{}

var User = &userRepo{}

func (user *userRepo) GetByUsername(username string) (*model.User, error) {
	var userModel model.User
	if err := GetDB().Where("username = ?", username).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetByEmail(email string) (*model.User, error) {
	var userModel model.User
	if err := GetDB().Where("email = ?", email).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetByUsernameOrEmail(usernameOrEmail string) (*model.User, error) {
	var userModel model.User
	if err := GetDB().Where("username = ? OR email = ?", usernameOrEmail, usernameOrEmail).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) Create(userModel *model.User) error {
	if err := GetDB().Create(userModel).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) Update(userModel *model.User) error {
	if err := GetDB().Updates(userModel).Error; err != nil {
		return err
	}
	return nil
}
