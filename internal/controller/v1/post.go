package v1

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
)

type postType struct{}

var Post = new(postType)

func (p *postType) Create(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *postType) Delete(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *postType) Get(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *postType) Update(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *postType) List(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}
