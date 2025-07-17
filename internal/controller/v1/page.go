package v1

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
)

type pageType struct{}

var Page = new(pageType)

func (p *pageType) Create(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *pageType) Delete(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *pageType) Get(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *pageType) Update(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *pageType) List(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}
