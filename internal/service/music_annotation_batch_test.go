package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 批量任务的测试环境：干净的数据库与共享状态；模型按歌曲返回固定的标注，failSongs 中的歌曲调用失败，
// block 不为 nil 时每次规划请求都等它放行（用于取消与接手）
type batchFixture struct {
	runner   *lyricAnnotationBatchRunner
	finished chan struct{}
	mu       sync.Mutex
	plans    map[string]int // 每首歌（按歌词）规划请求的次数
}

func newBatchFixture(t *testing.T, concurrency int, failSongs map[int64]bool, edited map[int64]bool, block chan struct{}) *batchFixture {
	t.Helper()
	sharedstate.UseMemory()
	setupTTMLDB(t)
	originalDelay := lyricAnnotationPlanRetryDelay
	lyricAnnotationPlanRetryDelay = 0
	t.Cleanup(func() { lyricAnnotationPlanRetryDelay = originalDelay })
	f := &batchFixture{finished: make(chan struct{}, 8), plans: map[string]int{}}
	annotations := &lyricAnnotationService{
		name:        "batch_test_annotation",
		limiter:     &aiLimiter{},
		concurrency: func() int { return 4 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			if system == lyricAnnotationText.PlanPrompt {
				if block != nil {
					<-block
				}
				f.mu.Lock()
				f.plans[user]++
				f.mu.Unlock()
				for id := range failSongs {
					if containsSongLine(user, id) {
						return "", errors.New("boom")
					}
				}
			}
			return `{"lines":[{"i":0,"phrases":[{"text":"心动","effect":"swell"}]}]}`, nil
		},
	}
	f.runner = &lyricAnnotationBatchRunner{
		name:        "batch_test",
		annotations: annotations,
		prepare: func(_ context.Context, id int64) ([]string, lyricAnnotationInfo, tools.AIConfig, *errs.ServiceError) {
			if id == 404 {
				return nil, lyricAnnotationInfo{}, tools.AIConfig{}, errs.NewNotFound("lyric_annotations_unavailable")
			}
			return []string{songLine(id)}, lyricAnnotationInfo{Title: "歌"}, tools.AIConfig{Model: "test"}, nil
		},
		edited:      func(id int64, _ []string) bool { return edited[id] },
		concurrency: concurrency,
		done:        func() { f.finished <- struct{}{} },
	}
	return f
}

// 每首歌一句不同的歌词（规划请求中按它认出是哪首歌）
func songLine(id int64) string {
	return "怦然心动" + string(rune('A'+id%26)) + string(rune('a'+id/26%26))
}

func containsSongLine(user string, id int64) bool {
	return strings.Contains(user, songLine(id))
}

func (f *batchFixture) wait(t *testing.T) {
	t.Helper()
	select {
	case <-f.finished:
	case <-time.After(10 * time.Second):
		t.Fatal("batch did not finish")
	}
}

func (f *batchFixture) status(t *testing.T) *dto.MusicLyricAnnotationBatchStatus {
	t.Helper()
	status, svcerr := f.runner.status()
	if svcerr != nil || status == nil {
		t.Fatalf("status = %+v %v", status, svcerr)
	}
	return status
}

func itemStatuses(status *dto.MusicLyricAnnotationBatchStatus) map[int64]string {
	result := map[int64]string{}
	for _, item := range status.Items {
		result[item.SongID] = item.Status + ":" + item.Reason
	}
	return result
}

func TestLyricAnnotationBatch(t *testing.T) {
	f := newBatchFixture(t, 2, map[int64]bool{5: true}, map[int64]bool{4: true}, nil)
	// 重复与不合法的 ID 去掉
	status, svcerr := f.runner.start([]int64{1, 2, 1, 0, 404, 4, 5}, false)
	if svcerr != nil || status.Total != 5 || status.State != dto.MusicLyricAnnotationBatchStateRunning {
		t.Fatalf("start = %+v %v", status, svcerr)
	}
	f.wait(t)
	status = f.status(t)
	want := map[int64]string{1: "done:", 2: "done:", 404: "skipped:lyric_annotations_unavailable", 4: "skipped:edited", 5: "failed:lyric_annotations_failed"}
	if got := itemStatuses(status); len(got) != len(want) || got[1] != want[1] || got[2] != want[2] || got[404] != want[404] || got[4] != want[4] || got[5] != want[5] {
		t.Fatalf("items = %v", got)
	}
	if status.State != dto.MusicLyricAnnotationBatchStateDone || status.Done != 2 || status.Skipped != 2 || status.Failed != 1 || status.FinishedAt == nil || status.Interrupted {
		t.Fatalf("final = %+v", status)
	}
	var count int64
	repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id IN ?", []int64{1, 2}).Count(&count)
	if count != 2 {
		t.Fatalf("saved annotations = %d", count)
	}
	// 失败的歌曲进入冷却期，但批量任务是管理员明确要求的：再次批量时照样生成
	if status, svcerr = f.runner.start([]int64{5}, true); svcerr != nil {
		t.Fatalf("restart = %v", svcerr)
	}
	f.wait(t)
	if got := itemStatuses(f.status(t)); got[5] != "failed:lyric_annotations_failed" {
		t.Fatalf("retry = %v", got)
	}
	// 不合法的请求
	if _, svcerr := f.runner.start([]int64{0, -1}, false); svcerr == nil || svcerr.Message != "invalid_request_parameters" {
		t.Fatalf("empty = %v", svcerr)
	}
	tooMany := make([]int64, lyricAnnotationBatchMaxSongs+1)
	for i := range tooMany {
		tooMany[i] = int64(i + 1)
	}
	if _, svcerr := f.runner.start(tooMany, false); svcerr == nil || svcerr.Message != "lyric_annotation_batch_too_large" {
		t.Fatalf("too many = %v", svcerr)
	}
}

func TestLyricAnnotationBatchCancelAndConflict(t *testing.T) {
	block := make(chan struct{})
	f := newBatchFixture(t, 1, nil, nil, block)
	if _, svcerr := f.runner.start([]int64{1, 2, 3}, false); svcerr != nil {
		t.Fatal(svcerr)
	}
	// 全站同时只有一个批量任务
	if _, svcerr := f.runner.start([]int64{9}, false); svcerr == nil || svcerr.Message != "lyric_annotation_batch_running" {
		t.Fatalf("second batch = %v", svcerr)
	}
	// 等第一首开始生成后再取消
	deadline := time.Now().Add(5 * time.Second)
	for itemStatuses(f.status(t))[1] != "running:" {
		if time.Now().After(deadline) {
			t.Fatal("first song never started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	status, svcerr := f.runner.cancel()
	if svcerr != nil || !status.Canceling {
		t.Fatalf("cancel = %+v %v", status, svcerr)
	}
	close(block) // 进行中的第一首生成完后结束
	f.wait(t)
	status = f.status(t)
	if got := itemStatuses(status); status.State != dto.MusicLyricAnnotationBatchStateCanceled || got[1] != "done:" || got[2] != "pending:" || got[3] != "pending:" || status.Canceling {
		t.Fatalf("canceled = %+v %v", status, got)
	}
}

func TestLyricAnnotationBatchResume(t *testing.T) {
	f := newBatchFixture(t, 2, nil, nil, nil)
	// 执行的实例退出：进度仍为执行中，任务令牌已过期
	now := time.Now()
	saved := &dto.MusicLyricAnnotationBatchStatus{ID: "x", State: dto.MusicLyricAnnotationBatchStateRunning, Total: 3, StartedAt: now, Items: []dto.MusicLyricAnnotationBatchItem{
		{SongID: 1, Status: dto.MusicLyricAnnotationBatchDone},
		{SongID: 2, Status: dto.MusicLyricAnnotationBatchRunning},
		{SongID: 3, Status: dto.MusicLyricAnnotationBatchPending},
	}}
	if err := f.runner.save(saved); err != nil {
		t.Fatal(err)
	}
	if status := f.status(t); !status.Interrupted || status.Done != 1 {
		t.Fatalf("interrupted = %+v", status)
	}
	f.runner.resume()
	f.wait(t)
	status := f.status(t)
	if got := itemStatuses(status); status.State != dto.MusicLyricAnnotationBatchStateDone || got[2] != "done:" || got[3] != "done:" || status.Done != 3 {
		t.Fatalf("resumed = %+v %v", status, got)
	}
	// 已完成的不再接手
	f.runner.resume()
	select {
	case <-f.finished:
		t.Fatal("finished batch resumed again")
	case <-time.After(100 * time.Millisecond):
	}
}

// 同一首歌已经在生成（其他实例或读者触发）：批量任务等它结束，以它的结果为准
func TestLyricAnnotationRegenerateWaits(t *testing.T) {
	f := newBatchFixture(t, 1, nil, nil, nil)
	annotations := f.runner.annotations
	original := lyricAnnotationWaitPoll
	lyricAnnotationWaitPoll = 10 * time.Millisecond
	t.Cleanup(func() { lyricAnnotationWaitPoll = original })
	lines := []string{songLine(7)}
	key, _ := lyricAnnotationKey(7, lines)
	jobKey, failedKey := annotations.stateKeys(key)
	lease, _ := sharedstate.AcquireLease(jobKey, time.Minute)
	result := make(chan error, 1)
	go func() {
		result <- annotations.regenerate(context.Background(), 7, lines, lyricAnnotationInfo{}, tools.AIConfig{}, false)
	}()
	time.Sleep(50 * time.Millisecond)
	_ = sharedstate.Current().Set(failedKey, "1", time.Minute)
	lease.Release()
	if err := <-result; !errors.Is(err, errLyricAnnotationFailed) {
		t.Fatalf("waited result = %v", err)
	}
	if len(f.plans) != 0 {
		t.Fatal("model called while another job was running")
	}
}

func TestDeleteLyricAnnotations(t *testing.T) {
	sharedstate.UseMemory()
	setupTTMLDB(t)
	db := repo.GetDB()
	now := time.Now()
	db.Create(&model.LyricAnnotation{SongID: 1, LyricHash: "a", Data: "{}", CreatedAt: now})
	db.Create(&model.LyricAnnotation{SongID: 1, LyricHash: "b", Data: "{}", CreatedAt: now, EditedAt: &now})
	db.Create(&model.LyricAnnotation{SongID: 2, LyricHash: "a", Data: "{}", CreatedAt: now})
	got, svcerr := NewMusicService().DeleteLyricAnnotations(context.Background(), &dto.MusicLyricAnnotationBatchReq{SongIDs: []int64{1, 3, 1}})
	if svcerr != nil || got.Songs != 1 || got.Records != 2 {
		t.Fatalf("delete = %+v %v", got, svcerr)
	}
	var left int64
	db.Model(&model.LyricAnnotation{}).Count(&left)
	if left != 1 {
		t.Fatalf("left = %d", left)
	}
	if _, svcerr := NewMusicService().DeleteLyricAnnotations(context.Background(), &dto.MusicLyricAnnotationBatchReq{}); svcerr == nil {
		t.Fatal("empty delete accepted")
	}
}
