package v1

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
)

type labelType struct{}

var Label = new(labelType)

func (l *labelType) Create(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (l *labelType) Delete(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (l *labelType) Get(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (l *labelType) Update(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (l *labelType) List(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}
