package mcpserver

import (
	"context"
	"encoding/base64"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

type testEnv struct {
	author, other *model.User
	authorCtx     context.Context // 浏览器会话登录的作者
}

// setupTest 使用临时 SQLite 数据库，创建作者与另一位编辑者，并把默认存储指向临时目录
func setupTest(t *testing.T) *testEnv {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	env := &testEnv{
		author: &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor},
		other:  &model.User{Username: "other", Email: "other@test.local", Role: constant.RoleEditor},
	}
	for _, u := range []*model.User{env.author, env.other} {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	env.authorCtx = context.WithValue(context.Background(), "user_id", env.author.ID)
	provider, err := local.NewLocalStorageProvider(model.StorageProviderModelAndDto{ID: 1, Name: "test", Type: "local", IsDefault: true,
		StorageProviderConfig: model.StorageProviderConfig{BaseDir: t.TempDir()}})
	if err != nil {
		t.Fatalf("storage provider: %v", err)
	}
	storage.ReplaceStorageProviders(map[uint]storageprovider.StorageProvider{1: provider})
	return env
}

// tokenCtx 为用户创建指定权限范围的 Token，返回经 Token 认证后的上下文（与 middleware 写入的一致）
func tokenCtx(t *testing.T, u *model.User, scopes ...string) context.Context {
	t.Helper()
	resp, svcerr := service.NewAPITokenService().Create(context.WithValue(context.Background(), "user_id", u.ID), &dto.CreateAPITokenReq{Name: "agent", Scopes: scopes})
	if svcerr != nil {
		t.Fatalf("create token: %v", svcerr)
	}
	userID, info, svcerr := service.NewAPITokenService().Authenticate(resp.Token)
	if svcerr != nil {
		t.Fatalf("authenticate: %v", svcerr)
	}
	return ctxutils.WithAPIToken(ctxutils.WithUserCache(context.WithValue(context.Background(), "user_id", userID)), info)
}

func reload(t *testing.T, id uint) *model.Post {
	t.Helper()
	post := &model.Post{}
	if err := repo.GetDB().First(post, id).Error; err != nil {
		t.Fatalf("reload post: %v", err)
	}
	return post
}

func wantErr(t *testing.T, err error, contains string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), contains) {
		t.Fatalf("want error containing %q, got %v", contains, err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestContentConversion(t *testing.T) {
	html, err := parseContent("# Title\n\nHello **world**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```go\nfmt.Println(1)\n```", formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"<h1>Title</h1>", "<strong>world</strong>", "<table>", `<code class="language-go">`} {
		if !strings.Contains(html, want) {
			t.Errorf("html missing %q:\n%s", want, html)
		}
	}
	md, err := renderContent(html, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"# Title", "**world**", "| a | b |", "```go"} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown missing %q:\n%s", want, md)
		}
	}

	// 站内组件块在 Markdown 往返后保持不变
	component := `<div data-component="callout" data-props="{&#34;type&#34;:&#34;info&#34;}" data-version="1"><p>fallback</p><p>second</p></div>`
	md, err = renderContent("<p>before</p>"+component+"<p>after</p>", formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	back, err := parseContent(md, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(back, `data-component="callout"`) || !strings.Contains(back, "<p>fallback</p>") || !strings.Contains(back, "<p>after</p>") {
		t.Fatalf("component lost in round trip:\nmd=%s\nhtml=%s", md, back)
	}

	if got, _ := parseContent("", formatMarkdown); got != emptyContentHTML {
		t.Fatalf("empty content should become an empty paragraph, got %q", got)
	}
	if _, err := normalizeFormat("docx"); err == nil {
		t.Fatal("unknown format must be rejected")
	}
}

// 完整流程：创建草稿 → 读取 → 改草稿 → 发布 → 取消发布，权限范围逐项生效
func TestPostToolsFlow(t *testing.T) {
	env := setupTest(t)
	readOnly := tokenCtx(t, env.author, constant.ScopePostsRead)
	writer := tokenCtx(t, env.author, constant.ScopePostsRead, constant.ScopePostsWrite)
	publisher := tokenCtx(t, env.author, constant.ScopePostsRead, constant.ScopePostsWrite, constant.ScopePostsPublish)

	_, _, err := createPost(readOnly, nil, createPostInput{Title: "x"})
	wantErr(t, err, constant.ScopePostsWrite)

	_, created, err := createPost(writer, nil, createPostInput{Title: "Hello", Content: "First **draft**", Description: ptr("desc")})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	post := reload(t, created.ID)
	if !post.IsPrivate || post.Content != "" || post.DraftContent == nil || !strings.Contains(*post.DraftContent, "<strong>draft</strong>") || post.UserID != env.author.ID {
		t.Fatalf("new post should be a private draft: %+v", post)
	}

	_, detail, err := getPost(readOnly, nil, getPostInput{Post: "Hello"})
	if err == nil {
		t.Fatalf("slug was not set, lookup by title must fail: %+v", detail)
	}
	_, detail, err = getPost(readOnly, nil, getPostInput{Post: "1"})
	if err != nil || detail.Version != versionDraft || !strings.Contains(detail.Content, "First **draft**") || !detail.HasUnpublishedChanges {
		t.Fatalf("get draft: %v %+v", err, detail)
	}

	// 私密文章上改元信息只需要 posts:write
	if _, _, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, Title: ptr("Hello 2"), Content: ptr("Second")}); err != nil {
		t.Fatalf("update private post: %v", err)
	}
	_, _, err = publishPost(writer, nil, postIDInput{PostID: created.ID})
	wantErr(t, err, constant.ScopePostsPublish)

	if _, out, err := publishPost(publisher, nil, postIDInput{PostID: created.ID}); err != nil || out.IsPrivate {
		t.Fatalf("publish: %v %+v", err, out)
	}
	post = reload(t, created.ID)
	if post.IsPrivate || post.Title != "Hello 2" || !strings.Contains(post.Content, "Second") {
		t.Fatalf("published post: %+v", post)
	}

	// 公开文章：正文只写草稿，读者看到的内容不变；元信息需要 posts:publish
	if _, _, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, Content: ptr("Third")}); err != nil {
		t.Fatalf("update draft: %v", err)
	}
	post = reload(t, created.ID)
	if !strings.Contains(post.Content, "Second") || !strings.Contains(*post.DraftContent, "Third") {
		t.Fatalf("draft write must not change the published body: %+v", post)
	}
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, Title: ptr("Live title")})
	wantErr(t, err, "is public")
	if _, _, err := updatePost(publisher, nil, updatePostInput{PostID: created.ID, LabelIDs: []uint{}}); err != nil {
		t.Fatalf("publisher metadata update: %v", err)
	}
	_, published, _ := getPost(readOnly, nil, getPostInput{Post: "1", Version: versionPublished})
	if !strings.Contains(published.Content, "Second") {
		t.Fatalf("published version: %+v", published)
	}

	// 其他编辑者的 Token 不能改作者的文章
	otherWriter := tokenCtx(t, env.other, constant.ScopePostsRead, constant.ScopePostsWrite, constant.ScopePostsPublish)
	_, _, err = updatePost(otherWriter, nil, updatePostInput{PostID: created.ID, Content: ptr("hijack")})
	wantErr(t, err, "permission_denied")
	// 其他人看不到草稿
	if _, d, _ := getPost(otherWriter, nil, getPostInput{Post: "1"}); d.Version != versionPublished || d.PreviewURL != "" {
		t.Fatalf("other user must not see the draft: %+v", d)
	}

	// 作者在编辑页打开文章后，AI 的写入被拒绝，正文不变
	if _, svcerr := service.NewEditSessionService().Acquire(env.authorCtx, constant.TargetTypePost, created.ID, "browser"); svcerr != nil {
		t.Fatalf("human acquire: %v", svcerr)
	}
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, Content: ptr("clobber")})
	wantErr(t, err, "edit_session_in_use")
	_, _, err = unpublishPost(publisher, nil, postIDInput{PostID: created.ID})
	wantErr(t, err, "edit_session_in_use")
	if post := reload(t, created.ID); strings.Contains(*post.DraftContent, "clobber") || post.IsPrivate {
		t.Fatalf("locked post was modified: %+v", post)
	}

	_, list, err := listPosts(readOnly, nil, listPostsInput{Mine: true})
	if err != nil || list.Total != 1 || list.Posts[0].ID != created.ID {
		t.Fatalf("list mine: %v %+v", err, list)
	}
	_, _, err = listPosts(readOnly, nil, listPostsInput{OrderBy: "password"})
	wantErr(t, err, "order_by")
}

func TestUploadImage(t *testing.T) {
	env := setupTest(t)
	reader := tokenCtx(t, env.author, constant.ScopePostsRead)
	uploader := tokenCtx(t, env.author, constant.ScopeFilesWrite)
	// 1x1 PNG
	png := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

	_, _, err := uploadImage(reader, nil, uploadImageInput{Filename: "a.png", DataBase64: png})
	wantErr(t, err, constant.ScopeFilesWrite)
	_, _, err = uploadImage(uploader, nil, uploadImageInput{Filename: "a.svg", DataBase64: base64.StdEncoding.EncodeToString([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))})
	wantErr(t, err, "unsupported image type")
	_, _, err = uploadImage(uploader, nil, uploadImageInput{Filename: "a.png", DataBase64: "%%%"})
	wantErr(t, err, "base64")

	_, out, err := uploadImage(uploader, nil, uploadImageInput{Filename: "../dir/dot.png", DataBase64: "data:image/png;base64," + png})
	if err != nil || out.ID == 0 || out.URL == "" || !strings.HasPrefix(out.Markdown, "![dot](") {
		t.Fatalf("upload: %v %+v", err, out)
	}
	file := &model.File{}
	repo.GetDB().First(file, out.ID)
	if file.Name != "dot.png" || file.MimeType != "image/png" || file.UserID != env.author.ID {
		t.Fatalf("file record: %+v", file)
	}
}

func TestRequireScopeWithoutToken(t *testing.T) {
	env := setupTest(t)
	// 浏览器会话（没有 API Token）不能直接调用工具
	_, _, err := listPosts(env.authorCtx, nil, listPostsInput{})
	wantErr(t, err, "personal API tokens")
}

const calloutFence = "```component:callout\n{\"type\":\"tip\",\"title\":\"注意\",\"content\":\"**不是** Markdown & <b>纯文本</b>\\n\\n第二段\",\"extra\":1}\n```"

// 组件代码块与组件块双向转换：写入时校验并补默认值，读取时还原为同样的写法
func TestComponentFences(t *testing.T) {
	html, err := parseContent("前文\n\n"+calloutFence+"\n\n```component:codeTabs\n{\"tabs\":[{\"label\":\"Go\",\"code\":\"fmt.Println(1)\"}]}\n```\n\n后文", formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`data-component="callout"`, `data-version="1"`,
		`<p>**不是** Markdown &amp; &lt;b&gt;纯文本&lt;/b&gt;</p><p>第二段</p>`, // 降级内容为纯文本段落
		`data-component="codeTabs"`, `&#34;language&#34;:&#34;&#34;`, // 补全默认值
		`\u003cb\u003e`, // props 中的 < > 转义，与前端 serializePropsAttr 一致
	} {
		if !strings.Contains(html, want) {
			t.Errorf("html missing %q:\n%s", want, html)
		}
	}
	if strings.Contains(html, "extra") || strings.Contains(html, "<pre>") {
		t.Fatalf("unknown props must be dropped and fences replaced:\n%s", html)
	}

	md, err := renderContent(html, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(md, "```component:callout\n{") || !strings.Contains(md, "```component:codeTabs\n{") {
		t.Fatalf("components should read back as fences:\n%s", md)
	}
	again, err := parseContent(md, formatMarkdown)
	if err != nil || again != html {
		t.Fatalf("round trip changed content: %v\nfirst:  %s\nsecond: %s", err, html, again)
	}

	// 不对 AI 开放的组件、带自定义布局或 props 不合法的组件保留原始 HTML
	for _, raw := range []string{
		`<div data-component="neteaseSong" data-props="{&#34;id&#34;:1}" data-version="1"></div>`,
		`<div data-component="callout" data-props="{&#34;content&#34;:&#34;x&#34;}" data-version="1" data-align="center"></div>`,
		`<div data-component="callout" data-props="{&#34;type&#34;:&#34;info&#34;}" data-version="1"></div>`,
		`<div data-component="callout" data-props="{&#34;content&#34;:&#34;x&#34;}" data-version="2"></div>`,
	} {
		md, _ := renderContent(raw, formatMarkdown)
		if !strings.Contains(md, "<div data-component=") {
			t.Errorf("should keep raw HTML for %s, got %s", raw, md)
		}
	}
}

func TestComponentFenceErrors(t *testing.T) {
	cases := map[string]string{
		"```component:neteaseSong\n{\"id\":1}\n```":                          "unknown component",
		"```component:callout\n{\"type\":\"danger\",\"content\":\"x\"}\n```": "callout",
		"```component:callout\n{\"title\":\"no content\"}\n```":              "callout",
		"```component:callout\nnot json\n```":                                "JSON object",
	}
	for input, want := range cases {
		if _, err := parseContent("text\n\n"+input, formatMarkdown); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: want error containing %q, got %v", input, want, err)
		}
	}
	// html 格式不做转换
	if got, err := parseContent("<pre><code class=\"language-component:x\">{}</code></pre>", formatHTML); err != nil || !strings.Contains(got, "<pre>") {
		t.Fatalf("html format must be stored as-is: %v %s", err, got)
	}
}

func TestWritingGuide(t *testing.T) {
	env := setupTest(t)
	reader := tokenCtx(t, env.author, constant.ScopePostsRead)
	if err := repo.KV.SetKV("ai_writing_style", "多用短句，结尾总结要点。"); err != nil {
		t.Fatal(err)
	}
	result, _, err := getWritingGuide(reader, nil, struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	guide := result.Content[0].(*mcp.TextContent).Text
	for _, want := range []string{"## 站点写作风格", "多用短句", "## 平台格式", "data-annotation", "```component:callout", "- codeTabs：", "props："} {
		if !strings.Contains(guide, want) {
			t.Errorf("guide missing %q", want)
		}
	}
	if _, _, err := getWritingGuide(env.authorCtx, nil, struct{}{}); err == nil {
		t.Fatal("browser session must not call tools")
	}
}

// 编辑器的行内格式与带对齐的段落在 Markdown 往返后保持不变，文字中的 Markdown 符号不被误解析
func TestInlineFormatsRoundTrip(t *testing.T) {
	stored := `<p>术语 <span data-annotation="Model Context Protocol">MCP</span> 和 <mark data-color="var(--color-yellow-200)">重*点*_x_</mark>，<u>下划线</u>，H<sub>2</sub>O，x<sup>2</sup>，<span style="color: var(--color-red-500)">红字</span></p>` +
		`<p style="text-align: center">居中 *不是斜体*</p><p>普通 <strong>粗体</strong></p>`
	md, err := renderContent(stored, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	back, err := parseContent(md, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<span data-annotation="Model Context Protocol">MCP</span>`,
		`<mark data-color="var(--color-yellow-200)">重*点*_x_</mark>`,
		`<u>下划线</u>`, `H<sub>2</sub>O`, `x<sup>2</sup>`,
		`<span style="color: var(--color-red-500)">红字</span>`,
		`<p style="text-align: center">居中 *不是斜体*</p>`,
		`<strong>粗体</strong>`,
	} {
		if !strings.Contains(back, want) {
			t.Errorf("lost %q\nmarkdown:\n%s\nhtml:\n%s", want, md, back)
		}
	}
}
