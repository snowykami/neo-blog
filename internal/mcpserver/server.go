// Package mcpserver 远程 MCP 服务：让外部 AI 工具（Claude Code、Claude Desktop、Cursor 等）通过个人 API Token 读写文章
// 与 controller 同层：工具直接调用 service，复用其中的权限判断；鉴权由 middleware.UseAPIToken 完成
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/pkg/errs"
)

const (
	serverName    = "neo-blog"
	serverVersion = "1.0.0"
	// 请求体上限：上传图片以 base64 传输，10 MiB 的图片约 13.4 MiB
	maxRequestBodyBytes = 16 << 20
)

const serverInstructions = `Tools for reading, drafting and publishing posts on a neo-blog site, acting as the user who owns the API token.

Before writing or editing post content, call get_writing_guide once: it has the site owner's writing style, the formats the editor supports, and the custom components (callouts, code tabs, collapsibles, ...) you can insert.

How posts work:
- Post bodies are stored as HTML produced by a rich-text editor. Tools read and write Markdown by default; pass content_format "html" to work with the raw HTML instead. Components you may write appear as fenced code blocks whose language is component:<name>, holding one line of props JSON; other site components appear as raw HTML and must be kept as-is. Inline formats such as annotations, highlights and colors are written as small HTML tags (see the guide).
- Every content write goes to an unpublished draft. Readers only see the published version. Call publish_post to make the draft live.
- A post that is open in the web console editor is locked: writes are refused while a person is editing it. Do not retry in a loop; tell the user and ask them to close the editor first.
- Metadata (title, description, slug, cover, category, labels) has no draft. On a public post those changes are visible immediately, so they need the posts:publish scope.
- There is no delete tool. Every write is recorded in the post's version history and can be rolled back from the console.

Typical flow: get_writing_guide -> list_posts or get_post -> update_post (draft) -> show the user the preview_url -> publish_post when the user agrees.`

// NewHandler 创建 MCP 的 Streamable HTTP 处理器
// 采用无状态 + JSON 响应：每个请求独立处理，便于经过 Next.js rewrites 等反向代理转发
func NewHandler() http.Handler {
	server := newServer()
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		Stateless:           true,
		JSONResponse:        true,
		MaxRequestBodyBytes: maxRequestBodyBytes,
		// 远程服务以 Bearer Token 鉴权，不依赖 Cookie，DNS 重绑定无法借用身份；部署在本机反向代理之后时 Host 也不是 localhost
		DisableLocalhostProtection: true,
	})
}

func newServer() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Title: "neo-blog", Version: serverVersion}, &mcp.ServerOptions{
		Instructions: serverInstructions,
	})
	registerGuideTools(server)
	registerPostTools(server)
	registerFileTools(server)
	return server
}

// requireScope 检查本次请求的 API Token 是否具有指定权限范围（已与用户角色取交集）
func requireScope(ctx context.Context, scope string) error {
	if _, ok := ctxutils.GetAPIToken(ctx); !ok {
		return errors.New("this endpoint only accepts personal API tokens (Authorization: Bearer nbp_...)")
	}
	if !ctxutils.HasAPITokenScope(ctx, scope) {
		return fmt.Errorf("this API token does not have the %q scope (or the user's role does not allow it); create a token with that scope in the console", scope)
	}
	return nil
}

// errorHints 常见业务错误码的可读说明，便于 AI 理解原因并告知用户
var errorHints = map[string]string{
	"login_required":          "authentication required",
	"permission_denied":       "permission denied: only the author of a post or an admin can do this",
	"target_not_found":        "not found",
	"edit_session_in_use":     "the post is open in the console editor, so writes are locked to avoid overwriting a person's work. Ask the user to close the editor (the lock is released about 3 minutes after the editor is closed), then try again",
	"edit_session_taken_over": "someone opened the post in the console editor while you were saving; nothing was written. Ask the user before trying again",
	"slug_already_exists":     "another post already uses this slug",
	"slug_cannot_be_numeric":  "slug cannot be purely numeric",
	"category_not_found":      "category_id does not exist; call list_taxonomy to see valid ids",
	"failed_to_get_target":    "server error while reading data",
	"failed_to_update_target": "server error while saving",
	"failed_to_create_target": "server error while creating",
}

// serviceError 将 service 层错误转为工具错误（以 isError 结果返回给模型，而不是协议错误）
func serviceError(e *errs.ServiceError) error {
	msg := e.Message
	if hint, ok := errorHints[e.Message]; ok {
		msg = hint + " [" + e.Message + "]"
	}
	if e.Err != nil {
		msg += ": " + e.Err.Error()
	}
	return errors.New(msg)
}

// inputSchema 由 Go 类型推导输入 JSON Schema，并补充枚举约束
func inputSchema[T any](enums map[string][]any) *jsonschema.Schema {
	schema, err := jsonschema.For[T](nil)
	if err != nil {
		panic(err)
	}
	for name, values := range enums {
		prop, ok := schema.Properties[name]
		if !ok {
			panic("inputSchema: unknown property " + name)
		}
		prop.Enum = values
	}
	return schema
}

func boolPtr(v bool) *bool {
	return &v
}
