package apiv1

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// bearerTransport 为每个请求附加 Authorization 头
type bearerTransport struct{ token string }

func (b bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(req)
}

// startServer 在随机端口启动与生产相同配置（流式请求体）的 Hertz 服务，只注册 MCP 路由
func startServer(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	h := server.New(server.WithHostPorts(addr), server.WithStreamBody(true), server.WithExitWaitTime(0))
	registerMCPRoutes(h.Group("/api/v1"))
	go func() { _ = h.Run() }()
	t.Cleanup(func() { _ = h.Shutdown(context.Background()) })
	for range 50 {
		if conn, err := net.Dial("tcp", addr); err == nil {
			_ = conn.Close()
			return "http://" + addr + "/api/v1/mcp"
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("server did not start")
	return ""
}

// 经由 Hertz 路由、Token 中间件与 net/http 适配器，用官方客户端访问 MCP，验证鉴权与身份能传到工具
func TestMCPEndpoint(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	editor := &model.User{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(editor)
	token, svcerr := service.NewAPITokenService().Create(context.WithValue(context.Background(), "user_id", editor.ID),
		&dto.CreateAPITokenReq{Name: "agent", Scopes: []string{constant.ScopePostsRead, constant.ScopePostsWrite}})
	if svcerr != nil {
		t.Fatalf("create token: %v", svcerr)
	}
	endpoint := startServer(t)

	// 没有或错误的 Token 一律 401，浏览器 Cookie 不被接受
	for _, header := range []string{"", "Bearer nbp_invalid", "Bearer not-a-token"} {
		req, _ := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Cookie", "token=anything")
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("WWW-Authenticate") == "" {
			t.Fatalf("auth %q: want 401 with WWW-Authenticate, got %d", header, resp.StatusCode)
		}
	}

	ctx := context.Background()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:             endpoint,
		HTTPClient:           &http.Client{Transport: bearerTransport{token.Token}},
		DisableStandaloneSSE: true,
		MaxRetries:           -1,
	}, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer session.Close()

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	names := make([]string, 0, len(tools.Tools))
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
		if tool.Description == "" || tool.InputSchema == nil {
			t.Errorf("tool %s needs a description and input schema", tool.Name)
		}
	}
	slices.Sort(names)
	if got := strings.Join(names, ","); got != "create_post,get_post,get_writing_guide,list_posts,list_taxonomy,publish_post,unpublish_post,update_post,upload_image" {
		t.Fatalf("tools: %s", got)
	}

	// 工具从上下文拿到 Token 身份：创建的文章属于 Token 所属用户
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "create_post", Arguments: map[string]any{"title": "From MCP", "content": "hi"}})
	if err != nil || result.IsError {
		t.Fatalf("create_post: %v %s", err, contentText(result))
	}
	var post model.Post
	if err := repo.GetDB().Where("title = ?", "From MCP").First(&post).Error; err != nil || post.UserID != editor.ID {
		t.Fatalf("post owner: %v %+v", err, post)
	}

	// 缺少权限范围时返回可读的工具错误，而不是协议错误
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "publish_post", Arguments: map[string]any{"post_id": post.ID}})
	if err != nil || !result.IsError || !strings.Contains(contentText(result), constant.ScopePostsPublish) {
		t.Fatalf("publish without scope should be a tool error: %v %s", err, contentText(result))
	}
	// 参数不符合 schema 时同样返回错误
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "get_post", Arguments: map[string]any{"post": fmt.Sprint(post.ID), "content_format": "docx"}})
	if err == nil && !result.IsError {
		t.Fatalf("invalid enum should be rejected")
	}
}

func contentText(result *mcp.CallToolResult) string {
	if result == nil {
		return ""
	}
	var parts []string
	for _, c := range result.Content {
		if text, ok := c.(*mcp.TextContent); ok {
			parts = append(parts, text.Text)
		}
	}
	return strings.Join(parts, "\n")
}
