package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// blockingAnnotationService 规划请求等 release 放行的标注服务：started 在每次规划请求开始时收到通知，done 在每次任务结束时收到通知
func blockingAnnotationService(release <-chan struct{}) (svc *lyricAnnotationService, started, done chan struct{}) {
	started, done = make(chan struct{}, 4), make(chan struct{}, 4)
	svc = &lyricAnnotationService{
		limiter:     &llmclient.Limiter{},
		concurrency: func() int { return 1 },
		complete: func(_ context.Context, _ tools.AIConfig, system, _ string) (string, error) {
			if system == lyricAnnotationText.PlanPrompt {
				started <- struct{}{}
				<-release
			}
			return `{"lines":[{"i":0,"phrases":[{"text":"心动","effect":"swell"}]}]}`, nil
		},
		done: func() { done <- struct{}{} },
	}
	return svc, started, done
}

func waitSignal(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

// 生成期间保存的手动编辑不会被生成结果覆盖：自动生成（过期、首次）与管理员明确要求的重新生成都一样；
// 结果不写回不算失败（不进入冷却期）
func TestLyricAnnotationGenerationKeepsManualEdit(t *testing.T) {
	setupEditTest(t)
	lines := []string{"怦然心动"}
	cfg := tools.AIConfig{Model: "test"}
	for _, overwrite := range []bool{false, true} {
		release := make(chan struct{})
		svc, started, done := blockingAnnotationService(release)
		id := int64(31)
		if overwrite {
			id = 32
		}
		key, hash := lyricAnnotationKey(id, lines)
		if overwrite {
			// 已有一份手动编辑：管理员要求重新生成时覆盖它，但不覆盖生成期间新的编辑
			before := time.Now().Add(-time.Minute)
			repo.GetDB().Create(&model.LyricAnnotation{SongID: id, LyricHash: hash, Data: `{"lines":[]}`, Model: "manual", CreatedAt: before, EditedAt: &before})
			svc.refresh(id, lines, lyricAnnotationInfo{}, cfg)
		} else if _, svcerr := svc.get(id, lines, lyricAnnotationInfo{}, cfg, time.Hour); svcerr != nil {
			t.Fatal(svcerr)
		}
		waitSignal(t, started, "generation")
		// 生成期间管理员保存了手动编辑
		edited := time.Now()
		manual := &model.LyricAnnotation{SongID: id, LyricHash: hash, Data: `{"lines":[{"text":"怦然心动","phrases":[]}]}`, Model: "manual", CreatedAt: edited, EditedAt: &edited}
		if err := repo.GetDB().Where("song_id = ? AND lyric_hash = ?", id, hash).Delete(&model.LyricAnnotation{}).Error; err != nil {
			t.Fatal(err)
		}
		if err := repo.GetDB().Create(manual).Error; err != nil {
			t.Fatal(err)
		}
		close(release)
		waitSignal(t, done, "generation to finish")
		var record model.LyricAnnotation
		repo.GetDB().Where("song_id = ? AND lyric_hash = ?", id, hash).First(&record)
		if record.EditedAt == nil || record.Model != "manual" || record.Data != manual.Data {
			t.Fatalf("overwrite=%v: manual edit overwritten: %+v", overwrite, record)
		}
		if running, coolingDown := svc.jobState(key); running || coolingDown {
			t.Fatalf("overwrite=%v: discarded result should not count as failure: running=%v coolingDown=%v", overwrite, running, coolingDown)
		}
	}
}

// 管理员要求重新生成时覆盖生成开始前的手动编辑，并写入短语数
func TestLyricAnnotationRefreshOverwritesEarlierEdit(t *testing.T) {
	setupEditTest(t)
	release := make(chan struct{})
	close(release)
	svc, _, done := blockingAnnotationService(release)
	lines := []string{"怦然心动"}
	_, hash := lyricAnnotationKey(33, lines)
	before := time.Now().Add(-time.Minute)
	repo.GetDB().Create(&model.LyricAnnotation{SongID: 33, LyricHash: hash, Data: `{"lines":[]}`, Model: "manual", CreatedAt: before, EditedAt: &before})
	svc.refresh(33, lines, lyricAnnotationInfo{}, tools.AIConfig{Model: "test"})
	waitSignal(t, done, "refresh")
	var record model.LyricAnnotation
	repo.GetDB().Where("song_id = ?", 33).First(&record)
	if record.EditedAt != nil || record.Model != "test" || record.Phrases != 1 {
		t.Fatalf("refresh should overwrite the earlier edit: %+v", record)
	}
}

// 生成期间这首歌的标注被删除：生成结果不写回
func TestLyricAnnotationDeleteDiscardsRunningGeneration(t *testing.T) {
	setupEditTest(t)
	release := make(chan struct{})
	svc, started, done := blockingAnnotationService(release)
	lines := []string{"怦然心动"}
	key, _ := lyricAnnotationKey(34, lines)
	if _, svcerr := svc.get(34, lines, lyricAnnotationInfo{}, tools.AIConfig{Model: "test"}, time.Hour); svcerr != nil {
		t.Fatal(svcerr)
	}
	waitSignal(t, started, "generation")
	if _, _, err := svc.deleteSongs(context.Background(), []int64{34}); err != nil {
		t.Fatal(err)
	}
	close(release)
	waitSignal(t, done, "generation to finish")
	var count int64
	repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id = ?", 34).Count(&count)
	if count != 0 {
		t.Fatal("deleted song was written back")
	}
	if _, coolingDown := svc.jobState(key); coolingDown {
		t.Fatal("discarded result should not count as failure")
	}
	// 删除之后才开始的生成照常写回
	if _, svcerr := svc.get(34, lines, lyricAnnotationInfo{}, tools.AIConfig{Model: "test"}, time.Hour); svcerr != nil {
		t.Fatal(svcerr)
	}
	waitSignal(t, done, "second generation")
	repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id = ?", 34).Count(&count)
	if count != 1 {
		t.Fatal("generation after deletion should be saved")
	}
}

// 后台编辑器：已移出歌单（也没有被公开内容引用）的歌曲仍能打开并保存（标出 orphaned）；正在生成时保存返回 409
func TestLyricAnnotationEditorOrphanedAndGenerating(t *testing.T) {
	setupTTMLDB(t)
	sharedstate.UseMemory()
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {data: &dto.MusicLyricDto{Lrc: lyricPart(pipaNCMLrc), Yrc: lyricPart(pipaNCMYrc)}, outcome: lyricOutcomeHit},
	})
	s := NewMusicService()
	ctx := context.Background()
	editor, svcerr := s.GetLyricAnnotationEditor(ctx, 3)
	if svcerr != nil || !editor.Orphaned || len(editor.Lines) != 2 || editor.Annotation != nil {
		t.Fatalf("editor = %+v %v", editor, svcerr)
	}
	req := &dto.MusicLyricAnnotationsEditReq{Lines: []dto.MusicLyricAnnotationLine{{Text: editor.Lines[0], Phrases: []dto.MusicLyricAnnotationPhrase{{Text: "浔阳江头", Effect: "glow"}, {Text: "夜送客", Effect: "swell"}}}}}

	// 正在生成（可能在其他实例上）：不能保存
	key, _ := lyricAnnotationKey(3, editor.Lines)
	jobKey, _ := lyricAnnotations.stateKeys(key)
	lease, err := sharedstate.AcquireLease(jobKey, time.Minute)
	if err != nil || lease == nil {
		t.Fatalf("acquire = %v %v", lease, err)
	}
	if _, svcerr := s.SaveLyricAnnotations(ctx, 3, req); svcerr == nil || svcerr.Message != "lyric_annotation_generating" || svcerr.Code != 409 {
		t.Fatalf("save while generating = %v", svcerr)
	}
	lease.Release()

	saved, svcerr := s.SaveLyricAnnotations(ctx, 3, req)
	if svcerr != nil || saved.EditedAt == nil || saved.Annotation == nil || !saved.Orphaned {
		t.Fatalf("save = %+v %v", saved, svcerr)
	}
	var record model.LyricAnnotation
	repo.GetDB().Where("song_id = ?", 3).First(&record)
	if record.Phrases != 2 || record.EditedAt == nil {
		t.Fatalf("saved record = %+v", record)
	}
}

// 旧版本标注的清理：只删超过保留期、不属于当前全站歌词版本、没有手动编辑过的
func TestCleanupLyricAnnotations(t *testing.T) {
	setupTTMLDB(t)
	db := repo.GetDB()
	now := time.Now()
	old := now.Add(-LyricAnnotationRetention - time.Hour)
	db.Create(&model.LyricCache{SongID: 1, Kind: "ttml", LyricHash: "current", Data: "{}", UpdatedAt: now})
	db.Create(&model.LyricCache{SongID: 3, Kind: "ncm", Data: "{}", UpdatedAt: now})
	records := []struct {
		record model.LyricAnnotation
		keep   bool
	}{
		{model.LyricAnnotation{SongID: 1, LyricHash: "stale", CreatedAt: old}, false},
		{model.LyricAnnotation{SongID: 1, LyricHash: "stale-edited", CreatedAt: old, EditedAt: &old}, true},
		{model.LyricAnnotation{SongID: 1, LyricHash: "current", CreatedAt: old}, true},
		{model.LyricAnnotation{SongID: 1, LyricHash: "recent", CreatedAt: now.Add(-time.Hour)}, true},
		// 还没有选出全站版本、或旧数据没有记录哈希的歌曲不清理
		{model.LyricAnnotation{SongID: 2, LyricHash: "unknown", CreatedAt: old}, true},
		{model.LyricAnnotation{SongID: 3, LyricHash: "legacy", CreatedAt: old}, true},
	}
	for i := range records {
		records[i].record.Data = "{}"
		if err := db.Create(&records[i].record).Error; err != nil {
			t.Fatal(err)
		}
	}
	deleted, err := CleanupLyricAnnotations(now)
	if err != nil || deleted != 1 {
		t.Fatalf("deleted = %d %v", deleted, err)
	}
	for _, r := range records {
		var count int64
		db.Model(&model.LyricAnnotation{}).Where("id = ?", r.record.ID).Count(&count)
		if (count == 1) != r.keep {
			t.Errorf("%d %s kept=%v, want %v", r.record.SongID, r.record.LyricHash, count == 1, r.keep)
		}
	}
}

// 批量任务：准备阶段的内部错误与等不到全站歌词版本记为失败（可以再次批量重试），生成期间被手动编辑或删除的记为跳过
func TestLyricAnnotationBatchFailuresAndDiscards(t *testing.T) {
	f := newBatchFixture(t, 1, nil, nil, nil)
	prepare := f.runner.prepare
	f.runner.prepare = func(ctx context.Context, id int64) ([]string, lyricAnnotationInfo, tools.AIConfig, *errs.ServiceError) {
		switch id {
		case 500:
			return nil, lyricAnnotationInfo{}, tools.AIConfig{}, errLyricVersionPending
		case 501:
			return nil, lyricAnnotationInfo{}, tools.AIConfig{}, errs.Internal("failed_to_get_target", errors.New("db down"))
		}
		return prepare(ctx, id)
	}
	if _, svcerr := f.runner.start([]int64{500, 501, 404}, false); svcerr != nil {
		t.Fatal(svcerr)
	}
	f.wait(t)
	status := f.status(t)
	got := itemStatuses(status)
	if got[500] != "failed:lyric_version_pending" || got[501] != "failed:failed_to_get_target" || got[404] != "skipped:lyric_annotations_unavailable" || status.Failed != 2 || status.Skipped != 1 {
		t.Fatalf("items = %v %+v", got, status)
	}
}

// 批量任务在生成期间：手动编辑记为跳过（edited）且编辑保留，删除记为跳过（deleted）且不写回
func TestLyricAnnotationBatchEditedOrDeletedDuringGeneration(t *testing.T) {
	block := make(chan struct{})
	f := newBatchFixture(t, 1, nil, nil, block)
	planned := make(chan struct{}, 4)
	complete := f.runner.annotations.complete
	f.runner.annotations.complete = func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		if system == lyricAnnotationText.PlanPrompt {
			planned <- struct{}{}
		}
		return complete(ctx, cfg, system, user)
	}
	if _, svcerr := f.runner.start([]int64{1, 2}, false); svcerr != nil {
		t.Fatal(svcerr)
	}
	// 第一首生成期间管理员保存了手动编辑
	waitSignal(t, planned, "song 1")
	_, hash := lyricAnnotationKey(1, []string{songLine(1)})
	edited := time.Now()
	repo.GetDB().Create(&model.LyricAnnotation{SongID: 1, LyricHash: hash, Data: `{"lines":[]}`, Model: "manual", CreatedAt: edited, EditedAt: &edited})
	block <- struct{}{}
	// 第二首生成期间被删除
	waitSignal(t, planned, "song 2")
	if _, _, err := f.runner.annotations.deleteSongs(context.Background(), []int64{2}); err != nil {
		t.Fatal(err)
	}
	block <- struct{}{}
	f.wait(t)
	if got := itemStatuses(f.status(t)); got[1] != "skipped:edited" || got[2] != "skipped:deleted" {
		t.Fatalf("items = %v", got)
	}
	var record model.LyricAnnotation
	repo.GetDB().Where("song_id = ?", 1).First(&record)
	if record.EditedAt == nil || record.Model != "manual" {
		t.Fatalf("manual edit overwritten: %+v", record)
	}
	var count int64
	repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id = ?", 2).Count(&count)
	if count != 0 {
		t.Fatal("deleted song written back")
	}
}

// 批量任务的令牌丢失（已被其他实例接手）：不再开始新的歌曲、不再写进度
func TestLyricAnnotationBatchStopsWhenLeaseLost(t *testing.T) {
	block := make(chan struct{})
	f := newBatchFixture(t, 1, nil, nil, block)
	f.runner.leaseTTL = 90 * time.Millisecond
	if _, svcerr := f.runner.start([]int64{1, 2, 3}, false); svcerr != nil {
		t.Fatal(svcerr)
	}
	deadline := time.Now().Add(5 * time.Second)
	for itemStatuses(f.status(t))[1] != "running:" {
		if time.Now().After(deadline) {
			t.Fatal("first song never started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// 其他实例接手：任务令牌换成了别人的
	if err := sharedstate.Current().Set(f.runner.activeKey(), "other", time.Minute); err != nil {
		t.Fatal(err)
	}
	close(block)
	f.wait(t)
	status := f.status(t)
	if got := itemStatuses(status); status.State != dto.MusicLyricAnnotationBatchStateRunning || got[1] != "running:" || got[2] != "pending:" || got[3] != "pending:" {
		t.Fatalf("after lease lost = %+v %v", status, got)
	}
	f.mu.Lock()
	plans := len(f.plans)
	f.mu.Unlock()
	if plans != 1 {
		t.Fatalf("songs planned after lease lost = %d", plans)
	}
	// 接手实例的令牌不受影响
	if value, ok, _ := sharedstate.Current().Get(f.runner.activeKey()); !ok || value != "other" {
		t.Fatalf("active key = %q %v", value, ok)
	}
}
