package mcpserver

import (
	"context"
	"errors"
	"fmt"
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
	Cover                 string `json:"cover,omitempty"`
	Top                   uint   `json:"top" jsonschema:"pin level, 0 means not pinned"`
	Version               string `json:"version" jsonschema:"which body is returned: draft or published"`
	HasUnpublishedChanges bool   `json:"has_unpublished_changes" jsonschema:"the draft differs from the published body"`
	ContentFormat         string `json:"content_format"`
	Content               string `json:"content"`
	PreviewURL            string `json:"preview_url,omitempty" jsonschema:"URL to preview the draft (author/admin only)"`
	EditURL               string `json:"edit_url,omitempty" jsonschema:"console editor URL"`
}

type postWriteResult struct {
	ID         uint   `json:"id"`
	Title      string `json:"title"`
	IsPrivate  bool   `json:"is_private"`
	URL        string `json:"url" jsonschema:"public URL (only reachable when the post is published)"`
	PreviewURL string `json:"preview_url" jsonschema:"URL to preview the draft"`
	EditURL    string `json:"edit_url" jsonschema:"console editor URL"`
	Message    string `json:"message"`
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
		ID:         post.ID,
		Title:      post.Title,
		IsPrivate:  post.IsPrivate,
		URL:        postURL(post),
		PreviewURL: postURL(post) + "?type=" + versionDraft,
		EditURL:    editURL(post.ID),
		Message:    message,
	}
}

// loadPost 按 ID 或 slug 读取文章，私密文章的可见性由 service 判断
func loadPost(ctx context.Context, slugOrID string) (*dto.PostDto, error) {
	post, svcerr := service.NewPostService().GetPostSlugOrId(ctx, strings.TrimSpace(slugOrID))
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

// savePost 获取编辑会话后保存；编辑页正在编辑时由 AcquireForAPIToken 拒绝，不会覆盖他人的修改
func savePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) error {
	sessionID, svcerr := service.NewEditSessionService().AcquireForAPIToken(ctx, constant.TargetTypePost, req.ID)
	if svcerr != nil {
		return serviceError(svcerr)
	}
	req.EditSessionID = sessionID
	if _, svcerr := service.NewPostService().UpdatePost(ctx, req); svcerr != nil {
		return serviceError(svcerr)
	}
	return nil
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
	// 管理员可以看到所有人的私密文章，其他用户只能看到公开文章与自己的私密文章
	list := utils.Ternary(ctxutils.IsAdmin(ctx), postService.ListPostsAdmin, postService.ListPosts)
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
	Version       string `json:"version,omitempty" jsonschema:"draft (default) returns the latest unpublished draft when you are the author or an admin, otherwise the published body; published always returns what readers see"`
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
	// 草稿仅作者本人或管理员可见，与文章接口一致
	canSeeDraft := ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)
	detail := &postDetail{
		postSummary:   toSummary(post),
		Cover:         post.Cover,
		Top:           post.Top,
		Version:       versionPublished,
		ContentFormat: format,
	}
	body := post.Content
	if canSeeDraft {
		draft := currentDraft(post)
		detail.HasUnpublishedChanges = draft != post.Content
		detail.PreviewURL = postURL(post) + "?type=" + versionDraft
		detail.EditURL = editURL(post.ID)
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
	Content       string  `json:"content,omitempty" jsonschema:"post body, saved as an unpublished draft"`
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
	if err := savePost(ctx, &dto.CreateOrUpdatePostReq{ID: postID, PostBaseDto: dto.PostBaseDto{DraftContent: &content}}); err != nil {
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
	Content       *string `json:"content,omitempty" jsonschema:"new full body, saved as an unpublished draft (readers keep seeing the published version until publish_post). Omit to keep the current draft"`
	ContentFormat string  `json:"content_format,omitempty" jsonschema:"format of content: markdown (default) or html"`
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
	if in.Content != nil {
		format, err := normalizeFormat(in.ContentFormat)
		if err != nil {
			return nil, nil, err
		}
		content, err := parseContent(*in.Content, format)
		if err != nil {
			return nil, nil, err
		}
		req.DraftContent = &content
	}
	if err := savePost(ctx, req); err != nil {
		return nil, nil, err
	}
	if post, err = loadPostByID(ctx, post.ID); err != nil {
		return nil, nil, err
	}
	message := "Saved. Content changes are an unpublished draft; call publish_post to make them live."
	if in.Content == nil {
		message = "Metadata saved."
	}
	return nil, writeResult(post, message), nil
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
	if err := savePost(ctx, &dto.CreateOrUpdatePostReq{
		ID:          post.ID,
		PostBaseDto: dto.PostBaseDto{Content: content, DraftContent: &content, Type: formatHTML},
		IsPrivate:   &isPrivate,
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
	if err := savePost(ctx, &dto.CreateOrUpdatePostReq{ID: post.ID, IsPrivate: &isPrivate}); err != nil {
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
		Description: "Get one post with its metadata and body (Markdown by default). By default you get the latest draft if you are the author or an admin. Requires posts:read.",
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
		Description: "Create a new post. It starts unpublished (private) with the body saved as a draft, so readers see nothing until publish_post. Requires posts:write.",
		InputSchema: inputSchema[createPostInput](map[string][]any{"content_format": formatEnum}),
		Annotations: &mcp.ToolAnnotations{Title: "Create draft post", DestructiveHint: boolPtr(false), OpenWorldHint: boolPtr(false)},
	}, createPost)
	mcp.AddTool(server, &mcp.Tool{
		Name: "update_post",
		Description: "Update a post. content replaces the whole body and is saved as an unpublished draft; read it first with get_post. " +
			"Metadata fields (title, description, slug, cover, category_id, label_ids) apply immediately; on a public post they also need posts:publish. " +
			"Refused while the post is open in the console editor. Requires posts:write.",
		InputSchema: inputSchema[updatePostInput](map[string][]any{"content_format": formatEnum}),
		Annotations: &mcp.ToolAnnotations{Title: "Update post draft", DestructiveHint: boolPtr(false), IdempotentHint: true, OpenWorldHint: boolPtr(false)},
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
