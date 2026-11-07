package mcpserver

import (
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 按顶层块转换的 Markdown：块之间空行分隔，相邻同类列表之间加分隔，空段落不占位置
func TestHTMLToMarkdownBlocks(t *testing.T) {
	md, blocks, err := htmlToMarkdownBlocks(`<h2>T</h2><p></p><ul><li><p>a</p></li></ul><ul><li><p>b</p></li></ul>`)
	if err != nil {
		t.Fatal(err)
	}
	if md != "## T\n\n- a\n\n<!--THE END-->\n\n- b" {
		t.Fatalf("markdown = %q", md)
	}
	if len(blocks) != 4 || blocks[1].from != blocks[1].to || md[blocks[2].from:blocks[2].to] != "- a" || md[blocks[3].from:blocks[3].to] != "- b" {
		t.Fatalf("blocks = %+v", blocks)
	}
	if md, blocks, err := htmlToMarkdownBlocks("  "); md != "" || blocks != nil || err != nil {
		t.Fatalf("empty body: %q %v %v", md, blocks, err)
	}
}

// patch 只改命中的顶层块，其余块（包括 Markdown 表达不了的格式）原样保留
func TestApplyMarkdownPatch(t *testing.T) {
	src := `<h2>标题</h2><p>保留 <span data-annotation="注释" class="neo-annotation">注释</span> 与 <mark data-color="#fef08a">高亮</mark></p><p>第二段旧内容</p><p>第三段</p>`
	out, patched, err := applyMarkdownPatch(src, "第二段旧内容", "第二段**新**内容")
	if err != nil {
		t.Fatal(err)
	}
	if out != `<h2>标题</h2><p>保留 <span data-annotation="注释" class="neo-annotation">注释</span> 与 <mark data-color="#fef08a">高亮</mark></p><p>第二段<strong>新</strong>内容</p><p>第三段</p>` || patched != "第二段**新**内容" {
		t.Fatalf("patch = %q / %q", out, patched)
	}
	// 跨段落：命中的两段一起重写；替换为空即删除
	out, _, err = applyMarkdownPatch(src, "第二段旧内容\n\n第三段", "")
	if err != nil || out != `<h2>标题</h2><p>保留 <span data-annotation="注释" class="neo-annotation">注释</span> 与 <mark data-color="#fef08a">高亮</mark></p>` {
		t.Fatalf("delete across blocks: %q %v", out, err)
	}
	// 只命中段落的一部分时，替换这一段中的那部分
	out, _, err = applyMarkdownPatch(`<p>a b c</p><p>d</p>`, "b", "B")
	if err != nil || out != `<p>a B c</p><p>d</p>` {
		t.Fatalf("partial block: %q %v", out, err)
	}
	// 全部删除后留下空段落
	if out, _, err = applyMarkdownPatch(`<p>only</p>`, "only", ""); err != nil || out != emptyContentHTML {
		t.Fatalf("delete everything: %q %v", out, err)
	}
	for name, c := range map[string]struct{ src, find, want string }{
		"not found": {`<p>a</p>`, "zzz", "was not found"},
		"ambiguous": {`<p>same</p><p>same</p>`, "same", "matches 2 places"},
		"blank":     {`<p>a</p><p>b</p>`, "\n\n", "must not be empty"},
	} {
		if _, _, err := applyMarkdownPatch(c.src, c.find, "x"); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want %q", name, err, c.want)
		}
	}
}

// 追加 / 插入时去掉衔接处的空段落（编辑器保存的正文末尾常带一个空段落）
func TestEditContentJoinsWithoutEmptyParagraphs(t *testing.T) {
	for name, c := range map[string]struct{ mode, current, want string }{
		"append":  {editModeAppend, "<p>a</p><p></p>", "<p>a</p><p>new</p>"},
		"prepend": {editModePrepend, `<p style="text-align: center"></p><p>a</p>`, "<p>new</p><p>a</p>"},
		"empty":   {editModeAppend, "<p></p>", "<p>new</p>"},
	} {
		got, _, err := editContent(c.current, c.mode, formatMarkdown, "new", "")
		if err != nil || got != c.want {
			t.Errorf("%s: %q %v, want %q", name, got, err, c.want)
		}
	}
}

// 写入方式与草稿版本号：replace 必须带 base_version，版本过期时拒绝；patch / append / prepend 在最新草稿上修改
func TestUpdatePostEditModes(t *testing.T) {
	env := setupTest(t)
	writer := tokenCtx(t, env.author, constant.ScopePostsRead, constant.ScopePostsWrite)
	_, created, err := createPost(writer, nil, createPostInput{Title: "t", Content: "第一段\n\n第二段"})
	if err != nil {
		t.Fatal(err)
	}
	version := created.DraftVersion
	if version == 0 {
		t.Fatalf("created draft should have a version: %+v", created)
	}

	// 作者在编辑页里保存了一次（不经过 AI），AI 之前读到的版本随之过期
	session, svcerr := service.NewEditSessionService().Acquire(env.authorCtx, constant.TargetTypePost, created.ID, "browser")
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	human := "<p>第一段</p><p>第二段（作者改过）</p>"
	saved, svcerr := service.NewPostService().UpdatePost(env.authorCtx, &dto.CreateOrUpdatePostReq{ID: created.ID, PostBaseDto: dto.PostBaseDto{DraftContent: &human}, EditSessionID: session.SessionID, BaseDraftVersion: &version})
	if svcerr != nil || saved.DraftVersion != version+1 {
		t.Fatalf("human save: %+v %v", saved, svcerr)
	}
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, Content: ptr("覆盖"), BaseVersion: &version})
	wantErr(t, err, "draft_conflict")
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModePatch, FindText: "第一段", Content: ptr("x"), BaseVersion: &version})
	wantErr(t, err, "draft_conflict")
	if post := reload(t, created.ID); *post.DraftContent != human {
		t.Fatalf("stale writes must not change the draft: %q", *post.DraftContent)
	}

	// 不带 base_version 的 patch 在最新草稿上修改，作者的修改保留
	_, out, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModePatch, FindText: "第一段", Content: ptr("第一段（AI 改过）")})
	if err != nil || out.Patched != "第一段（AI 改过）" || out.DraftVersion != version+2 {
		t.Fatalf("patch: %v %+v", err, out)
	}
	if post := reload(t, created.ID); *post.DraftContent != "<p>第一段（AI 改过）</p><p>第二段（作者改过）</p>" {
		t.Fatalf("patch result: %q", *post.DraftContent)
	}
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModePatch, FindText: "第一段（AI 改过）", Content: ptr("第一段（AI 改过）")})
	wantErr(t, err, "no changes")
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModePatch, Content: ptr("x")})
	wantErr(t, err, "find_text is required")
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModeAppend, FindText: "x", Content: ptr("x")})
	wantErr(t, err, "only applies to edit_mode patch")
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: "rewrite", Content: ptr("x")})
	wantErr(t, err, "edit_mode must be one of")

	// append / prepend
	if _, _, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModeAppend, Content: ptr("结尾")}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if _, _, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModePrepend, Content: ptr("## 开头")}); err != nil {
		t.Fatalf("prepend: %v", err)
	}
	if post := reload(t, created.ID); *post.DraftContent != "<h2>开头</h2><p>第一段（AI 改过）</p><p>第二段（作者改过）</p><p>结尾</p>" {
		t.Fatalf("append / prepend: %q", *post.DraftContent)
	}

	// HTML 格式的 patch 按原文精确替换
	if _, _, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, EditMode: editModePatch, ContentFormat: formatHTML, FindText: "<p>结尾</p>", Content: ptr(`<p style="text-align: center">结尾</p>`)}); err != nil {
		t.Fatalf("html patch: %v", err)
	}

	// 带正确的 base_version 整篇替换
	_, detail, err := getPost(writer, nil, getPostInput{Post: "1"})
	if err != nil || detail.DraftVersion == nil || *detail.DraftVersion != version+5 {
		t.Fatalf("get_post draft_version: %v %+v", err, detail)
	}
	if _, out, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, Content: ptr("全新正文"), BaseVersion: detail.DraftVersion}); err != nil || out.DraftVersion != *detail.DraftVersion+1 {
		t.Fatalf("replace: %v %+v", err, out)
	}
	// 只改元信息不需要也不接受写入方式参数，版本号不变
	_, _, err = updatePost(writer, nil, updatePostInput{PostID: created.ID, Title: ptr("新标题"), EditMode: editModePatch})
	wantErr(t, err, "only apply when content is given")
	if _, out, err := updatePost(writer, nil, updatePostInput{PostID: created.ID, Title: ptr("新标题")}); err != nil || out.DraftVersion != *detail.DraftVersion+1 {
		t.Fatalf("metadata only: %v %+v", err, out)
	}
}
