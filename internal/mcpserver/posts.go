package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const (
	versionDraft     = "draft"
	versionPublished = "published"
	listDefaultSize  = 20
	listMaxSize      = 50
	emptyContentHTML = "<p></p>"
)

var formatEnum = []any{formatMarkdown, formatHTML}

// update_post 的正文写入方式，参考 Outline：优先局部写入，只改动需要改的部分
const (
	editModeReplace = "replace" // 整篇替换，必须带 base_version
	editModeAppend  = "append"  // 追加到末尾
	editModePrepend = "prepend" // 插入到开头
	editModePatch   = "patch"   // 只替换 find_text 命中的部分
)

var editModeEnum = []any{editModePatch, editModeAppend, editModePrepend, editModeReplace}

// 局部写入在服务端读取最新草稿后修改，期间草稿被其他人改动时重新读取再改，最多尝试的次数
const editMaxAttempts = 3

// 正文开头 / 末尾的空段落（编辑器的空段落为 <p></p>，可能带对齐等属性或一个换行）
var (
	reTrailingEmptyParagraphs = regexp.MustCompile(`(?:\s*<p(?:\s[^>]*)?>\s*(?:<br\s*/?>)?\s*</p>)+\s*$`)
	reLeadingEmptyParagraphs  = regexp.MustCompile(`^\s*(?:<p(?:\s[^>]*)?>\s*(?:<br\s*/?>)?\s*</p>\s*)+`)
)

type taxonomyRef struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
}

type postSummary struct {
	ID          uint          `json:"id"`
	Title       string        `json:"title"`
	Slug        string        `json:"slug,omitempty"`
	Description string        `json:"description,omitempty"`
	IsPrivate   bool          `json:"is_private" jsonschema:"true when the post is unpublished (only the author and admins can see it)"`
	Category    *taxonomyRef  `json:"category,omitempty"`
	Labels      []taxonomyRef `json:"labels"`
	Author      string        `json:"author"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
	URL         string        `json:"url" jsonschema:"public URL of the post"`
}

type postDetail struct {
	postSummary
	Cover                 string     `json:"cover,omitempty"`
	Pinned                bool       `json:"pinned" jsonschema:"true when the post is pinned to the top of the home page (only admins can pin, from the web console)"`
	PinnedUntil           *time.Time `json:"pinned_until,omitempty" jsonschema:"when the pin expires; absent means it stays pinned until removed"`
	Version               string     `json:"version" jsonschema:"which body is returned: draft or published"`
	HasUnpublishedChanges bool       `json:"has_unpublished_changes" jsonschema:"the draft differs from the published body"`
	DraftVersion          *uint64    `json:"draft_version,omitempty" jsonschema:"version of the draft (author/admin only); pass it as base_version to update_post"`
	ContentFormat         string     `json:"content_format"`
	Content               string     `json:"content"`
	PreviewURL            string     `json:"preview_url,omitempty" jsonschema:"console page that previews the draft as readers would see it (author/admin only, requires signing in)"`
	EditURL               string     `json:"edit_url,omitempty" jsonschema:"console editor URL"`
}

type postWriteResult struct {
	ID           uint   `json:"id"`
	Title        string `json:"title"`
	IsPrivate    bool   `json:"is_private"`
	DraftVersion uint64 `json:"draft_version" jsonschema:"version of the draft after this write; pass it as base_version next time"`
	URL          string `json:"url" jsonschema:"public URL (only reachable when the post is published)"`
	PreviewURL   string `json:"preview_url" jsonschema:"console page that previews the draft as readers would see it (requires signing in)"`
	EditURL      string `json:"edit_url" jsonschema:"console editor URL"`
	Patched      string `json:"patched,omitempty" jsonschema:"for edit_mode patch: the changed part of the body as now saved, to check the result"`
	Message      string `json:"message"`
}

func postURL(post *dto.PostDto) string {
	key := strconv.FormatUint(uint64(post.ID), 10)
	if post.Slug != nil && *post.Slug != "" {
		key = *post.Slug
	}
	return tools.GetBaseUrl() + "/p/" + key
}

func editURL(id uint) string {
	return fmt.Sprintf("%s/console/posts/edit/%d", tools.GetBaseUrl(), id)
}

// previewURL 后台的草稿预览（按前台文章页的样子渲染），私密文章与草稿不在前台出现
func previewURL(id uint) string {
	return fmt.Sprintf("%s/console/posts/preview/%d", tools.GetBaseUrl(), id)
}

func toSummary(post *dto.PostDto) postSummary {
	summary := postSummary{
		ID:          post.ID,
		Title:       post.Title,
		Slug:        utils.Deref(post.Slug),
		Description: post.Description,
		IsPrivate:   post.IsPrivate,
		Labels:      make([]taxonomyRef, 0, len(post.Labels)),
		Author:      utils.Ternary(post.User.Nickname != "", post.User.Nickname, post.User.Username),
		CreatedAt:   post.CreatedAt,
		UpdatedAt:   post.UpdatedAt,
		URL:         postURL(post),
	}
	if post.Category != nil {
		summary.Category = &taxonomyRef{ID: post.Category.ID, Name: post.Category.Name}
	}
	for _, label := range post.Labels {
		summary.Labels = append(summary.Labels, taxonomyRef{ID: label.ID, Name: label.Name})
	}
	return summary
}

func writeResult(post *dto.PostDto, message string) *postWriteResult {
	return &postWriteResult{
		ID:           post.ID,
		Title:        post.Title,
		IsPrivate:    post.IsPrivate,
		DraftVersion: post.DraftVersion,
		URL:          postURL(post),
		PreviewURL:   previewURL(post.ID),
		EditURL:      editURL(post.ID),
		Message:      message,
	}
}

// isAgentRun 当前调用来自 AI 用户的运行：AI 用户只读前台能看到的内容（公开文章、已发布正文），即使账号有更高的角色
func isAgentRun(ctx context.Context) bool {
	_, ok := ctxutils.GetAgentRun(ctx)
	return ok
}

// hasConsoleRole 当前角色能否读后台视图（私密文章与草稿）：编辑及以上，与后台 /post/mine、/post/p/:id/draft 的路由要求一致；
// 按当前角色判断，被降级为普通用户的原作者只能读公开内容
func hasConsoleRole(ctx context.Context) bool {
	user, ok := ctxutils.GetCurrentUser(ctx)
	return ok && user.GreaterThanEditor()
}

// canSeeDraft 作者本人与管理员（当前角色为编辑及以上）通过 API Token 写作时可以读私密文章与草稿（MCP 不是前台页面）；AI 用户的运行不行
func canSeeDraft(ctx context.Context, ownerID uint) bool {
	return !isAgentRun(ctx) && hasConsoleRole(ctx) && (ctxutils.IsOwnerOfTarget(ctx, ownerID) || ctxutils.IsAdmin(ctx))
}

// loadPost 按 ID 或 slug 读取文章：作者本人与管理员（当前角色为编辑及以上）读后台视图（含私密文章与草稿），其他人只能读到公开文章
func loadPost(ctx context.Context, slugOrID string) (*dto.PostDto, error) {
	key := strings.TrimSpace(slugOrID)
	postService := service.NewPostService()
	if !isAgentRun(ctx) && hasConsoleRole(ctx) {
		post, svcerr := postService.GetPostForEdit(ctx, key)
		if svcerr == nil {
			return post, nil
		}
		// 不是作者也不是管理员：退回前台视图（私密文章因此当作不存在）
		if !(svcerr.Code == http.StatusForbidden || svcerr.Code == http.StatusUnauthorized) {
			return nil, serviceError(svcerr)
		}
	}
	post, svcerr := postService.GetPostSlugOrId(ctx, key)
	if svcerr != nil {
		return nil, serviceError(svcerr)
	}
	return post, nil
}

func loadPostByID(ctx context.Context, id uint) (*dto.PostDto, error) {
	if id == 0 {
		return nil, errors.New("post_id is required")
	}
	return loadPost(ctx, strconv.FormatUint(uint64(id), 10))
}

// currentDraft 草稿为空时取已发布的正文
func currentDraft(post *dto.PostDto) string {
	if post.DraftContent != nil && *post.DraftContent != "" {
		return *post.DraftContent
	}
	return post.Content
}

func validateCover(cover *string) error {
	if cover != nil && *cover != "" && !utils.Url.IsValidUrl(*cover) {
		return errors.New("cover must be a valid URL")
	}
	return nil
}

// savePost 保存文章，返回保存后的草稿版本号
// 外部 AI 工具不使用编辑会话，可以与编辑页同时写入：写入正文时按草稿版本号原子校验，
// 读取之后有其他写入则返回 draft_conflict，不会覆盖他人的修改；编辑页收到保存事件后把这次修改合并进来
func savePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (uint64, error) {
	result, svcerr := service.NewPostService().UpdatePost(ctx, req)
	if svcerr != nil {
		return 0, serviceError(svcerr)
	}
	return result.DraftVersion, nil
}

// ---- list_posts ----

type listPostsInput struct {
	Query    string `json:"query,omitempty" jsonschema:"keywords matched against title and body; separate multiple keywords with commas"`
	Category string `json:"category,omitempty" jsonschema:"only posts in this category (name or slug)"`
	Label    string `json:"label,omitempty" jsonschema:"only posts with this label (name or slug)"`
	Mine     bool   `json:"mine,omitempty" jsonschema:"only posts written by the token owner"`
	OrderBy  string `json:"order_by,omitempty" jsonschema:"sort field, default updated_at (newest first)"`
	Page     int    `json:"page,omitempty" jsonschema:"page number starting at 1 (default 1)"`
	Size     int    `json:"size,omitempty" jsonschema:"page size 1-50 (default 20)"`
}

type listPostsOutput struct {
	Posts []postSummary `json:"posts"`
	Total int64         `json:"total"`
	Page  int           `json:"page"`
	Size  int           `json:"size"`
}

func listPosts(ctx context.Context, _ *mcp.CallToolRequest, in listPostsInput) (*mcp.CallToolResult, *listPostsOutput, error) {
	if err := requireScope(ctx, constant.ScopePostsRead); err != nil {
		return nil, nil, err
	}
	orderBy := utils.Ternary(in.OrderBy == "", constant.OrderByUpdatedAt, in.OrderBy)
	if !slices.Contains(constant.OrderByEnumPost, orderBy) {
		return nil, nil, fmt.Errorf("order_by must be one of %v", constant.OrderByEnumPost)
	}
	page := max(in.Page, 1)
	size := utils.Ternary(in.Size <= 0, listDefaultSize, min(in.Size, listMaxSize))
	req := &dto.ListPostReq{
		Query:            in.Query,
		NoContent:        true,
		Label:            in.Label,
		Category:         in.Category,
		PaginationParams: dto.PaginationParams{Page: uint64(page), Size: uint64(size), OrderBy: orderBy, Desc: true},
	}
	if in.Mine {
		req.UserID, _ = ctxutils.GetCurrentUserID(ctx)
	}
	postService := service.NewPostService()
	// 管理员可以看到所有人的私密文章，编辑者用 mine 看自己的全部文章（含私密），其余只列公开文章；
	// AI 用户的运行、被降级为普通用户的原作者一律只列公开文章（mine 时为自己的公开文章）
	list := postService.ListPosts
	switch {
	case isAgentRun(ctx):
	case ctxutils.IsAdmin(ctx):
		list = postService.ListPostsAdmin
	case in.Mine && hasConsoleRole(ctx):
		list = postService.ListMyPosts
	}
	posts, total, svcerr := list(ctx, req)
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	out := &listPostsOutput{Posts: make([]postSummary, 0, len(posts)), Total: total, Page: page, Size: size}
	for _, post := range posts {
		out.Posts = append(out.Posts, toSummary(post))
	}
	return nil, out, nil
}

// ---- get_post ----

type getPostInput struct {
	Post          string `json:"post" jsonschema:"post id or slug"`
	Version       string `json:"version,omitempty" jsonschema:"draft (default) returns the latest unpublished draft when you are the author (editor role or above) or an admin, otherwise the published body; published always returns what readers see"`
	ContentFormat string `json:"content_format,omitempty" jsonschema:"markdown (default) or html"`
}

func getPost(ctx context.Context, _ *mcp.CallToolRequest, in getPostInput) (*mcp.CallToolResult, *postDetail, error) {
	if err := requireScope(ctx, constant.ScopePostsRead); err != nil {
		return nil, nil, err
	}
	format, err := normalizeFormat(in.ContentFormat)
	if err != nil {
		return nil, nil, err
	}
	if !(in.Version == "" || in.Version == versionDraft || in.Version == versionPublished) {
		return nil, nil, errors.New(`version must be "draft" or "published"`)
	}
	post, err := loadPost(ctx, in.Post)
	if err != nil {
		return nil, nil, err
	}
	// 草稿仅作者本人或管理员可见，与后台接口一致
	authorView := canSeeDraft(ctx, post.UserID)
	detail := &postDetail{
		postSummary:   toSummary(post),
		Cover:         post.Cover,
		Pinned:        post.Pinned,
		PinnedUntil:   utils.Ternary(post.Pinned, post.PinnedUntil, nil),
		Version:       versionPublished,
		ContentFormat: format,
	}
	body := post.Content
	if authorView {
		draft := currentDraft(post)
		detail.HasUnpublishedChanges = draft != post.Content
		detail.PreviewURL = previewURL(post.ID)
		detail.EditURL = editURL(post.ID)
		detail.DraftVersion = &post.DraftVersion
		if in.Version != versionPublished {
			body = draft
			detail.Version = versionDraft
		}
	}
	if detail.Content, err = renderContent(body, format); err != nil {
		return nil, nil, fmt.Errorf("failed to convert content: %w", err)
	}
	return nil, detail, nil
}

// ---- list_taxonomy ----

type categoryItem struct {
	ID          uint   `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description,omitempty"`
}

type labelItem struct {
	ID        uint   `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	PostCount int64  `json:"post_count"`
}

type listTaxonomyOutput struct {
	Categories []categoryItem `json:"categories"`
	Labels     []labelItem    `json:"labels"`
}

func listTaxonomy(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, *listTaxonomyOutput, error) {
	if err := requireScope(ctx, constant.ScopePostsRead); err != nil {
		return nil, nil, err
	}
	categories, svcerr := service.NewPostService().ListCategories()
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	labels, svcerr := service.NewLabelService().ListLabels()
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	out := &listTaxonomyOutput{Categories: make([]categoryItem, 0, len(categories)), Labels: make([]labelItem, 0, len(labels))}
	for _, c := range categories {
		out.Categories = append(out.Categories, categoryItem{ID: c.ID, Name: c.Name, Slug: c.Slug, Description: c.Description})
	}
	for _, l := range labels {
		out.Labels = append(out.Labels, labelItem{ID: l.ID, Name: l.Name, Slug: l.Slug, PostCount: l.PostCount})
	}
	return nil, out, nil
}

// ---- create_post ----

type createPostInput struct {
	Title         string  `json:"title" jsonschema:"post title"`
	Content       string  `json:"content,omitempty" jsonschema:"post body, saved as an unpublished draft; may contain component blocks described by get_writing_guide"`
	ContentFormat string  `json:"content_format,omitempty" jsonschema:"format of content: markdown (default) or html"`
	Description   *string `json:"description,omitempty" jsonschema:"short summary shown in post lists"`
	Slug          *string `json:"slug,omitempty" jsonschema:"friendly URL segment; must be unique and not purely numeric"`
	Cover         *string `json:"cover,omitempty" jsonschema:"cover image URL (upload_image returns one)"`
	CategoryID    *uint   `json:"category_id,omitempty" jsonschema:"category id from list_taxonomy"`
	LabelIDs      []uint  `json:"label_ids,omitempty" jsonschema:"label ids from list_taxonomy"`
}

func createPost(ctx context.Context, _ *mcp.CallToolRequest, in createPostInput) (*mcp.CallToolResult, *postWriteResult, error) {
	if err := requireScope(ctx, constant.ScopePostsWrite); err != nil {
		return nil, nil, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, nil, errors.New("title is required")
	}
	format, err := normalizeFormat(in.ContentFormat)
	if err != nil {
		return nil, nil, err
	}
	content, err := parseContent(in.Content, format)
	if err != nil {
		return nil, nil, err
	}
	if err := validateCover(in.Cover); err != nil {
		return nil, nil, err
	}
	// 新文章先以私密、空正文创建，正文写入草稿；发布前读者看不到任何内容
	isPrivate := true
	postID, svcerr := service.NewPostService().CreatePost(ctx, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{
			Title:      title,
			Type:       formatHTML,
			Slug:       in.Slug,
			CategoryID: in.CategoryID,
			LabelIds:   in.LabelIDs,
		},
		IsPrivate:   &isPrivate,
		Description: in.Description,
		Cover:       in.Cover,
	})
	if svcerr != nil {
		return nil, nil, serviceError(svcerr)
	}
	if _, err := savePost(ctx, &dto.CreateOrUpdatePostReq{ID: postID, PostBaseDto: dto.PostBaseDto{DraftContent: &content}}); err != nil {
		return nil, nil, fmt.Errorf("post %d was created but saving its draft failed: %w", postID, err)
	}
	post, err := loadPostByID(ctx, postID)
	if err != nil {
		return nil, nil, err
	}
	return nil, writeResult(post, "Created as an unpublished draft. Share the preview_url with the user and call publish_post when they approve."), nil
}

// ---- update_post ----

type updatePostInput struct {
	PostID        uint    `json:"post_id" jsonschema:"id of the post to update"`
	Content       *string `json:"content,omitempty" jsonschema:"body content saved as an unpublished draft (readers keep seeing the published version until publish_post); what it does depends on edit_mode. Omit to keep the current draft"`
	EditMode      string  `json:"edit_mode,omitempty" jsonschema:"how content is applied. patch (preferred for edits): replaces only find_text and keeps the rest of the body exactly as is; append / prepend: adds content to the end / beginning; replace (default): content becomes the whole body and base_version is required"`
	FindText      string  `json:"find_text,omitempty" jsonschema:"required for patch: the text to replace, copied verbatim from get_post in the same content_format. It must match exactly one place and may span several paragraphs; content is its replacement (empty content deletes it)"`
	BaseVersion   *uint64 `json:"base_version,omitempty" jsonschema:"draft_version from get_post that your change is based on. Required for replace, optional for other modes. If the draft has changed since, nothing is written and you get draft_conflict"`
	ContentFormat string  `json:"content_format,omitempty" jsonschema:"format of content and find_text: markdown (default) or html"`
	Title         *string `json:"title,omitempty"`
	Description   *string `json:"description,omitempty" jsonschema:"short summary; empty string clears it"`
	Slug          *string `json:"slug,omitempty" jsonschema:"friendly URL segment; empty string clears it"`
	Cover         *string `json:"cover,omitempty" jsonschema:"cover image URL; empty string clears it"`
	CategoryID    *uint   `json:"category_id,omitempty" jsonschema:"category id from list_taxonomy; 0 removes the category"`
	LabelIDs      []uint  `json:"label_ids,omitempty" jsonschema:"replaces all labels; [] removes every label"`
}

func (in *updatePostInput) hasMeta() bool {
	return in.Title != nil || in.Description != nil || in.Slug != nil || in.Cover != nil || in.CategoryID != nil || in.LabelIDs != nil
}

func normalizeEditMode(mode string) (string, error) {
	switch m := strings.ToLower(strings.TrimSpace(mode)); m {
	case "":
		return editModeReplace, nil
	case editModeReplace, editModeAppend, editModePrepend, editModePatch:
		return m, nil
	}
	return "", fmt.Errorf("edit_mode must be one of %v", editModeEnum)
}

// editContent 按写入方式把 content 应用到当前草稿 current 上，返回新的草稿 HTML；patch 还返回替换后的那部分（与 content 同一格式）
func editContent(current, mode, format, content, findText string) (string, string, error) {
	empty := strings.TrimSpace(current) == "" || current == emptyContentHTML
	switch mode {
	case editModePatch:
		if format == formatHTML {
			start, err := findUnique(current, findText)
			if err != nil {
				return "", "", err
			}
			result := current[:start] + content + current[start+len(findText):]
			return utils.Ternary(strings.TrimSpace(result) == "", emptyContentHTML, result), content, nil
		}
		return applyMarkdownPatch(current, findText, content)
	case editModeAppend, editModePrepend:
		if strings.TrimSpace(content) == "" {
			return "", "", fmt.Errorf("content is required for edit_mode %s", mode)
		}
		added, err := parseContent(content, format)
		if err != nil {
			return "", "", err
		}
		if empty {
			return added, "", nil
		}
		// 编辑器保存的正文末尾常带一个空段落，追加 / 插入时去掉衔接处的空段落，避免中间多出空行
		if mode == editModeAppend {
			return reTrailingEmptyParagraphs.ReplaceAllString(current, "") + added, "", nil
		}
		return added + reLeadingEmptyParagraphs.ReplaceAllString(current, ""), "", nil
	}
	result, err := parseContent(content, format)
	return result, "", err
}

func updatePost(ctx context.Context, _ *mcp.CallToolRequest, in updatePostInput) (*mcp.CallToolResult, *postWriteResult, error) {
	if err := requireScope(ctx, constant.ScopePostsWrite); err != nil {
		return nil, nil, err
	}
	if in.Content == nil && !in.hasMeta() {
		return nil, nil, errors.New("nothing to update: pass content and/or metadata fields")
	}
	post, err := loadPostByID(ctx, in.PostID)
	if err != nil {
		return nil, nil, err
	}
	// 只有作者或管理员可以修改，先于其他校验，不向无权限的调用方透露更多信息
	if !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, nil, serviceError(errs.NewForbidden("permission_denied"))
	}
	// 元信息没有草稿，公开文章上的修改会立即对读者可见，因此视同发布
	if in.hasMeta() && !post.IsPrivate {
		if err := requireScope(ctx, constant.ScopePostsPublish); err != nil {
			return nil, nil, fmt.Errorf("post %d is public and metadata changes go live immediately, which needs the %q scope. Update only content (saved as a draft) or ask the user for a token with that scope", post.ID, constant.ScopePostsPublish)
		}
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return nil, nil, errors.New("title cannot be empty")
	}
	if err := validateCover(in.Cover); err != nil {
		return nil, nil, err
	}
	req := &dto.CreateOrUpdatePostReq{
		ID: post.ID,
		PostBaseDto: dto.PostBaseDto{
			Title:      strings.TrimSpace(utils.Deref(in.Title)),
			Slug:       in.Slug,
			CategoryID: in.CategoryID,
			LabelIds:   in.LabelIDs,
		},
		Description: in.Description,
		Cover:       in.Cover,
	}
	if in.Content == nil {
		if in.FindText != "" || in.EditMode != "" || in.BaseVersion != nil {
			return nil, nil, errors.New("edit_mode, find_text and base_version only apply when content is given")
		}
		if _, err := savePost(ctx, req); err != nil {
			return nil, nil, err
		}
		if post, err = loadPostByID(ctx, post.ID); err != nil {
			return nil, nil, err
		}
		return nil, writeResult(post, "Metadata saved."), nil
	}

	mode, err := normalizeEditMode(in.EditMode)
	if err != nil {
		return nil, nil, err
	}
	format, err := normalizeFormat(in.ContentFormat)
	if err != nil {
		return nil, nil, err
	}
	switch {
	case mode == editModeReplace && in.BaseVersion == nil:
		return nil, nil, errors.New("base_version is required to replace the whole body: call get_post and pass its draft_version. To change only part of the body, use edit_mode patch with find_text")
	case mode == editModePatch && in.FindText == "":
		return nil, nil, errors.New("find_text is required for edit_mode patch")
	case mode != editModePatch && in.FindText != "":
		return nil, nil, errors.New("find_text only applies to edit_mode patch")
	}
	// 在最新的草稿上修改并按读取时的版本号保存；没有指定 base_version 时，期间被他人改动则重新读取再改
	var patched string
	for attempt := 1; ; attempt++ {
		if in.BaseVersion != nil && *in.BaseVersion != post.DraftVersion {
			return nil, nil, serviceError(errs.NewConflict("draft_conflict"))
		}
		current := currentDraft(post)
		content, region, err := editContent(current, mode, format, *in.Content, in.FindText)
		if err != nil {
			return nil, nil, err
		}
		if content == current && !in.hasMeta() {
			return nil, nil, errors.New("the update resulted in no changes to the draft; make sure content differs from what it replaces")
		}
		version := post.DraftVersion
		req.DraftContent = &content
		req.BaseDraftVersion = &version
		_, svcerr := service.NewPostService().UpdatePost(ctx, req)
		if svcerr != nil && svcerr.Message == "draft_conflict" && in.BaseVersion == nil && attempt < editMaxAttempts {
			if post, err = loadPostByID(ctx, post.ID); err != nil {
				return nil, nil, err
			}
			continue
		}
		if svcerr != nil {
			return nil, nil, serviceError(svcerr)
		}
		patched = region
		break
	}
	if post, err = loadPostByID(ctx, post.ID); err != nil {
		return nil, nil, err
	}
	result := writeResult(post, "Saved. Content changes are an unpublished draft; call publish_post to make them live.")
	result.Patched = patched
	return nil, result, nil
}

// ---- publish_post / unpublish_post ----

type postIDInput struct {
	PostID uint `json:"post_id" jsonschema:"id of the post"`
}

func publishPost(ctx context.Context, _ *mcp.CallToolRequest, in postIDInput) (*mcp.CallToolResult, *postWriteResult, error) {
	if err := requireScope(ctx, constant.ScopePostsPublish); err != nil {
		return nil, nil, err
	}
	post, err := loadPostByID(ctx, in.PostID)
	if err != nil {
		return nil, nil, err
	}
	content := currentDraft(post)
	if strings.TrimSpace(content) == "" || content == emptyContentHTML {
		return nil, nil, fmt.Errorf("post %d has no content to publish", post.ID)
	}
	isPrivate := false
	// 按读取时的草稿版本号保存：读取之后草稿又被改动时拒绝，不会发布一份过期的草稿
	version := post.DraftVersion
	if _, err := savePost(ctx, &dto.CreateOrUpdatePostReq{
		ID:               post.ID,
		PostBaseDto:      dto.PostBaseDto{Content: content, DraftContent: &content, Type: formatHTML},
		IsPrivate:        &isPrivate,
		BaseDraftVersion: &version,
	}); err != nil {
		return nil, nil, err
	}
	if post, err = loadPostByID(ctx, post.ID); err != nil {
		return nil, nil, err
	}
	return nil, writeResult(post, "Published: the draft is now live and the post is public."), nil
}

func unpublishPost(ctx context.Context, _ *mcp.CallToolRequest, in postIDInput) (*mcp.CallToolResult, *postWriteResult, error) {
	if err := requireScope(ctx, constant.ScopePostsPublish); err != nil {
		return nil, nil, err
	}
	post, err := loadPostByID(ctx, in.PostID)
	if err != nil {
		return nil, nil, err
	}
	isPrivate := true
	if _, err := savePost(ctx, &dto.CreateOrUpdatePostReq{ID: post.ID, IsPrivate: &isPrivate}); err != nil {
		return nil, nil, err
	}
	if post, err = loadPostByID(ctx, post.ID); err != nil {
		return nil, nil, err
	}
	return nil, writeResult(post, "Unpublished: the post is now private. Its content is kept."), nil
}

func registerPostTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_posts",
		Description: "Search and list posts (newest first). Returns public posts plus your own unpublished ones; admins see every post. Bodies are not included; use get_post. Requires posts:read.",
		InputSchema: inputSchema[listPostsInput](map[string][]any{"order_by": anySlice(constant.OrderByEnumPost)}),
		Annotations: &mcp.ToolAnnotations{Title: "List posts", ReadOnlyHint: true, OpenWorldHint: boolPtr(false)},
	}, listPosts)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_post",
		Description: "Get one post with its metadata and body (Markdown by default). By default you get the latest draft and its draft_version if you are the author or an admin. Requires posts:read.",
		InputSchema: inputSchema[getPostInput](map[string][]any{"version": {versionDraft, versionPublished}, "content_format": formatEnum}),
		Annotations: &mcp.ToolAnnotations{Title: "Get post", ReadOnlyHint: true, OpenWorldHint: boolPtr(false)},
	}, getPost)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_taxonomy",
		Description: "List all categories and labels with their ids, for use in create_post / update_post. Requires posts:read.",
		Annotations: &mcp.ToolAnnotations{Title: "List categories and labels", ReadOnlyHint: true, OpenWorldHint: boolPtr(false)},
	}, listTaxonomy)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_post",
		Description: "Create a new post. It starts unpublished (private) with the body saved as a draft, so readers see nothing until publish_post. Follow get_writing_guide for formats and components. Requires posts:write.",
		InputSchema: inputSchema[createPostInput](map[string][]any{"content_format": formatEnum}),
		Annotations: &mcp.ToolAnnotations{Title: "Create draft post", DestructiveHint: boolPtr(false), OpenWorldHint: boolPtr(false)},
	}, createPost)
	mcp.AddTool(server, &mcp.Tool{
		Name: "update_post",
		Description: "Update a post's draft and/or metadata; read it first with get_post and follow get_writing_guide. Content goes to an unpublished draft. " +
			"IMPORTANT: to edit existing content, prefer edit_mode \"patch\" with find_text copied verbatim from get_post: it changes only the matched part and keeps the rest of the body (including formatting Markdown cannot express) untouched. " +
			"Use \"append\" / \"prepend\" to add content, and \"replace\" (with base_version) only to rewrite the whole body. " +
			"People may be editing the same post in the console editor at the same time; your writes show up there live and are merged with their edits. " +
			"Metadata fields (title, description, slug, cover, category_id, label_ids) apply immediately; on a public post they also need posts:publish. Requires posts:write.",
		InputSchema: inputSchema[updatePostInput](map[string][]any{"content_format": formatEnum, "edit_mode": editModeEnum}),
		Annotations: &mcp.ToolAnnotations{Title: "Update post draft", DestructiveHint: boolPtr(false), OpenWorldHint: boolPtr(false)},
	}, updatePost)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "publish_post",
		Description: "Publish a post: its current draft becomes the live body and the post becomes public. Readers see it right away, so confirm with the user first. Requires posts:publish.",
		Annotations: &mcp.ToolAnnotations{Title: "Publish post", DestructiveHint: boolPtr(false), IdempotentHint: true, OpenWorldHint: boolPtr(true)},
	}, publishPost)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "unpublish_post",
		Description: "Unpublish a post: make it private so only the author and admins can see it. Nothing is deleted. Requires posts:publish.",
		Annotations: &mcp.ToolAnnotations{Title: "Unpublish post", DestructiveHint: boolPtr(false), IdempotentHint: true, OpenWorldHint: boolPtr(true)},
	}, unpublishPost)
}

func anySlice(values []string) []any {
	result := make([]any, len(values))
	for i, v := range values {
		result[i] = v
	}
	return result
}
