// Package mcpserver 远程 MCP 服务：让外部 AI 工具（Claude Code、Claude Desktop、Cursor 等）通过个人 API Token 读写文章，管理员还可以管理 AI 用户
// 与 controller 同层：工具直接调用 service，复用其中的权限判断；鉴权由 middleware.UseAPIToken 完成
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/sirupsen/logrus"
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

Before writing or editing post content, call get_writing_guide once: it has the site owner's writing style, the token owner's own voice habits, the formats the editor supports, and the custom components (callouts, code tabs, collapsibles, ...) you can insert.

How posts work:
- Post bodies are stored as HTML produced by a rich-text editor. Tools read and write Markdown by default; pass content_format "html" to work with the raw HTML instead. Components you may write appear as fenced code blocks whose language is component:<name>, holding one line of props JSON; other site components appear as raw HTML and must be kept as-is. Inline formats such as annotations, highlights and colors are written as small HTML tags (see the guide).
- Every content write goes to an unpublished draft. Readers only see the published version. Call publish_post to make the draft live.
- People may be editing the same post in the web console editor while you work. Your writes are not blocked: they show up in their editor live and are merged with their edits. To keep that merge clean, change only what you need: prefer update_post with edit_mode "patch" (find_text copied verbatim from get_post), or "append" / "prepend". Rewriting the whole body (edit_mode "replace") needs the draft_version from get_post as base_version.
- If the draft changed after you read it, a write based on the old version is refused with draft_conflict and nothing is saved. Call get_post again and redo your change on the latest content; do not retry blindly.
- Metadata (title, description, slug, cover, category, labels) has no draft. On a public post those changes are visible immediately, so they need the posts:publish scope.
- There is no delete tool. Every write is recorded in the post's version history and can be rolled back from the console.

Typical flow: get_writing_guide -> list_posts or get_post -> update_post (draft, preferably edit_mode "patch") -> show the user the preview_url -> publish_post when the user agrees.

AI users (admin only, scopes ai_agents:read and ai_agents:write): accounts whose comments and likes are driven by the site's AI model, each with a personality profile. They pair with the neo-blog-persona-distill skill, which "distills" a real person or a fictional character into an import file. Before importing, call find_ai_users with every name the person is known by: if an AI user for the same person already exists (even under another username), read it with get_ai_user, merge the new findings into it, and import under its existing username so it is updated instead of duplicated. Ask the user when a match is uncertain. Then import_ai_users with dry_run, show the user the result, import for real, and optionally dry_run_ai_user on a post to check how it would comment.`

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
	registerAIAgentTools(server)
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
	"login_required":           "authentication required",
	"permission_denied":        "permission denied: only the author of a post or an admin can do this",
	"target_not_found":         "not found",
	"draft_conflict":           "the draft changed after you read it (someone edited it in the console editor or with another tool), so nothing was written. Call get_post again and redo your change on the latest content and draft_version",
	"slug_already_exists":      "another post already uses this slug",
	"slug_cannot_be_numeric":   "slug cannot be purely numeric",
	"category_not_found":       "category_id does not exist; call list_taxonomy to see valid ids",
	"failed_to_get_target":     "server error while reading data",
	"failed_to_update_target":  "server error while saving",
	"failed_to_create_target":  "server error while creating",
	"ai_agent_username_taken":  "this username belongs to a regular (non-AI) user; pick another username",
	"invalid_ai_agent_profile": "the profile has an invalid field type or value; run skills/neo-blog-persona-distill/scripts/validate_agent_file.py on the file",
	"invalid_ai_agent_tier":    "tier must be ambient or expert",
	"invalid_timezone":         "activity.timezone must be an IANA time zone such as Asia/Shanghai",
	"invalid_active_hours":     "activity.active_hours must look like 9-12,20-24",
	"invalid_preferred_color":  "preferred_color is not one of the site's color schemes",
	"invalid_ai_agent_count":   "pass 1 to 200 AI users",
	"invalid_username":         "username must be 1-20 characters without spaces, / or @",
	"invalid_nickname":         "nickname must be at most 20 characters",
}

// serviceError 将 service 层错误转为工具错误（以 isError 结果返回给模型，而不是协议错误）。
// 与 HTTP 接口一致只返回错误码与出错的资源 / 字段，原始错误（数据库等内部信息）只写日志
func serviceError(e *errs.ServiceError) error {
	msg := e.Message
	if hint, ok := errorHints[e.Message]; ok {
		msg = hint + " [" + e.Message + "]"
	}
	if e.Resource != "" {
		msg += " (resource: " + e.Resource + ")"
	}
	if e.Field != "" {
		msg += fmt.Sprintf(" (field: %s = %v)", e.Field, e.Value)
	}
	if e.Detail != "" {
		msg += ": " + e.Detail
	}
	if e.Err != nil {
		logrus.WithError(e.Err).Warn("mcp tool error: " + e.Message)
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
