package service

import (
	"errors"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

type UserService interface {
	UserLogin(dto *dto.UserLoginReq) (*dto.UserLoginResp, error)
	UserRegister(dto *dto.UserRegisterReq) (*dto.UserRegisterResp, error)
}

type userService struct{}

func NewUserService() UserService {
	return &userService{}
}

func (s *userService) UserLogin(dto *dto.UserLoginReq) (*dto.UserLoginResp, error) {
	user, err := repo.User.GetByUsernameOrEmail(dto.Username)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, errors.New(resps.ErrNotFound)
	}
	utils.Password.VerifyPassword(dto.Password, user.Password, utils.Env.Get(constant.EnvVarPasswordSalt, "default_salt"))
}
