package mcpserver

import (
	"context"
	"errors"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/service"
)

// getWritingGuide 写作指南：站点写作风格、编辑器支持的格式与可用组件，以纯文本返回便于模型阅读
func getWritingGuide(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	if _, ok := ctxutils.GetAPIToken(ctx); !ok {
		return nil, nil, errors.New("this endpoint only accepts personal API tokens (Authorization: Bearer nbp_...)")
	}
	guide := service.BuildAgentWritingGuide(components.guide())
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: guide}}}, nil, nil
}

func registerGuideTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "get_writing_guide",
		Description: "Get this site's writing guide: the owner's writing style, the Markdown and inline formats the editor supports, " +
			"and the custom components you can insert (```component:name fenced blocks with their props JSON Schema). Call it once before writing or editing post content.",
		Annotations: &mcp.ToolAnnotations{Title: "Get writing guide", ReadOnlyHint: true, OpenWorldHint: boolPtr(false)},
	}, getWritingGuide)
}
