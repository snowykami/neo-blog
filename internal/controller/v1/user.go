package v1

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
)

type userType struct{}

var User = new(userType)

func (u *userType) Login(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Register(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Logout(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) OidcList(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) OidcLogin(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Get(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Update(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Delete(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}
