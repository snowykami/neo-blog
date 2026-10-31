package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// 版本类型
const (
	RevisionKindPublish  = "publish"  // 发布
	RevisionKindSession  = "session"  // 打开编辑器时（编辑起点）
	RevisionKindAutosave = "autosave" // 自动保存的检查点
	RevisionKindBackup   = "backup"   // 恢复 / 放弃修改前的备份
)

// 受保护版本的原因：这些版本不能删除，也不会被自动清理
const (
	RevisionProtectedPublished = "published" // 最近的发布版本，即当前发布的内容
	RevisionProtectedLatest    = "latest"    // 最新版本，即当前的草稿
	RevisionProtectedBase      = "base"      // 当前编辑会话的编辑起点，“放弃本次修改”恢复到该版本
)

const (
	revisionAutosaveInterval = 10 * time.Minute // 自动保存检查点的最小间隔
	revisionEmptyContent     = "<p></p>"        // 空正文：草稿字段为空字符串时不会被更新，用空段落代替
	revisionBatchDeleteMax   = 1000             // 一次批量删除的版本数上限
)

// RevisionService 文章 / 页面的版本历史
type RevisionService struct{}

func NewRevisionService() *RevisionService {
	return &RevisionService{}
}

type revisionSnapshot struct {
	title   string
	content string
	meta    dto.RevisionMeta
}

// snapshot 当前状态：正文取草稿（没有草稿时取已发布正文），元信息取当前值
func (s *RevisionService) snapshot(targetType string, targetID uint) (*revisionSnapshot, error) {
	switch targetType {
	case constant.TargetTypePost:
		post, err := repo.Post.GetPostByID(targetID)
		if err != nil {
			return nil, err
		}
		labelIDs := make([]uint, 0, len(post.Labels))
		for _, label := range post.Labels {
			labelIDs = append(labelIDs, label.ID)
		}
		var slug *string
		if post.Slug != nil {
			v := *post.Slug
			slug = &v
		}
		return &revisionSnapshot{
			title:   post.Title,
			content: currentDraft(post.DraftContent, post.Content),
			meta: dto.RevisionMeta{
				Title: post.Title, Description: post.Description, Cover: post.Cover, Slug: slug, IsPrivate: post.IsPrivate,
				BackgroundImage: post.BackgroundImage,
				CategoryID:      post.CategoryID, LabelIds: labelIDs, Top: post.Top,
			},
		}, nil
	case constant.TargetTypePage:
		page, err := repo.Page.GetPageByID(targetID)
		if err != nil {
			return nil, err
		}
		slug := page.Slug
		return &revisionSnapshot{
			title:   page.Title,
			content: currentDraft(page.DraftContent, page.Content),
			meta: dto.RevisionMeta{
				Title: page.Title, Description: page.Description, Cover: page.Cover, Slug: &slug, IsPrivate: page.IsPrivate,
				ShowInNav: page.ShowInNav, NavOrder: page.NavOrder, Layout: model.NormalizePageLayout(page.Layout),
				Fullscreen: &page.Fullscreen,
			},
		}, nil
	}
	return nil, errors.New("invalid target type")
}

func currentDraft(draft *string, content string) string {
	if draft != nil && *draft != "" {
		return *draft
	}
	return content
}

// countWords 正文去掉标签与空白后的字数
func countWords(content string) int {
	n := 0
	for _, r := range htmlToPlainText(content) {
		if !unicode.IsSpace(r) {
			n++
		}
	}
	return n
}

// record 记录当前状态为一个版本，返回该版本（内容与最新版本相同时复用最新版本）
// 自动保存的检查点距上一个版本不足间隔时跳过，返回 nil
// 通过 API Token 的写入记录 Token，便于在版本历史中区分外部 AI 工具的修改
func (s *RevisionService) record(ctx context.Context, targetType string, targetID uint, kind, sessionID string) (*model.ContentRevision, error) {
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	tokenID := ctxutils.GetAPITokenID(ctx)
	snap, err := s.snapshot(targetType, targetID)
	if err != nil {
		return nil, err
	}
	metaJSON, _ := json.Marshal(snap.meta)
	sum := sha256.Sum256([]byte(snap.content + "\x00" + string(metaJSON)))
	hash := hex.EncodeToString(sum[:])

	latest, err := repo.Revision.Latest(targetType, targetID)
	if err != nil {
		return nil, err
	}
	if latest != nil && latest.Hash == hash && !(kind == RevisionKindPublish && latest.Kind != RevisionKindPublish) {
		return latest, nil
	}
	// 外部 AI 工具的每次写入都单独记录，便于逐次回溯；编辑页的自动保存按间隔记录
	if kind == RevisionKindAutosave && tokenID == 0 && latest != nil && time.Since(latest.CreatedAt) < revisionAutosaveInterval {
		return nil, nil
	}
	revision := &model.ContentRevision{
		TargetType:    targetType,
		TargetID:      targetID,
		Kind:          kind,
		EditSessionID: sessionID,
		UserID:        userID,
		APITokenID:    utils.Ternary(tokenID != 0, &tokenID, nil),
		Title:         snap.title,
		Content:       snap.content,
		Meta:          string(metaJSON),
		Hash:          hash,
		WordCount:     countWords(snap.content),
	}
	if err := repo.Revision.Create(revision); err != nil {
		return nil, err
	}
	// 发布版本同样计入上限：频繁发布不会让版本无限增长
	if _, err := s.prune(targetType, targetID); err != nil {
		logrus.Warnf("prune revisions of %s %d failed: %v", targetType, targetID, err)
	}
	return revision, nil
}

// protectedRevisions 目标中受保护的版本：版本 ID → 原因
// 同一版本有多个原因时取一个，优先级为当前发布 > 最新 > 编辑起点
func (s *RevisionService) protectedRevisions(targetType string, targetID uint) (map[uint]string, error) {
	result := map[uint]string{}
	session, err := repo.EditSession.Get(targetType, targetID)
	switch {
	case err == nil && session.BaseRevisionID != 0:
		result[session.BaseRevisionID] = RevisionProtectedBase
	case err != nil && !errors.Is(err, gorm.ErrRecordNotFound):
		return nil, err
	}
	for _, item := range []struct{ kind, reason string }{
		{"", RevisionProtectedLatest},
		{RevisionKindPublish, RevisionProtectedPublished},
	} {
		id, err := repo.Revision.LatestID(targetType, targetID, item.kind)
		if err != nil {
			return nil, err
		}
		if id != 0 {
			result[id] = item.reason
		}
	}
	return result, nil
}

// prune 自动清理：每个目标只保留最新的 N 个版本（全局配置 revision_max_keep），受保护的版本始终保留；返回删除的数量
func (s *RevisionService) prune(targetType string, targetID uint) (int64, error) {
	protected, err := s.protectedRevisions(targetType, targetID)
	if err != nil {
		return 0, err
	}
	return repo.Revision.Prune(targetType, targetID, tools.GetRevisionMaxKeep(), slices.Collect(maps.Keys(protected)))
}

// PruneAll 清理所有版本数超出上限的目标（存量数据、调低上限后未再编辑的内容），返回删除的数量
func (s *RevisionService) PruneAll() (int64, error) {
	targets, err := repo.Revision.TargetsOverLimit(tools.GetRevisionMaxKeep())
	if err != nil {
		return 0, err
	}
	var deleted int64
	for _, target := range targets {
		n, err := s.prune(target.TargetType, target.TargetID)
		if err != nil {
			return deleted, err
		}
		deleted += n
	}
	return deleted, nil
}

// RecordSessionStart 打开编辑器时记录编辑起点，返回版本 ID（失败时返回 0，不影响编辑）
func (s *RevisionService) RecordSessionStart(ctx context.Context, targetType string, targetID uint, sessionID string) uint {
	revision, err := s.record(ctx, targetType, targetID, RevisionKindSession, sessionID)
	if err != nil || revision == nil {
		if err != nil {
			logrus.Warnf("record session revision of %s %d failed: %v", targetType, targetID, err)
		}
		return 0
	}
	return revision.ID
}

// RecordAfterSave 保存后记录版本：发布必记，保存草稿按间隔记检查点；失败只记录日志
func (s *RevisionService) RecordAfterSave(ctx context.Context, targetType string, targetID uint, published bool, sessionID string) {
	kind := RevisionKindAutosave
	if published {
		kind = RevisionKindPublish
	}
	if _, err := s.record(ctx, targetType, targetID, kind, sessionID); err != nil {
		logrus.Warnf("record %s revision of %s %d failed: %v", kind, targetType, targetID, err)
	}
}

// List 版本列表（新的在前）
func (s *RevisionService) List(ctx context.Context, targetType string, targetID uint, pagination dto.PaginationParams) (*dto.ListRevisionResp, *errs.ServiceError) {
	if svcerr := NewEditSessionService().checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return nil, svcerr
	}
	revisions, total, err := repo.Revision.List(targetType, targetID, pagination)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	protected, err := s.protectedRevisions(targetType, targetID)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := &dto.ListRevisionResp{Revisions: make([]*dto.RevisionDto, 0, len(revisions)), Total: total, MaxKeep: tools.GetRevisionMaxKeep()}
	for i := range revisions {
		item := revisions[i].ToDto()
		item.Protected = protected[item.ID]
		result.Revisions = append(result.Revisions, item)
	}
	return result, nil
}

func (s *RevisionService) get(ctx context.Context, targetType string, targetID, revisionID uint) (*model.ContentRevision, *dto.RevisionMeta, *errs.ServiceError) {
	if svcerr := NewEditSessionService().checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return nil, nil, svcerr
	}
	revision, err := repo.Revision.Get(targetType, targetID, revisionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, errs.NewNotFound("target_not_found")
		}
		return nil, nil, errs.NewInternalServer("failed_to_get_target")
	}
	var meta dto.RevisionMeta
	if err := json.Unmarshal([]byte(revision.Meta), &meta); err != nil {
		return nil, nil, errs.NewInternalServer("failed_to_get_target")
	}
	return revision, &meta, nil
}

// Get 版本详情（含正文与元信息）
func (s *RevisionService) Get(ctx context.Context, targetType string, targetID, revisionID uint) (*dto.RevisionDetailDto, *errs.ServiceError) {
	revision, meta, svcerr := s.get(ctx, targetType, targetID, revisionID)
	if svcerr != nil {
		return nil, svcerr
	}
	return &dto.RevisionDetailDto{RevisionDto: *revision.ToDto(), Content: revision.Content, Meta: *meta}, nil
}

// Delete 删除单个版本；版本不存在时返回 404
func (s *RevisionService) Delete(ctx context.Context, targetType string, targetID, revisionID uint, sessionID string) *errs.ServiceError {
	if revisionID == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	deleted, svcerr := s.delete(ctx, targetType, targetID, []uint{revisionID}, sessionID)
	if svcerr != nil {
		return svcerr
	}
	if deleted == 0 {
		return errs.NewNotFound("target_not_found")
	}
	return nil
}

// BatchDelete 批量删除版本，返回实际删除的数量；已不存在的版本视为已删除
func (s *RevisionService) BatchDelete(ctx context.Context, targetType string, targetID uint, revisionIDs []uint, sessionID string) (*dto.DeleteRevisionResp, *errs.ServiceError) {
	if len(revisionIDs) == 0 || len(revisionIDs) > revisionBatchDeleteMax || slices.Contains(revisionIDs, 0) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	deleted, svcerr := s.delete(ctx, targetType, targetID, revisionIDs, sessionID)
	if svcerr != nil {
		return nil, svcerr
	}
	return &dto.DeleteRevisionResp{Deleted: deleted}, nil
}

// delete 删除版本：需有编辑权限并持有当前编辑会话；含受保护的版本时整批拒绝，不删除任何版本
// 只删除属于该目标的版本，其他文章 / 页面的版本 ID 会被忽略
func (s *RevisionService) delete(ctx context.Context, targetType string, targetID uint, revisionIDs []uint, sessionID string) (int64, *errs.ServiceError) {
	editSessions := NewEditSessionService()
	if svcerr := editSessions.checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return 0, svcerr
	}
	if svcerr := editSessions.CheckContentWrite(targetType, targetID, sessionID); svcerr != nil {
		return 0, svcerr
	}
	protected, err := s.protectedRevisions(targetType, targetID)
	if err != nil {
		return 0, errs.NewInternalServer("failed_to_get_target")
	}
	for _, id := range revisionIDs {
		if _, ok := protected[id]; ok {
			return 0, errs.NewBadRequest("revision_protected")
		}
	}
	deleted, err := repo.Revision.DeleteByIDs(targetType, targetID, revisionIDs)
	if err != nil {
		return 0, errs.NewInternalServer("failed_to_delete_target")
	}
	return deleted, nil
}

// backup 恢复 / 放弃修改前先备份当前状态，保证这次操作本身也能撤回
func (s *RevisionService) backup(ctx context.Context, targetType string, targetID uint, sessionID string) *errs.ServiceError {
	if _, err := s.record(ctx, targetType, targetID, RevisionKindBackup, sessionID); err != nil {
		return errs.NewInternalServer("failed_to_create_target")
	}
	return nil
}

// Restore 把草稿与元信息恢复为指定版本（不直接发布）；需持有当前编辑会话
func (s *RevisionService) Restore(ctx context.Context, targetType string, targetID, revisionID uint, sessionID string) *errs.ServiceError {
	revision, meta, svcerr := s.get(ctx, targetType, targetID, revisionID)
	if svcerr != nil {
		return svcerr
	}
	if svcerr := NewEditSessionService().CheckContentWrite(targetType, targetID, sessionID); svcerr != nil {
		return svcerr
	}
	if svcerr := s.backup(ctx, targetType, targetID, sessionID); svcerr != nil {
		return svcerr
	}
	content := revision.Content
	if strings.TrimSpace(content) == "" {
		content = revisionEmptyContent
	}
	switch targetType {
	case constant.TargetTypePost:
		slug := ""
		if meta.Slug != nil {
			slug = *meta.Slug
		}
		categoryID := uint(0)
		if meta.CategoryID != nil {
			categoryID = *meta.CategoryID
		}
		labelIDs := meta.LabelIds
		if labelIDs == nil {
			labelIDs = []uint{}
		}
		_, svcerr = NewPostService().UpdatePost(ctx, &dto.CreateOrUpdatePostReq{
			ID: targetID,
			PostBaseDto: dto.PostBaseDto{
				Title: meta.Title, Slug: &slug, DraftContent: &content, CategoryID: &categoryID, LabelIds: labelIDs,
			},
			IsPrivate: &meta.IsPrivate, Top: &meta.Top, Description: &meta.Description, Cover: &meta.Cover,
			BackgroundImage: &meta.BackgroundImage,
			EditSessionID:   sessionID,
		})
	case constant.TargetTypePage:
		slug := ""
		if meta.Slug != nil {
			slug = *meta.Slug
		}
		_, svcerr = NewPageService().UpdatePage(ctx, &dto.CreateOrUpdatePageReq{
			ID:          targetID,
			PageBaseDto: dto.PageBaseDto{Title: meta.Title, Slug: slug, DraftContent: &content},
			IsPrivate:   &meta.IsPrivate, ShowInNav: &meta.ShowInNav, NavOrder: &meta.NavOrder, Layout: pageLayoutPtr(meta.Layout),
			// 旧版本快照中没有全屏设置（nil）时不修改
			Fullscreen:  meta.Fullscreen,
			Description: &meta.Description, Cover: &meta.Cover,
			EditSessionID: sessionID,
		})
	default:
		return errs.NewBadRequest("invalid_request_parameters")
	}
	return svcerr
}

// DiscardDraft 放弃未发布的修改：草稿恢复为已发布的正文，元信息不变
func (s *RevisionService) DiscardDraft(ctx context.Context, targetType string, targetID uint, sessionID string) *errs.ServiceError {
	if svcerr := NewEditSessionService().checkEditPermission(ctx, targetType, targetID); svcerr != nil {
		return svcerr
	}
	if svcerr := NewEditSessionService().CheckContentWrite(targetType, targetID, sessionID); svcerr != nil {
		return svcerr
	}
	snap, err := s.publishedContent(targetType, targetID)
	if err != nil {
		return errs.NewInternalServer("failed_to_get_target")
	}
	if svcerr := s.backup(ctx, targetType, targetID, sessionID); svcerr != nil {
		return svcerr
	}
	if strings.TrimSpace(snap) == "" {
		snap = revisionEmptyContent
	}
	var svcerr *errs.ServiceError
	switch targetType {
	case constant.TargetTypePost:
		_, svcerr = NewPostService().UpdatePost(ctx, &dto.CreateOrUpdatePostReq{ID: targetID, PostBaseDto: dto.PostBaseDto{DraftContent: &snap}, EditSessionID: sessionID})
	case constant.TargetTypePage:
		_, svcerr = NewPageService().UpdatePage(ctx, &dto.CreateOrUpdatePageReq{ID: targetID, PageBaseDto: dto.PageBaseDto{DraftContent: &snap}, EditSessionID: sessionID})
	default:
		return errs.NewBadRequest("invalid_request_parameters")
	}
	return svcerr
}

func (s *RevisionService) publishedContent(targetType string, targetID uint) (string, error) {
	if targetType == constant.TargetTypePage {
		page, err := repo.Page.GetPageByID(targetID)
		if err != nil {
			return "", err
		}
		return page.Content, nil
	}
	post, err := repo.Post.GetPostByID(targetID)
	if err != nil {
		return "", err
	}
	return post.Content, nil
}

// pageLayoutPtr 旧版本快照中没有版式时不修改当前版式
func pageLayoutPtr(layout string) *string {
	if layout == "" {
		return nil
	}
	return &layout
}
