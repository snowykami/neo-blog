package repo

import (
	"errors"
	"slices"
	"sort"
	"strconv"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type postRepo struct{}

var Post = &postRepo{}

func (p *postRepo) CreatePost(post *model.Post) error {
	if err := GetDB().Create(post).Error; err != nil {
		return err
	}
	InvalidatePostCache()
	return nil
}

// DeletePost 软删除文章，同时清理评论、点赞、相关通知和标签关联，并释放 slug 以便新文章复用；
// 返回被删通知的收件人，调用方在事务提交后推送，让他们的未读徽标随之更新
func (p *postRepo) DeletePost(id uint) ([]uint, error) {
	defer InvalidatePostCache()
	var notified []uint
	err := GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Post{}).Where("id = ?", id).UpdateColumn("slug", nil).Error; err != nil {
			return err
		}
		var err error
		if notified, err = deleteTargetComments(tx, constant.TargetTypePost, id); err != nil {
			return err
		}
		if err := tx.Unscoped().Where("target_type = ? AND target_id = ?", constant.TargetTypePost, id).Delete(&model.Like{}).Error; err != nil {
			return err
		}
		if err := tx.Table("post_labels").Where("post_id = ?", id).Delete(nil).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.Post{}).Error
	})
	if err != nil {
		return nil, err
	}
	return notified, nil
}

// helper: 批量查询 labels 对应的 post 数量（返回 map[labelID]count）
func fetchLabelPostCounts(db *gorm.DB, labelIDs []uint) (map[uint]int64, error) {
	counts := make([]struct {
		LabelID uint  `gorm:"column:label_id"`
		Cnt     int64 `gorm:"column:cnt"`
	}, 0)

	if len(labelIDs) == 0 {
		return map[uint]int64{}, nil
	}

	// 只统计未删除的公开文章
	if err := db.Table("post_labels").
		Select("post_labels.label_id, COUNT(post_labels.post_id) as cnt").
		Joins("JOIN posts ON posts.id = post_labels.post_id AND posts.deleted_at IS NULL AND posts.is_private = ?", false).
		Where("post_labels.label_id IN ?", labelIDs).
		Group("post_labels.label_id").
		Find(&counts).Error; err != nil {
		return nil, err
	}

	m := make(map[uint]int64, len(counts))
	for _, r := range counts {
		m[r.LabelID] = r.Cnt
	}
	// ensure zeros for missing ids
	for _, id := range labelIDs {
		if _, ok := m[id]; !ok {
			m[id] = 0
		}
	}
	return m, nil
}

// 把 labels 按照 global post count 排序（降序）
func sortLabelsByPostCount(db *gorm.DB, labels []model.Label) error {
	if len(labels) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(labels))
	for _, l := range labels {
		ids = append(ids, l.ID)
	}
	countMap, err := fetchLabelPostCounts(db, ids)
	if err != nil {
		return err
	}
	sort.Slice(labels, func(i, j int) bool {
		ci := countMap[labels[i].ID]
		cj := countMap[labels[j].ID]
		if ci == cj {
			// 保持稳定顺序：按 ID 升序作为二次排序（可改）
			return labels[i].ID < labels[j].ID
		}
		return ci > cj
	})
	return nil
}

// PostMeta 文章的权限相关字段
type PostMeta struct {
	ID        uint
	UserID    uint
	IsPrivate bool
}

// GetPostMeta 只读取权限判断需要的字段，供评论、点赞等流程使用，避免加载正文与关联
func (p *postRepo) GetPostMeta(id uint) (*PostMeta, error) {
	var meta PostMeta
	if err := GetDB().Model(&model.Post{}).Select("id, user_id, is_private").Where("id = ?", id).Take(&meta).Error; err != nil {
		return nil, err
	}
	return &meta, nil
}

// GetPostByID 按 id 加载文章（含关联），不增加浏览量，供编辑、删除、评论等内部流程使用
// ListPostsForAISummary 全站 AI 摘要所需的字段（不含已删除文章）
func (p *postRepo) ListPostsForAISummary() ([]model.Post, error) {
	var posts []model.Post
	err := GetDB().Model(&model.Post{}).
		Select("id", "title", "content", "description", "content_hash", "ai_summary", "ai_summary_source_hash").
		Order("id ASC").
		Find(&posts).Error
	return posts, err
}

// GetPublicPostStats 公开文章的浏览量、点赞数、评论数：只读这三列；私密或不存在的文章返回 gorm.ErrRecordNotFound
func (p *postRepo) GetPublicPostStats(id uint) (*dto.PostStatsDto, error) {
	var stats dto.PostStatsDto
	err := GetDB().Model(&model.Post{}).Select("view_count", "like_count", "comment_count").
		Where("id = ? AND is_private = ?", id, false).Take(&stats).Error
	if err != nil {
		return nil, err
	}
	return &stats, nil
}

// GetPublicPostContentHash 公开文章的正文哈希：外链白名单命中缓存时不必读取整篇正文
func (p *postRepo) GetPublicPostContentHash(id uint) (string, error) {
	var row struct {
		ContentHash string
	}
	err := GetDB().Model(&model.Post{}).Select("content_hash").
		Where("id = ? AND is_private = ?", id, false).Take(&row).Error
	if err != nil {
		return "", err
	}
	return row.ContentHash, nil
}

// GetPublicPostContent 公开文章的正文与哈希，供外链预览白名单提取使用；私密或不存在时返回 gorm.ErrRecordNotFound
func (p *postRepo) GetPublicPostContent(id uint) (string, string, error) {
	var row struct {
		Content     string
		ContentHash string
	}
	err := GetDB().Model(&model.Post{}).Select("content", "content_hash").
		Where("id = ? AND is_private = ?", id, false).Take(&row).Error
	if err != nil {
		return "", "", err
	}
	return row.Content, row.ContentHash, nil
}

func (p *postRepo) GetPostByID(id uint) (*model.Post, error) {
	var post model.Post
	if err := GetDB().Preload(clause.Associations).First(&post, id).Error; err != nil {
		return nil, err
	}
	// 与 GetPostBySlugOrID 保持一致：labels 按全局 post 数量排序
	if err := sortLabelsByPostCount(GetDB(), post.Labels); err != nil {
		return nil, err
	}
	return &post, nil
}

func (p *postRepo) GetPostBySlugOrID(slugOrId string) (*model.Post, error) {
	var post model.Post

	// 先按 slug 查找（优先）
	if err := GetDB().Where("slug = ?", slugOrId).Preload(clause.Associations).First(&post).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		// slug 未命中，尝试当作 id
		id, perr := strconv.ParseUint(slugOrId, 10, 64)
		if perr != nil {
			// 既不是存在的 slug，也不是合法 id
			return nil, err
		}
		if err := GetDB().Preload(clause.Associations).First(&post, uint(id)).Error; err != nil {
			return nil, err
		}
	}

	// 如果有 labels，按全局 post 数量排序
	if len(post.Labels) > 0 {
		if err := sortLabelsByPostCount(GetDB(), post.Labels); err != nil {
			// 不致命，记录或返回错误视业务而定；这里选择返回错误以便上层感知
			return nil, err
		}
	}

	// 浏览量由访问上报去重后累加（见 IncreaseViewCount），读取文章不再写库
	return &post, nil
}

// 示例：ListTopPosts 在加载 posts 后，对每个 post 的 labels 进行排序
func (p *postRepo) ListTopPosts(limit int) ([]model.Post, error) {
	var posts []model.Post

	// 这里假设已有查询逻辑填充 posts，并 preload 了 labels
	if err := GetDB().Order("view_count desc").Limit(limit).Preload("Labels").Find(&posts).Error; err != nil {
		return nil, err
	}

	// 收集所有 label ids，批量查询 counts 一次性完成
	allLabelIDsSet := make(map[uint]struct{})
	for _, post := range posts {
		for _, l := range post.Labels {
			allLabelIDsSet[l.ID] = struct{}{}
		}
	}
	allLabelIDs := make([]uint, 0, len(allLabelIDsSet))
	for id := range allLabelIDsSet {
		allLabelIDs = append(allLabelIDs, id)
	}

	// 获取全局 counts
	countMap, err := fetchLabelPostCounts(GetDB(), allLabelIDs)
	if err != nil {
		return nil, err
	}

	// 按 count 为每个 post 的 labels 排序（使用相同逻辑）
	for pi := range posts {
		sort.Slice(posts[pi].Labels, func(i, j int) bool {
			ci := countMap[posts[pi].Labels[i].ID]
			cj := countMap[posts[pi].Labels[j].ID]
			if ci == cj {
				return posts[pi].Labels[i].ID < posts[pi].Labels[j].ID
			}
			return ci > cj
		})
	}

	return posts, nil
}

// SavePost 更新已有文章的元信息：只写入 columns 中的列（数据库列名），replaceLabels 为 true 时按 post.Labels 重写标签
// 不整行保存：post 是请求开始时读到的快照，整行写回会用旧值覆盖期间其他请求写入的正文、草稿、版本号与计数
func (p *postRepo) SavePost(post *model.Post, columns []string, replaceLabels bool) error {
	if post.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	err := GetDB().Transaction(func(tx *gorm.DB) error {
		return updatePostTx(tx, post, columns, replaceLabels)
	})
	invalidateAfterPostSave(err, columns, replaceLabels)
	return err
}

// SavePostWithDraftVersion 保存文章并把草稿版本号从 expected 加一（写入正文时使用），columns 与 replaceLabels 同 SavePost
// 版本号已不是 expected（读取之后有其他写入）时不保存，返回 ErrDraftVersionConflict；比较与加一在同一条语句中完成，多副本下同样可靠
func (p *postRepo) SavePostWithDraftVersion(post *model.Post, expected uint64, columns []string, replaceLabels bool) error {
	if post.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	err := GetDB().Transaction(func(tx *gorm.DB) error {
		if err := bumpDraftVersion(tx, &model.Post{}, post.ID, expected); err != nil {
			return err
		}
		post.DraftVersion = expected + 1
		return updatePostTx(tx, post, columns, replaceLabels)
	})
	invalidateAfterPostSave(err, columns, replaceLabels)
	return err
}

// draftOnlyContentColumns 只有后台编辑器看得到的列（草稿正文）：前台的文章、页面接口与缓存都不含它们
var draftOnlyContentColumns = []string{"draft_content"}

// touchesPublicColumns 本次保存是否写入了前台可见的数据：改了标签，或写入了草稿之外的任何列。
// 按「草稿列白名单」反向判断：以后新增的列默认当作公开字段，宁可多失效一次也不让前台停在旧数据上
func touchesPublicColumns(columns []string, replaceLabels bool) bool {
	if replaceLabels {
		return true
	}
	for _, column := range columns {
		if !slices.Contains(draftOnlyContentColumns, column) {
			return true
		}
	}
	return false
}

// invalidateAfterPostSave 保存成功且写入了公开字段时才让文章缓存失效：编辑器自动保存草稿很频繁，
// 每次都清空全站文章缓存（含跨实例广播与前端缓存标签）会让写作期间首页、归档一直重新渲染；
// 保存失败（含草稿版本冲突）时库里没有变化，也不失效
func invalidateAfterPostSave(err error, columns []string, replaceLabels bool) {
	if err == nil && touchesPublicColumns(columns, replaceLabels) {
		InvalidatePostCache()
	}
}

// savedColumns 按列更新时要写入与排除的列：写入了前台可见的数据才刷新更新时间，只保存草稿时不改（前台显示的「更新于」是公开内容的修改时间）
// GORM 按列更新时即使没选 updated_at 也会自动写入，因此只存草稿时要显式排除；关联字段一律不随更新写入。
// 排除列要一次传给 Omit：多次调用 Omit 后一次会覆盖前一次
func savedColumns(columns []string, replaceLabels bool) (selected, omitted []string) {
	if touchesPublicColumns(columns, replaceLabels) {
		return append([]string{"updated_at"}, columns...), []string{clause.Associations}
	}
	return columns, []string{clause.Associations, "updated_at"}
}

// updatePostTx 按列更新文章；写入正文时一并写入正文哈希（由 BeforeSave 计算），只改标签时也刷新更新时间
func updatePostTx(tx *gorm.DB, post *model.Post, columns []string, replaceLabels bool) error {
	if len(columns) > 0 {
		selected, omitted := savedColumns(columns, replaceLabels)
		if slices.Contains(columns, "content") {
			selected = append(selected, "content_hash", "excerpt")
		}
		// 关联字段不随更新写入，否则已加载的 Category 会把清空的 category_id 写回去
		if err := tx.Model(post).Omit(omitted...).Select(selected).Updates(post).Error; err != nil {
			return err
		}
	} else if replaceLabels {
		// 只改标签：刷新更新时间
		if err := tx.Model(post).Omit(clause.Associations).Select("updated_at").Updates(post).Error; err != nil {
			return err
		}
	}
	if !replaceLabels {
		return nil
	}
	// 关联只会追加不会删除已移除的标签，需要显式 Replace
	return tx.Model(post).Association("Labels").Replace(post.Labels)
}

// ListPosts 列出文章；includePrivate 为 true 时包含私密文章，仅供后台管理（全站或限定 req.UserID 为本人），前台一律传 false
func (p *postRepo) ListPosts(includePrivate bool, query []string, req *dto.ListPostReq) ([]model.Post, int64, error) {
	if !slices.Contains(constant.OrderByEnumPost, req.OrderBy) {
		return nil, 0, errs.NewBadRequest("invalid_request_parameters")
	}

	// 列表只需要作者、分类和标签，不加载协作者
	q := GetDB().Model(&model.Post{}).Preload("User").Preload("Category").Preload("Labels")
	if req.UserID > 0 {
		q = q.Where("posts.user_id = ?", req.UserID)
	}

	q = visiblePosts(q, includePrivate)
	// 首页默认列表：置顶文章另外返回，这里排除，置顶不占分页名额也不重复出现
	if req.HomeListing() {
		q = q.Where("NOT ("+activePinnedCondition+")", time.Now())
	}

	if req.Label != "" {
		var labelModel model.Label
		if err := GetDB().Where("name = ? OR slug = ?", req.Label, req.Label).First(&labelModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// 标签不存在，直接返回空结果
				return []model.Post{}, 0, nil
			}
			return nil, 0, err
		}
		q = q.Joins("JOIN post_labels ON post_labels.post_id = posts.id").
			Where("post_labels.label_id = ?", labelModel.ID)
	}

	if req.Category != "" {
		var categoryModel model.Category
		if err := GetDB().Where("name = ? OR slug = ?", req.Category, req.Category).First(&categoryModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return []model.Post{}, 0, nil
			}
			return nil, 0, err
		}
		q = q.Where("category_id = ?", categoryModel.ID)
	}

	if len(query) > 0 {
		for _, q_item := range query {
			if q_item != "" {
				q = q.Where("title LIKE ? OR content LIKE ?",
					"%"+q_item+"%", "%"+q_item+"%")
			}
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, 0, err
	}

	// 列表不读取草稿和正文，摘要用保存时生成的纯文本摘要列（见 model.Post.Excerpt）
	columns := slices.Clone(postListColumns)
	if !req.NoContent {
		columns = append(columns, "posts.excerpt")
	}
	items, err := paginate[model.Post](q.Select(columns), req.Page, req.Size, "posts."+req.OrderBy, req.Desc)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// postListColumns 文章列表需要的字段：不读正文与草稿（摘要另读 posts.excerpt）
var postListColumns = []string{"posts.id", "posts.created_at", "posts.updated_at", "posts.deleted_at", "posts.user_id",
	"posts.category_id", "posts.cover", "posts.description", "posts.is_private", "posts.slug", "posts.title",
	"posts.type", "posts.pinned_at", "posts.pinned_until", "posts.like_count", "posts.comment_count", "posts.view_count", "posts.heat",
	"posts.content_hash", "posts.ai_summary", "posts.ai_summary_source_hash", "posts.ai_summary_at"}

// postCardColumns 文章引用卡片需要的字段：不读正文、草稿与背景
var postCardColumns = []string{
	"posts.id", "posts.created_at", "posts.updated_at", "posts.user_id", "posts.category_id",
	"posts.cover", "posts.description", "posts.slug", "posts.title", "posts.type",
	"posts.like_count", "posts.view_count",
}

// ListPostCardsByIDs 按 id 批量读取文章引用卡片需要的数据（含作者与分类）
// 卡片出现在前台正文里，只返回公开文章，不看当前用户是谁；私密与已删除的文章不在结果里
func (p *postRepo) ListPostCardsByIDs(ids []uint) ([]model.Post, error) {
	if len(ids) == 0 {
		return []model.Post{}, nil
	}
	var posts []model.Post
	q := GetDB().Model(&model.Post{}).Select(postCardColumns).
		Preload("User").Preload("Category").
		Where("posts.id IN ?", ids)
	if err := visiblePosts(q, false).Find(&posts).Error; err != nil {
		return nil, err
	}
	return posts, nil
}

// ListPublicContentsWithComponents 公开文章（不含私密与草稿）中带内容组件的正文，用于找出文章引用的网易云歌曲（见 service/music_whitelist.go）
func (p *postRepo) ListPublicContentsWithComponents() ([]string, error) {
	var contents []string
	err := GetDB().Model(&model.Post{}).Where("is_private = ? AND content LIKE ?", false, "%data-component%").Pluck("content", &contents).Error
	return contents, err
}

// ListCategories 全部文章分类，新的在前
func (p *postRepo) ListCategories() ([]model.Category, error) {
	var categories []model.Category
	err := GetDB().Order("id DESC").Find(&categories).Error
	return categories, err
}

// activePinnedCondition 此刻置顶在首页：已置顶且没有到期（参数为当前时间）
const activePinnedCondition = "posts.pinned_at IS NOT NULL AND (posts.pinned_until IS NULL OR posts.pinned_until > ?)"

// visiblePosts 私密文章只在后台出现：前台查询（includePrivate 为 false）只留公开文章，不论当前用户是谁，
// 前台数据因此对所有人一致；后台管理视图不过滤
func visiblePosts(q *gorm.DB, includePrivate bool) *gorm.DB {
	if includePrivate {
		return q
	}
	return q.Where("posts.is_private = ?", false)
}

// ListPinnedPosts 此刻置顶在首页的文章，后置顶的在前；includePrivate 为 false（前台）时只含公开文章；只读取列表需要的字段（不含正文）
func (p *postRepo) ListPinnedPosts(includePrivate bool, now time.Time, limit int) ([]model.Post, error) {
	var posts []model.Post
	q := GetDB().Model(&model.Post{}).Preload("User").Preload("Category").Preload("Labels").
		Select(append(slices.Clone(postListColumns), "posts.excerpt")).
		Where(activePinnedCondition, now)
	err := visiblePosts(q, includePrivate).
		Order("posts.pinned_at DESC").Order("posts.id DESC").
		Limit(limit).
		Find(&posts).Error
	return posts, err
}

// CountPinnedPosts 此刻置顶在首页的文章数（含私密文章），不计 excludeID
func (p *postRepo) CountPinnedPosts(now time.Time, excludeID uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.Post{}).Where(activePinnedCondition, now).Where("id <> ?", excludeID).Count(&count).Error
	return count, err
}

// SetPostPin 写入文章的置顶时间与到期时间（都为 nil 表示取消置顶）
func (p *postRepo) SetPostPin(id uint, pinnedAt, pinnedUntil *time.Time) error {
	defer InvalidatePostCache()
	return GetDB().Model(&model.Post{}).Where("id = ?", id).
		UpdateColumns(map[string]any{"pinned_at": pinnedAt, "pinned_until": pinnedUntil}).Error
}
