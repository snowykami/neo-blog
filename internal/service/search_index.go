package service

import (
	"context"
	"fmt"
	"net/http"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/meili"
	"github.com/snowykami/neo-blog/pkg/pinyin"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 第一阶段公开对象索引名称后缀（完整 UID = IndexPrefix + 后缀）
const (
	SearchGroupPosts    = "posts"
	SearchGroupPages    = "pages"
	SearchGroupComments = "comments"
	SearchGroupUsers    = "users"
)

var searchGroups = []string{
	SearchGroupPosts,
	SearchGroupPages,
	SearchGroupComments,
	SearchGroupUsers,
}

const (
	// searchSchemaVersion 索引 Settings 的结构版本：变更字段或权重时递增，多副本通过共享状态避免重复 Patch Settings
	searchSchemaVersion = "v1"

	searchMaxBodyRunes    = 30000
	searchReindexBatch    = 200
	searchFetchDocBatch   = 1000
	searchWriteTimeout    = 15 * time.Second
	searchQueryTimeout    = 4 * time.Second
	searchReindexLeaseTTL = 2 * time.Minute
	searchSettingsInitTTL = 24 * time.Hour

	searchReindexPendingKey = "search:reindex:pending"
	searchReindexLeaseKey   = "search:reindex:lease"
	searchSettingsKeyPrefix = "search:settings:"
)

// searchClientHolder 缓存当前配置对应的 Meilisearch 客户端，配置变更时自动重建
var searchClientHolder struct {
	mu         sync.Mutex
	url        string
	apiKey     string
	client     *meili.Client
	transport  http.RoundTripper // 仅测试注入
	syncInline bool              // 仅测试同步执行增量钩子
}

// activeMeiliClient 返回当前生效配置下的客户端；未开启时返回 (nil, cfg, false)
func activeMeiliClient(timeout time.Duration) (*meili.Client, tools.MeilisearchConfig, bool) {
	cfg := tools.GetMeilisearchConfig()
	if !cfg.Enabled() {
		return nil, cfg, false
	}
	searchClientHolder.mu.Lock()
	defer searchClientHolder.mu.Unlock()
	if searchClientHolder.client == nil || searchClientHolder.url != cfg.URL || searchClientHolder.apiKey != cfg.APIKey {
		c := meili.NewClient(cfg.URL, cfg.APIKey, timeout)
		if searchClientHolder.transport != nil {
			c.WithTransport(searchClientHolder.transport)
		}
		searchClientHolder.url = cfg.URL
		searchClientHolder.apiKey = cfg.APIKey
		searchClientHolder.client = c
	}
	return searchClientHolder.client, cfg, true
}

func runSearchGoroutine(name string, fn func()) {
	searchClientHolder.mu.Lock()
	inline := searchClientHolder.syncInline
	searchClientHolder.mu.Unlock()
	if inline {
		fn()
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logrus.Errorf("search background task %s panicked: %v\n%s", name, r, debug.Stack())
			}
		}()
		fn()
	}()
}

func runSearchAsync(fn func()) {
	if repo.GetDB() == nil || !tools.GetMeilisearchConfig().Enabled() {
		return
	}
	runSearchGoroutine("incremental_sync", fn)
}

var searchConfigListenOnce sync.Once

// ListenSearchConfigChanges 监听后台保存 Meilisearch 配置，首次启用或更换前缀时自动确保索引结构并回填公开数据
func ListenSearchConfigChanges() {
	searchConfigListenOnce.Do(func() {
		sharedstate.OnNotify("config_changed", func(key string) {
			if key == "" || strings.HasPrefix(key, "meilisearch_") {
				onSearchConfigSaved()
			}
		})
	})
}

func onSearchConfigSaved() {
	if repo.GetDB() == nil {
		return
	}
	runSearchGoroutine("config_saved", EnsureSearchReady)
}

// ---- 索引文档结构（物理只存公开数据与最小公开字段） ----

type meiliPostDoc struct {
	ID               uint     `json:"id"`
	UserID           uint     `json:"user_id"`
	CategoryID       uint     `json:"category_id"`
	LabelIDs         []uint   `json:"label_ids"`
	Title            string   `json:"title"`
	TitlePinyin      string   `json:"title_pinyin,omitempty"`
	TitleInitials    string   `json:"title_initials,omitempty"`
	Slug             string   `json:"slug,omitempty"`
	Labels           []string `json:"labels,omitempty"`
	LabelsPinyin     string   `json:"labels_pinyin,omitempty"`
	LabelsInitials   string   `json:"labels_initials,omitempty"`
	CategoryName     string   `json:"category_name,omitempty"`
	CategoryPinyin   string   `json:"category_pinyin,omitempty"`
	CategoryInitials string   `json:"category_initials,omitempty"`
	AuthorUsername   string   `json:"author_username,omitempty"`
	AuthorNickname   string   `json:"author_nickname,omitempty"`
	AuthorPinyin     string   `json:"author_pinyin,omitempty"`
	AuthorInitials   string   `json:"author_initials,omitempty"`
	Description      string   `json:"description,omitempty"`
	AISummary        string   `json:"ai_summary,omitempty"`
	PlainContent     string   `json:"plain_content,omitempty"`
	CreatedAt        int64    `json:"created_at"`
	UpdatedAt        int64    `json:"updated_at"`
	Heat             uint64   `json:"heat"`
	ViewCount        uint64   `json:"view_count"`
	LikeCount        uint64   `json:"like_count"`
	CommentCount     uint64   `json:"comment_count"`
}

type meiliPageDoc struct {
	ID            uint   `json:"id"`
	UserID        uint   `json:"user_id"`
	ShowInNav     bool   `json:"show_in_nav"`
	NavOrder      int    `json:"nav_order"`
	Kind          string `json:"kind"`
	Title         string `json:"title"`
	TitlePinyin   string `json:"title_pinyin,omitempty"`
	TitleInitials string `json:"title_initials,omitempty"`
	Slug          string `json:"slug"`
	Description   string `json:"description,omitempty"`
	PlainContent  string `json:"plain_content,omitempty"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
}

type meiliCommentDoc struct {
	ID                uint   `json:"id"`
	UserID            uint   `json:"user_id"`
	TargetType        string `json:"target_type"`
	TargetID          uint   `json:"target_id"`
	Content           string `json:"content"`
	AuthorUsername    string `json:"author_username,omitempty"`
	AuthorNickname    string `json:"author_nickname,omitempty"`
	AuthorPinyin      string `json:"author_pinyin,omitempty"`
	AuthorInitials    string `json:"author_initials,omitempty"`
	TargetTitle       string `json:"target_title,omitempty"`
	TargetTitlePinyin string `json:"target_title_pinyin,omitempty"`
	CreatedAt         int64  `json:"created_at"`
}

// meiliUserDoc 候选用户索引文档：仅含公开可检索字段，绝不包含邮箱、密码、IP 等隐私字段
type meiliUserDoc struct {
	ID               uint   `json:"id"`
	Username         string `json:"username"`
	Nickname         string `json:"nickname,omitempty"`
	NicknamePinyin   string `json:"nickname_pinyin,omitempty"`
	NicknameInitials string `json:"nickname_initials,omitempty"`
	Role             string `json:"role"`
	HasPublicPost    bool   `json:"has_public_post"`
}

func buildPostDoc(p *model.Post) meiliPostDoc {
	titleFull, titleInit := pinyin.Derive(p.Title)
	var catID uint
	var catName, catFull, catInit string
	if p.CategoryID != nil {
		catID = *p.CategoryID
	}
	if p.Category != nil {
		catName = p.Category.Name
		catFull, catInit = pinyin.Derive(catName)
	}
	labelNames := make([]string, 0, len(p.Labels))
	labelIDs := make([]uint, 0, len(p.Labels))
	for _, lb := range p.Labels {
		labelIDs = append(labelIDs, lb.ID)
		if lb.Name != "" {
			labelNames = append(labelNames, lb.Name)
		}
	}
	labelsFull, labelsInit := pinyin.DeriveSlice(labelNames)
	authorNick := p.User.Nickname
	authorFull, authorInit := pinyin.Derive(authorNick)
	var aiSummary string
	if !p.AISummaryStale() {
		aiSummary = p.AISummary
	}
	return meiliPostDoc{
		ID:               p.ID,
		UserID:           p.UserID,
		CategoryID:       catID,
		LabelIDs:         labelIDs,
		Title:            p.Title,
		TitlePinyin:      titleFull,
		TitleInitials:    titleInit,
		Slug:             utils.Deref(p.Slug),
		Labels:           labelNames,
		LabelsPinyin:     labelsFull,
		LabelsInitials:   labelsInit,
		CategoryName:     catName,
		CategoryPinyin:   catFull,
		CategoryInitials: catInit,
		AuthorUsername:   p.User.Username,
		AuthorNickname:   authorNick,
		AuthorPinyin:     authorFull,
		AuthorInitials:   authorInit,
		Description:      p.Description,
		AISummary:        aiSummary,
		PlainContent:     utils.HTMLSearchText(p.Content, searchMaxBodyRunes),
		CreatedAt:        p.CreatedAt.Unix(),
		UpdatedAt:        p.UpdatedAt.Unix(),
		Heat:             p.Heat,
		ViewCount:        p.ViewCount,
		LikeCount:        p.LikeCount,
		CommentCount:     p.CommentCount,
	}
}

func buildPageDoc(p *model.Page) meiliPageDoc {
	titleFull, titleInit := pinyin.Derive(p.Title)
	kind := model.NormalizePageKind(p.Kind)
	var plain string
	// 仅编辑器正文页面提取纯文本；链接页无正文，HTML 静态包跳过源码解析以避免 JS/CSS 污染索引
	if kind == model.PageKindContent {
		plain = utils.HTMLSearchText(p.Content, searchMaxBodyRunes)
	}
	return meiliPageDoc{
		ID:            p.ID,
		UserID:        p.UserID,
		ShowInNav:     p.ShowInNav,
		NavOrder:      p.NavOrder,
		Kind:          kind,
		Title:         p.Title,
		TitlePinyin:   titleFull,
		TitleInitials: titleInit,
		Slug:          p.Slug,
		Description:   p.Description,
		PlainContent:  plain,
		CreatedAt:     p.CreatedAt.Unix(),
		UpdatedAt:     p.UpdatedAt.Unix(),
	}
}

func buildCommentDoc(c *repo.PublicCommentWithTarget) meiliCommentDoc {
	authorFull, authorInit := pinyin.Derive(c.Comment.User.Nickname)
	targetFull, _ := pinyin.Derive(c.TargetTitle)
	return meiliCommentDoc{
		ID:                c.Comment.ID,
		UserID:            c.Comment.UserID,
		TargetType:        c.Comment.TargetType,
		TargetID:          c.Comment.TargetID,
		Content:           c.Comment.Content,
		AuthorUsername:    c.Comment.User.Username,
		AuthorNickname:    c.Comment.User.Nickname,
		AuthorPinyin:      authorFull,
		AuthorInitials:    authorInit,
		TargetTitle:       c.TargetTitle,
		TargetTitlePinyin: targetFull,
		CreatedAt:         c.Comment.CreatedAt.Unix(),
	}
}

func buildUserDoc(u *model.User, hasPublicPost bool) meiliUserDoc {
	nickFull, nickInit := pinyin.Derive(u.Nickname)
	return meiliUserDoc{
		ID:               u.ID,
		Username:         u.Username,
		Nickname:         u.Nickname,
		NicknamePinyin:   nickFull,
		NicknameInitials: nickInit,
		Role:             string(u.Role),
		HasPublicPost:    hasPublicPost,
	}
}

func indexSettingsMap() map[string]meili.IndexSettings {
	return map[string]meili.IndexSettings{
		SearchGroupPosts: {
			SearchableAttributes: []string{
				"title", "title_pinyin", "title_initials",
				"slug",
				"labels", "labels_pinyin", "labels_initials",
				"category_name", "category_pinyin", "category_initials",
				"author_nickname", "author_username", "author_pinyin", "author_initials",
				"description", "ai_summary", "plain_content",
			},
			FilterableAttributes: []string{"id", "user_id", "category_id", "label_ids"},
			SortableAttributes:   []string{"created_at", "updated_at", "heat", "view_count", "like_count", "comment_count"},
			TypoTolerance: &meili.TypoTolerance{
				Enabled:             true,
				DisableOnAttributes: []string{"title_initials", "labels_initials", "category_initials", "author_initials", "slug"},
			},
		},
		SearchGroupPages: {
			SearchableAttributes: []string{
				"title", "title_pinyin", "title_initials",
				"slug", "description", "plain_content",
			},
			FilterableAttributes: []string{"id", "user_id", "show_in_nav", "kind"},
			SortableAttributes:   []string{"created_at", "updated_at", "nav_order", "title"},
			TypoTolerance: &meili.TypoTolerance{
				Enabled:             true,
				DisableOnAttributes: []string{"title_initials", "slug"},
			},
		},
		SearchGroupComments: {
			SearchableAttributes: []string{
				"content",
				"author_nickname", "author_username", "author_pinyin", "author_initials",
				"target_title", "target_title_pinyin",
			},
			FilterableAttributes: []string{"id", "user_id", "target_type", "target_id"},
			SortableAttributes:   []string{"created_at"},
			TypoTolerance: &meili.TypoTolerance{
				Enabled:             true,
				DisableOnAttributes: []string{"author_initials"},
			},
		},
		SearchGroupUsers: {
			SearchableAttributes: []string{
				"username", "nickname", "nickname_pinyin", "nickname_initials",
			},
			FilterableAttributes: []string{"id", "role", "has_public_post"},
			SortableAttributes:   []string{"id", "username"},
			TypoTolerance: &meili.TypoTolerance{
				Enabled:             true,
				DisableOnAttributes: []string{"nickname_initials"},
			},
		},
	}
}

// ---- 初始化、全量平滑重建与周期对账 ----

// EnsureSearchReady 确保四个公开索引结构就绪；若索引尚未创建或全空而数据库已有公开数据，则自动启动后台回填
func EnsureSearchReady() {
	if repo.GetDB() == nil {
		return
	}
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	stats, err := client.Stats(ctx)
	if err != nil {
		logrus.Warnf("meilisearch unavailable on startup/config check: %v", err)
		return
	}
	missingAny := false
	var totalDocs int64
	for _, group := range searchGroups {
		idx, exists := stats.Indexes[cfg.IndexUID(group)]
		if !exists {
			missingAny = true
		} else {
			totalDocs += idx.NumberOfDocuments
		}
	}

	stampKey := fmt.Sprintf("%s%s:%s:%s", searchSettingsKeyPrefix, searchSchemaVersion, client.Location(), cfg.IndexPrefix)
	alreadyApplied, _, _ := sharedstate.Current().Get(stampKey)
	if missingAny || alreadyApplied == "" {
		release, locked, err := sharedstate.TryLock("search:init_settings", 30*time.Second)
		if err == nil && locked {
			errApply := applyAllIndexSettings(ctx, client, cfg)
			release()
			if errApply != nil {
				logrus.Warnf("apply meilisearch index settings failed: %v", errApply)
				return
			}
			_ = sharedstate.Current().Set(stampKey, "1", searchSettingsInitTTL)
		}
	}

	// 索引为空时触发一次全量回填（如首次接入已有数据的站点）
	if missingAny || totalDocs == 0 {
		_, _ = TriggerSearchReindex()
	}
}

func applyAllIndexSettings(ctx context.Context, client *meili.Client, cfg tools.MeilisearchConfig) error {
	settingsByGroup := indexSettingsMap()
	for _, group := range searchGroups {
		uid := cfg.IndexUID(group)
		if _, err := client.EnsureIndex(ctx, uid, "id"); err != nil {
			// 已存在时 Meilisearch 也会创建个成功/忽略任务，只有网络或鉴权失败才返回错误
			logrus.Debugf("ensure meilisearch index %s: %v", uid, err)
		}
		if _, err := client.UpdateSettings(ctx, uid, settingsByGroup[group]); err != nil {
			return fmt.Errorf("update settings %s: %w", uid, err)
		}
	}
	return nil
}

// IsSearchReindexing 当前是否有全站索引重建任务在执行中
func IsSearchReindexing() bool {
	val, exists, _ := sharedstate.Current().Get(searchReindexPendingKey)
	return exists && val != ""
}

// TriggerSearchReindex 触发全站公开资源索引平滑重建（多副本互斥，已有任务在跑时直接返回 AlreadyRunning）
func TriggerSearchReindex() (dto.ReindexSearchResp, error) {
	if repo.GetDB() == nil {
		return dto.ReindexSearchResp{}, repo.ErrDatabaseNotInitialized
	}
	_, _, ok := activeMeiliClient(searchWriteTimeout)
	if !ok {
		return dto.ReindexSearchResp{}, fmt.Errorf("meilisearch is not enabled")
	}
	_ = sharedstate.Current().Set(searchReindexPendingKey, "1", 2*time.Hour)
	lease, err := sharedstate.AcquireLease(searchReindexLeaseKey, searchReindexLeaseTTL)
	if err != nil {
		return dto.ReindexSearchResp{}, err
	}
	if lease == nil {
		return dto.ReindexSearchResp{Started: false, AlreadyRunning: true}, nil
	}
	runReindex := func() {
		ctx, cancel := context.WithCancel(context.Background())
		stopWatch := make(chan struct{})
		go func() {
			select {
			case <-lease.Lost():
				cancel()
			case <-stopWatch:
			}
		}()
		defer func() {
			if r := recover(); r != nil {
				logrus.Errorf("search full reindex panicked: %v\n%s", r, debug.Stack())
			}
			close(stopWatch)
			cancel()
			lease.Release()
		}()
		if err := executeFullReindex(ctx); err != nil {
			logrus.Warnf("meilisearch full reindex interrupted or failed: %v", err)
			return
		}
		_ = sharedstate.Current().Delete(searchReindexPendingKey)
	}
	runSearchGoroutine("full_reindex", runReindex)
	return dto.ReindexSearchResp{Started: true}, nil
}

// ResumeSearchReindex 定时故障恢复：若上次重建因实例滚动更新中断，租约过期后由存活实例接手完成
func ResumeSearchReindex() {
	if repo.GetDB() == nil || !IsSearchReindexing() {
		return
	}
	if !tools.GetMeilisearchConfig().Enabled() {
		_ = sharedstate.Current().Delete(searchReindexPendingKey)
		return
	}
	_, _ = TriggerSearchReindex()
}

func executeFullReindex(ctx context.Context) error {
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok {
		return nil
	}
	if err := applyAllIndexSettings(ctx, client, cfg); err != nil {
		return err
	}
	stampKey := fmt.Sprintf("%s%s:%s:%s", searchSettingsKeyPrefix, searchSchemaVersion, client.Location(), cfg.IndexPrefix)
	_ = sharedstate.Current().Set(stampKey, "1", searchSettingsInitTTL)

	// 1. 公开文章
	postIDs := make([]uint, 0)
	for afterID := uint(0); ; {
		if err := ctx.Err(); err != nil {
			return err
		}
		posts, err := repo.ListPublicPostsAfter(afterID, searchReindexBatch)
		if err != nil {
			return err
		}
		if len(posts) == 0 {
			break
		}
		docs := make([]meiliPostDoc, 0, len(posts))
		for i := range posts {
			docs = append(docs, buildPostDoc(&posts[i]))
			postIDs = append(postIDs, posts[i].ID)
			afterID = posts[i].ID
		}
		if _, err := client.UpsertDocuments(ctx, cfg.IndexUID(SearchGroupPosts), "id", docs); err != nil {
			return err
		}
	}
	pruneStaleDocIDs(ctx, client, cfg.IndexUID(SearchGroupPosts), postIDs)

	// 2. 公开页面
	pageIDs := make([]uint, 0)
	for afterID := uint(0); ; {
		if err := ctx.Err(); err != nil {
			return err
		}
		pages, err := repo.ListPublicPagesAfter(afterID, searchReindexBatch)
		if err != nil {
			return err
		}
		if len(pages) == 0 {
			break
		}
		docs := make([]meiliPageDoc, 0, len(pages))
		for i := range pages {
			docs = append(docs, buildPageDoc(&pages[i]))
			pageIDs = append(pageIDs, pages[i].ID)
			afterID = pages[i].ID
		}
		if _, err := client.UpsertDocuments(ctx, cfg.IndexUID(SearchGroupPages), "id", docs); err != nil {
			return err
		}
	}
	pruneStaleDocIDs(ctx, client, cfg.IndexUID(SearchGroupPages), pageIDs)

	// 3. 公开评论（含双重公开校验）
	commentIDs := make([]uint, 0)
	for afterID := uint(0); ; {
		if err := ctx.Err(); err != nil {
			return err
		}
		comments, err := repo.ListPublicCommentsAfter(afterID, searchReindexBatch)
		if err != nil {
			return err
		}
		if len(comments) == 0 {
			break
		}
		docs := make([]meiliCommentDoc, 0, len(comments))
		for i := range comments {
			docs = append(docs, buildCommentDoc(&comments[i]))
			commentIDs = append(commentIDs, comments[i].Comment.ID)
			afterID = comments[i].Comment.ID
		}
		if _, err := client.UpsertDocuments(ctx, cfg.IndexUID(SearchGroupComments), "id", docs); err != nil {
			return err
		}
		if len(comments) < searchReindexBatch {
			break
		}
	}
	pruneStaleDocIDs(ctx, client, cfg.IndexUID(SearchGroupComments), commentIDs)

	// 4. 公开可用用户（最小公开字段）
	userIDs := make([]uint, 0)
	for afterID := uint(0); ; {
		if err := ctx.Err(); err != nil {
			return err
		}
		users, err := repo.ListActiveUsersAfter(afterID, searchReindexBatch)
		if err != nil {
			return err
		}
		if len(users) == 0 {
			break
		}
		batchUIDs := make([]uint, 0, len(users))
		for i := range users {
			batchUIDs = append(batchUIDs, users[i].ID)
		}
		hasPostMap, err := repo.UsersWithPublicPosts(batchUIDs)
		if err != nil {
			return err
		}
		docs := make([]meiliUserDoc, 0, len(users))
		for i := range users {
			docs = append(docs, buildUserDoc(&users[i], hasPostMap[users[i].ID]))
			userIDs = append(userIDs, users[i].ID)
			afterID = users[i].ID
		}
		if _, err := client.UpsertDocuments(ctx, cfg.IndexUID(SearchGroupUsers), "id", docs); err != nil {
			return err
		}
	}
	pruneStaleDocIDs(ctx, client, cfg.IndexUID(SearchGroupUsers), userIDs)

	logrus.Infof("meilisearch reindex completed: posts=%d pages=%d comments=%d users=%d",
		len(postIDs), len(pageIDs), len(commentIDs), len(userIDs))
	return nil
}

// fetchIndexedIDs 读取某个索引中现有的全部文档主键
func fetchIndexedIDs(ctx context.Context, client *meili.Client, uid string) ([]uint, error) {
	var all []uint
	for offset := 0; ; offset += searchFetchDocBatch {
		var rows []struct {
			ID uint `json:"id"`
		}
		total, err := client.FetchDocuments(ctx, uid, offset, searchFetchDocBatch, []string{"id"}, &rows)
		if err != nil {
			if meili.IsIndexNotFound(err) {
				return nil, nil
			}
			return nil, err
		}
		for _, r := range rows {
			if r.ID > 0 {
				all = append(all, r.ID)
			}
		}
		if len(rows) == 0 || int64(offset+len(rows)) >= total {
			break
		}
	}
	return all, nil
}

func pruneStaleDocIDs(ctx context.Context, client *meili.Client, uid string, validSortedIDs []uint) {
	indexed, err := fetchIndexedIDs(ctx, client, uid)
	if err != nil || len(indexed) == 0 {
		return
	}
	validSet := make(map[uint]struct{}, len(validSortedIDs))
	for _, id := range validSortedIDs {
		validSet[id] = struct{}{}
	}
	var stale []uint
	for _, id := range indexed {
		if _, ok := validSet[id]; !ok {
			stale = append(stale, id)
		}
	}
	if len(stale) > 0 {
		if _, err := client.DeleteDocuments(ctx, uid, stale); err != nil {
			logrus.Warnf("prune stale docs from %s failed: %v", uid, err)
		}
	}
}

// ReconcileSearchIndexes 定时轻量对账：补齐偶发网络抖动漏写的公开文档、清理已转私密或已删除的残留文档
func ReconcileSearchIndexes() {
	if repo.GetDB() == nil || IsSearchReindexing() {
		return
	}
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// 先确保索引存在
	EnsureSearchReady()
	if IsSearchReindexing() {
		return
	}

	reconcileGroup := func(group string, loadValid func() ([]uint, error), syncOne func(uint)) {
		validIDs, err := loadValid()
		if err != nil {
			return
		}
		uid := cfg.IndexUID(group)
		indexedIDs, err := fetchIndexedIDs(ctx, client, uid)
		if err != nil {
			return
		}
		indexedSet := make(map[uint]struct{}, len(indexedIDs))
		for _, id := range indexedIDs {
			indexedSet[id] = struct{}{}
		}
		validSet := make(map[uint]struct{}, len(validIDs))
		for _, id := range validIDs {
			validSet[id] = struct{}{}
			if _, ok := indexedSet[id]; !ok {
				syncOne(id)
			}
		}
		var stale []uint
		for _, id := range indexedIDs {
			if _, ok := validSet[id]; !ok {
				stale = append(stale, id)
			}
		}
		if len(stale) > 0 {
			_, _ = client.DeleteDocuments(ctx, uid, stale)
		}
	}

	reconcileGroup(SearchGroupPosts, repo.ListPublicPostIDs, syncPostNow)
	reconcileGroup(SearchGroupPages, repo.ListPublicPageIDs, syncPageNow)
	reconcileGroup(SearchGroupComments, repo.ListPublicCommentIDs, syncCommentNow)
	reconcileGroup(SearchGroupUsers, repo.ListActiveUserIDs, syncUserNow)
}

// ---- 写路径实时增量同步钩子（物理保证私密资源立即移除、公开资源即时更新） ----

func syncPostNow(postID uint) {
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok || postID == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), searchWriteTimeout)
	defer cancel()

	post, err := repo.GetPublicPostForIndex(postID)
	if err != nil {
		logrus.Warnf("load post %d for search index failed: %v", postID, err)
		return
	}
	postUID := cfg.IndexUID(SearchGroupPosts)
	commentUID := cfg.IndexUID(SearchGroupComments)
	if post == nil {
		// 文章不存在、已删除或已设为私密：物理移除该文章及其下所有公开评论索引
		_, _ = client.DeleteDocument(ctx, postUID, strconv.FormatUint(uint64(postID), 10))
		_, _ = client.DeleteByFilter(ctx, commentUID, fmt.Sprintf(`target_type = "%s" AND target_id = %d`, constant.TargetTypePost, postID))
		return
	}
	doc := buildPostDoc(post)
	if _, err := client.UpsertDocuments(ctx, postUID, "id", []meiliPostDoc{doc}); err != nil {
		logrus.Warnf("upsert post %d to meilisearch failed: %v", postID, err)
	}
}

func syncTargetCommentsNow(targetType string, targetID uint) {
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok || targetID == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), searchWriteTimeout)
	defer cancel()

	commentUID := cfg.IndexUID(SearchGroupComments)
	items, err := repo.ListPublicCommentsByTarget(targetType, targetID)
	if err != nil {
		logrus.Warnf("load target comments %s:%d failed: %v", targetType, targetID, err)
		return
	}
	if len(items) == 0 {
		_, _ = client.DeleteByFilter(ctx, commentUID, fmt.Sprintf(`target_type = "%s" AND target_id = %d`, targetType, targetID))
		return
	}
	docs := make([]meiliCommentDoc, 0, len(items))
	for i := range items {
		docs = append(docs, buildCommentDoc(&items[i]))
	}
	if _, err := client.UpsertDocuments(ctx, commentUID, "id", docs); err != nil {
		logrus.Warnf("upsert target comments %s:%d failed: %v", targetType, targetID, err)
	}
}

func syncPageNow(pageID uint) {
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok || pageID == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), searchWriteTimeout)
	defer cancel()

	page, err := repo.GetPublicPageForIndex(pageID)
	if err != nil {
		logrus.Warnf("load page %d for search index failed: %v", pageID, err)
		return
	}
	pageUID := cfg.IndexUID(SearchGroupPages)
	commentUID := cfg.IndexUID(SearchGroupComments)
	if page == nil {
		_, _ = client.DeleteDocument(ctx, pageUID, strconv.FormatUint(uint64(pageID), 10))
		_, _ = client.DeleteByFilter(ctx, commentUID, fmt.Sprintf(`target_type = "%s" AND target_id = %d`, constant.TargetTypePage, pageID))
		return
	}
	doc := buildPageDoc(page)
	if _, err := client.UpsertDocuments(ctx, pageUID, "id", []meiliPageDoc{doc}); err != nil {
		logrus.Warnf("upsert page %d to meilisearch failed: %v", pageID, err)
	}
}

func syncCommentNow(commentID uint) {
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok || commentID == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), searchWriteTimeout)
	defer cancel()

	item, err := repo.GetPublicCommentForIndex(commentID)
	if err != nil {
		logrus.Warnf("load comment %d for search index failed: %v", commentID, err)
		return
	}
	uid := cfg.IndexUID(SearchGroupComments)
	if item == nil {
		_, _ = client.DeleteDocument(ctx, uid, strconv.FormatUint(uint64(commentID), 10))
		return
	}
	doc := buildCommentDoc(item)
	if _, err := client.UpsertDocuments(ctx, uid, "id", []meiliCommentDoc{doc}); err != nil {
		logrus.Warnf("upsert comment %d to meilisearch failed: %v", commentID, err)
	}
}

func syncUserNow(userID uint) {
	client, cfg, ok := activeMeiliClient(searchWriteTimeout)
	if !ok || userID == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), searchWriteTimeout)
	defer cancel()

	u, err := repo.GetActiveUserForIndex(userID)
	if err != nil {
		logrus.Warnf("load user %d for search index failed: %v", userID, err)
		return
	}
	uid := cfg.IndexUID(SearchGroupUsers)
	if u == nil {
		_, _ = client.DeleteDocument(ctx, uid, strconv.FormatUint(uint64(userID), 10))
		return
	}
	hasPostMap, err := repo.UsersWithPublicPosts([]uint{userID})
	if err != nil {
		logrus.Warnf("check user %d public posts failed: %v", userID, err)
		return
	}
	doc := buildUserDoc(u, hasPostMap[userID])
	if _, err := client.UpsertDocuments(ctx, uid, "id", []meiliUserDoc{doc}); err != nil {
		logrus.Warnf("upsert user %d to meilisearch failed: %v", userID, err)
	}
}

// SyncSearchPost 异步同步单篇文章索引（含可见性翻转与作者公开文章标记联动）
func SyncSearchPost(postID, authorID uint, syncComments bool) {
	runSearchAsync(func() {
		syncPostNow(postID)
		if syncComments {
			syncTargetCommentsNow(constant.TargetTypePost, postID)
		}
		if authorID > 0 {
			syncUserNow(authorID)
		}
	})
}

// SyncSearchPostsByIDs 批量异步刷新指定公开文章索引（如分类或标签改名、删除后）
func SyncSearchPostsByIDs(postIDs []uint) {
	if len(postIDs) == 0 {
		return
	}
	ids := slices.Clone(postIDs)
	runSearchAsync(func() {
		for _, id := range ids {
			syncPostNow(id)
		}
	})
}

// SyncSearchPage 异步同步单个独立页面索引（含评论可见性联动）
func SyncSearchPage(pageID uint, syncComments bool) {
	runSearchAsync(func() {
		syncPageNow(pageID)
		if syncComments {
			syncTargetCommentsNow(constant.TargetTypePage, pageID)
		}
	})
}

// SyncSearchComment 异步同步单条评论索引
func SyncSearchComment(commentID uint) {
	runSearchAsync(func() {
		syncCommentNow(commentID)
	})
}

// DeleteSearchCommentAndReplies 评论删除后（含子回复一并被删）按对账或指定 ID 移除评论索引
func DeleteSearchComment(commentID, targetID uint, targetType string) {
	runSearchAsync(func() {
		syncCommentNow(commentID)
		// 删除父评论会级联删除子回复，直接重刷该目标下的公开评论并删除失效项
		if targetID > 0 && targetType != "" {
			client, cfg, ok := activeMeiliClient(searchWriteTimeout)
			if !ok {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), searchWriteTimeout)
			defer cancel()
			items, err := repo.ListPublicCommentsByTarget(targetType, targetID)
			if err != nil {
				return
			}
			commentUID := cfg.IndexUID(SearchGroupComments)
			_, _ = client.DeleteByFilter(ctx, commentUID, fmt.Sprintf(`target_type = "%s" AND target_id = %d`, targetType, targetID))
			if len(items) > 0 {
				docs := make([]meiliCommentDoc, 0, len(items))
				for i := range items {
					docs = append(docs, buildCommentDoc(&items[i]))
				}
				_, _ = client.UpsertDocuments(ctx, commentUID, "id", docs)
			}
		}
	})
}

// SyncSearchUser 异步同步用户索引；profileChanged 为 true 时一并刷新该用户公开文章与公开评论上的作者昵称/拼音
func SyncSearchUser(userID uint, profileChanged bool) {
	runSearchAsync(func() {
		syncUserNow(userID)
		if !profileChanged {
			return
		}
		if postIDs, err := repo.ListPublicPostIDsByUser(userID); err == nil {
			for _, id := range postIDs {
				syncPostNow(id)
			}
		}
		if commentIDs, err := repo.ListPublicCommentIDsByUser(userID); err == nil {
			for _, id := range commentIDs {
				syncCommentNow(id)
			}
		}
	})
}

// SyncSearchUserDeleted 用户被删除（其文章/页面转交管理员，评论及子回复被删）后清理用户与评论索引，并刷新转交后的资源
func SyncSearchUserDeleted(deletedUserID, newOwnerID uint) {
	runSearchAsync(func() {
		client, cfg, ok := activeMeiliClient(searchWriteTimeout)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), searchWriteTimeout)
		defer cancel()
		_, _ = client.DeleteDocument(ctx, cfg.IndexUID(SearchGroupUsers), strconv.FormatUint(uint64(deletedUserID), 10))
		_, _ = client.DeleteByFilter(ctx, cfg.IndexUID(SearchGroupComments), fmt.Sprintf("user_id = %d", deletedUserID))
		if newOwnerID > 0 {
			syncUserNow(newOwnerID)
			if postIDs, err := repo.ListPublicPostIDsByUser(newOwnerID); err == nil {
				for _, id := range postIDs {
					syncPostNow(id)
				}
			}
			if pageIDs, err := repo.ListPublicPageIDs(); err == nil {
				for _, id := range pageIDs {
					syncPageNow(id)
				}
			}
		}
		// 对账清理被级联删除的子回复评论
		ReconcileSearchIndexes()
	})
}
