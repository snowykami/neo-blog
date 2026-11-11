package service

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 后台批量操作歌词标注（见 docs/music-player-spec.md 7.2b）：
//   - 删除：删除这些歌曲的全部标注（所有歌词版本，含手动编辑），之后读者播放时按需重新生成
//   - 重新生成：后台任务逐首生成，同时最多 concurrency 首（每首歌内部的模型调用还会各自排队等待全局 AI 并发名额）。
//     进度保存在共享状态中（配置 Redis 时多副本看到的一致）；任务令牌（租约）随执行续期，执行的实例退出（滚动更新、崩溃）后
//     由 job_recovery 定时接手剩下的歌曲；全站同时只有一个批量任务。租约丢失（例如长时间连不上 Redis，期间已被其他实例接手）后
//     本实例不再开始新的歌曲、不再写进度，交给接手的实例
//   - 结果：成功为完成；不需要生成的（没有逐字歌词、不在歌单、手动编辑过、生成期间被删除）为跳过；
//     内部错误、上游出错、等不到全站歌词版本与模型失败为失败（可以再次批量重试）
const (
	lyricAnnotationBatchMaxSongs    = 1000
	lyricAnnotationBatchConcurrency = 2
	lyricAnnotationBatchLeaseTTL    = time.Minute
	// 任务结束后进度保留多久（后台仍能看到上次的结果）
	lyricAnnotationBatchStatusTTL = 7 * 24 * time.Hour
	// 还没有选出全站歌词版本的歌曲（没人播放过）最多等多久，等不到时跳过
	lyricAnnotationBatchVersionWait = 30 * time.Second
)

// 跳过的原因：当前歌词版本的标注手动编辑过（没有勾选覆盖，或在生成期间被手动编辑）；生成期间这首歌的标注被删除
const (
	lyricAnnotationBatchSkipEdited  = "edited"
	lyricAnnotationBatchSkipDeleted = "deleted"
)

type lyricAnnotationBatchRunner struct {
	// 共享状态键的前缀
	name        string
	annotations *lyricAnnotationService
	// prepare 送去标注的歌词、上下文与模型配置（同单首重新生成）；edited 当前歌词版本的标注是否手动编辑过
	prepare     func(ctx context.Context, id int64) ([]string, lyricAnnotationInfo, tools.AIConfig, *errs.ServiceError)
	edited      func(id int64, lines []string) bool
	concurrency int
	// leaseTTL 任务令牌的有效期（为 0 时为 lyricAnnotationBatchLeaseTTL，测试时缩短）
	leaseTTL time.Duration
	// done 一次执行结束时调用（测试用），可为 nil
	done func()
}

var lyricAnnotationBatch = &lyricAnnotationBatchRunner{
	name:        "lyric_annotation_batch",
	annotations: lyricAnnotations,
	prepare: func(ctx context.Context, id int64) ([]string, lyricAnnotationInfo, tools.AIConfig, *errs.ServiceError) {
		return NewMusicService().prepareLyricAnnotations(withLyricVersionWait(ctx, lyricAnnotationBatchVersionWait), id)
	},
	edited:      lyricAnnotationEdited,
	concurrency: lyricAnnotationBatchConcurrency,
}

func (r *lyricAnnotationBatchRunner) statusKey() string { return r.name + ":status" }
func (r *lyricAnnotationBatchRunner) ttl() time.Duration {
	if r.leaseTTL > 0 {
		return r.leaseTTL
	}
	return lyricAnnotationBatchLeaseTTL
}
func (r *lyricAnnotationBatchRunner) activeKey() string { return r.name + ":active" }
func (r *lyricAnnotationBatchRunner) cancelKey() string { return r.name + ":cancel" }

// lyricAnnotationEdited 这首歌当前歌词版本的标注是否手动编辑过
func lyricAnnotationEdited(id int64, lines []string) bool {
	_, hash := lyricAnnotationKey(id, lines)
	var count int64
	err := repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id = ? AND lyric_hash = ? AND edited_at IS NOT NULL", id, hash).Count(&count).Error
	return err == nil && count > 0
}

// normalizeLyricAnnotationSongIDs 去掉重复与不合法的 ID（保持顺序），数量须在 1 ~ lyricAnnotationBatchMaxSongs
func normalizeLyricAnnotationSongIDs(ids []int64) ([]int64, *errs.ServiceError) {
	seen := map[int64]bool{}
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}
	if len(result) == 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if len(result) > lyricAnnotationBatchMaxSongs {
		return nil, errs.NewBadRequest("lyric_annotation_batch_too_large")
	}
	return result, nil
}

// DeleteLyricAnnotations 批量删除歌词标注（仅管理员）：这些歌曲所有歌词版本的标注，含手动编辑过的；
// 正在进行的生成（读者触发、单首或批量重新生成）结束后不再把结果写回（见 lyricAnnotationService.deleteSongs）
func (s *MusicService) DeleteLyricAnnotations(ctx context.Context, req *dto.MusicLyricAnnotationBatchReq) (*dto.MusicLyricAnnotationBatchDeleteResp, *errs.ServiceError) {
	ids, svcerr := normalizeLyricAnnotationSongIDs(req.SongIDs)
	if svcerr != nil {
		return nil, svcerr
	}
	songs, records, err := lyricAnnotations.deleteSongs(ctx, ids)
	if err != nil {
		return nil, errs.Internal("failed_to_delete_target", err)
	}
	return &dto.MusicLyricAnnotationBatchDeleteResp{Songs: int(songs), Records: records}, nil
}

// StartLyricAnnotationBatch 开始批量重新生成（仅管理员），返回初始进度；已有批量任务在执行时返回 409
func (s *MusicService) StartLyricAnnotationBatch(_ context.Context, req *dto.MusicLyricAnnotationBatchReq) (*dto.MusicLyricAnnotationBatchStatus, *errs.ServiceError) {
	if !tools.GetAIConfig().Configured() {
		return nil, errs.NewBadRequest("ai_not_configured")
	}
	return lyricAnnotationBatch.start(req.SongIDs, req.OverwriteEdited)
}

// GetLyricAnnotationBatch 最近一次批量重新生成的进度（结束后保留一段时间），没有时为 nil
func (s *MusicService) GetLyricAnnotationBatch(_ context.Context) (*dto.MusicLyricAnnotationBatchStatus, *errs.ServiceError) {
	return lyricAnnotationBatch.status()
}

// CancelLyricAnnotationBatch 取消批量重新生成：不再开始新的歌曲，进行中的歌曲生成完后结束
func (s *MusicService) CancelLyricAnnotationBatch(_ context.Context) (*dto.MusicLyricAnnotationBatchStatus, *errs.ServiceError) {
	return lyricAnnotationBatch.cancel()
}

// ResumeLyricAnnotationBatch 接手执行中途中断的批量重新生成（由 job_recovery 定时调用）：进度仍为执行中、任务令牌已过期时在本实例继续
func ResumeLyricAnnotationBatch() {
	lyricAnnotationBatch.resume()
}

func (r *lyricAnnotationBatchRunner) start(songIDs []int64, overwriteEdited bool) (*dto.MusicLyricAnnotationBatchStatus, *errs.ServiceError) {
	ids, svcerr := normalizeLyricAnnotationSongIDs(songIDs)
	if svcerr != nil {
		return nil, svcerr
	}
	lease, err := sharedstate.AcquireLease(r.activeKey(), r.ttl())
	if err != nil {
		return nil, errs.Internal("failed_to_update_target", err)
	}
	if lease == nil {
		return nil, errs.NewConflict("lyric_annotation_batch_running")
	}
	now := time.Now()
	status := &dto.MusicLyricAnnotationBatchStatus{
		ID: utils.Strings.GenerateRandomString(12), State: dto.MusicLyricAnnotationBatchStateRunning, OverwriteEdited: overwriteEdited,
		Total: len(ids), StartedAt: now, UpdatedAt: now,
	}
	for _, id := range ids {
		status.Items = append(status.Items, dto.MusicLyricAnnotationBatchItem{SongID: id, Status: dto.MusicLyricAnnotationBatchPending})
	}
	_ = sharedstate.Current().Delete(r.cancelKey())
	if err := r.save(status); err != nil {
		lease.Release()
		return nil, errs.Internal("failed_to_update_target", err)
	}
	// 返回副本：后台任务会继续修改 status
	snapshot := *status
	snapshot.Items = slices.Clone(status.Items)
	go r.run(lease, status)
	return &snapshot, nil
}

func (r *lyricAnnotationBatchRunner) status() (*dto.MusicLyricAnnotationBatchStatus, *errs.ServiceError) {
	var status dto.MusicLyricAnnotationBatchStatus
	found, err := sharedstate.GetJSON(r.statusKey(), &status)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if !found {
		return nil, nil
	}
	if status.State == dto.MusicLyricAnnotationBatchStateRunning {
		values, err := sharedstate.Current().GetMany(r.activeKey(), r.cancelKey())
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err)
		}
		_, active := values[r.activeKey()]
		_, canceling := values[r.cancelKey()]
		status.Interrupted, status.Canceling = !active, canceling
	}
	return &status, nil
}

func (r *lyricAnnotationBatchRunner) cancel() (*dto.MusicLyricAnnotationBatchStatus, *errs.ServiceError) {
	status, svcerr := r.status()
	if svcerr != nil {
		return nil, svcerr
	}
	if status == nil || status.State != dto.MusicLyricAnnotationBatchStateRunning {
		return status, nil
	}
	// 执行的实例已退出、还没有被接手：直接结束
	if lease, err := sharedstate.AcquireLease(r.activeKey(), r.ttl()); err == nil && lease != nil {
		defer lease.Release()
		r.finish(status, true)
		if err := r.save(status); err != nil {
			return nil, errs.Internal("failed_to_update_target", err)
		}
		return status, nil
	}
	if err := sharedstate.Current().Set(r.cancelKey(), "1", lyricAnnotationBatchStatusTTL); err != nil {
		return nil, errs.Internal("failed_to_update_target", err)
	}
	status.Canceling = true
	return status, nil
}

func (r *lyricAnnotationBatchRunner) resume() {
	var status dto.MusicLyricAnnotationBatchStatus
	if found, err := sharedstate.GetJSON(r.statusKey(), &status); err != nil || !found || status.State != dto.MusicLyricAnnotationBatchStateRunning {
		return
	}
	lease, err := sharedstate.AcquireLease(r.activeKey(), r.ttl())
	if err != nil || lease == nil {
		return
	}
	logrus.Infof("resume lyric annotation batch %s", status.ID)
	go r.run(lease, &status)
}

// save 写入进度（计数按各首歌的状态重新统计）
func (r *lyricAnnotationBatchRunner) save(status *dto.MusicLyricAnnotationBatchStatus) error {
	status.Done, status.Failed, status.Skipped = 0, 0, 0
	for _, item := range status.Items {
		switch item.Status {
		case dto.MusicLyricAnnotationBatchDone:
			status.Done++
		case dto.MusicLyricAnnotationBatchFailed:
			status.Failed++
		case dto.MusicLyricAnnotationBatchSkipped:
			status.Skipped++
		}
	}
	status.UpdatedAt = time.Now()
	return sharedstate.SetJSON(r.statusKey(), status, lyricAnnotationBatchStatusTTL)
}

// finish 结束任务：取消时还没开始的歌曲保持「等待」，状态为已取消
func (r *lyricAnnotationBatchRunner) finish(status *dto.MusicLyricAnnotationBatchStatus, canceled bool) {
	now := time.Now()
	status.State, status.FinishedAt = dto.MusicLyricAnnotationBatchStateDone, &now
	if canceled && slices.ContainsFunc(status.Items, func(item dto.MusicLyricAnnotationBatchItem) bool {
		return item.Status == dto.MusicLyricAnnotationBatchPending
	}) {
		status.State = dto.MusicLyricAnnotationBatchStateCanceled
	}
	status.Interrupted, status.Canceling = false, false
}

func (r *lyricAnnotationBatchRunner) canceled() bool {
	_, ok, err := sharedstate.Current().Get(r.cancelKey())
	return err == nil && ok
}

// run 持有任务令牌执行：上次中断时进行中的歌曲重新排队，最多 concurrency 首并行，每首结束即保存进度。
// 开始每首歌、写入进度前确认仍持有任务令牌：丢失后（已被其他实例接手）不再开始新的歌曲、不再写进度，进行中的生成随之取消
func (r *lyricAnnotationBatchRunner) run(lease *sharedstate.Lease, status *dto.MusicLyricAnnotationBatchStatus) {
	ctx, stop := context.WithCancel(context.Background())
	defer func() {
		stop()
		lease.Release()
		if r.done != nil {
			r.done()
		}
	}()
	go func() {
		select {
		case <-lease.Lost():
			stop()
		case <-ctx.Done():
		}
	}()
	var mu sync.Mutex
	lost := false
	// held 是否仍持有任务令牌，调用方须持有 mu；丢失后不再恢复
	held := func() bool {
		if !lost && !lease.Held() {
			lost = true
			stop()
			logrus.Warnf("lyric annotation batch %s: lease lost, leaving the rest to the instance that took over", status.ID)
		}
		return !lost
	}
	for i := range status.Items {
		if status.Items[i].Status == dto.MusicLyricAnnotationBatchRunning {
			status.Items[i].Status = dto.MusicLyricAnnotationBatchPending
		}
	}
	save := func() {
		if err := r.save(status); err != nil {
			logrus.Warnf("save lyric annotation batch %s: %v", status.ID, err)
		}
	}
	canceled := false
	next := 0
	// take 取出下一首等待中的歌曲并标为进行中；已取消或没有了时返回 -1
	take := func() int {
		mu.Lock()
		defer mu.Unlock()
		if !held() {
			return -1
		}
		if canceled = canceled || r.canceled(); canceled {
			return -1
		}
		for next < len(status.Items) && status.Items[next].Status != dto.MusicLyricAnnotationBatchPending {
			next++
		}
		if next >= len(status.Items) {
			return -1
		}
		i := next
		next++
		status.Items[i].Status = dto.MusicLyricAnnotationBatchRunning
		save()
		return i
	}
	var wg sync.WaitGroup
	for range max(1, r.concurrency) {
		wg.Go(func() {
			for i := take(); i >= 0; i = take() {
				result, reason := r.process(ctx, status.Items[i].SongID, status.OverwriteEdited)
				mu.Lock()
				if held() {
					status.Items[i].Status, status.Items[i].Reason = result, reason
					save()
				}
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	if !held() {
		return
	}
	r.finish(status, canceled)
	save()
	_ = sharedstate.Current().Delete(r.cancelKey())
}

// process 重新生成一首歌，返回状态与原因（跳过或失败时）；parent 结束（任务令牌丢失）时中止
func (r *lyricAnnotationBatchRunner) process(parent context.Context, id int64, overwriteEdited bool) (status, reason string) {
	defer func() {
		if v := recover(); v != nil {
			logrus.Errorf("lyric annotation batch panic for song %d: %v", id, v)
			status, reason = dto.MusicLyricAnnotationBatchFailed, "lyric_annotations_failed"
		}
	}()
	ctx, cancel := context.WithTimeout(parent, lyricAnnotationBatchVersionWait+lyricAnnotationTimeout+time.Minute)
	defer cancel()
	lines, info, cfg, svcerr := r.prepare(ctx, id)
	if svcerr != nil {
		if lyricAnnotationBatchFailure(svcerr) {
			return dto.MusicLyricAnnotationBatchFailed, svcerr.Message
		}
		return dto.MusicLyricAnnotationBatchSkipped, svcerr.Message
	}
	if !overwriteEdited && r.edited(id, lines) {
		return dto.MusicLyricAnnotationBatchSkipped, lyricAnnotationBatchSkipEdited
	}
	err := r.annotations.regenerate(ctx, id, lines, info, cfg, overwriteEdited)
	switch {
	case err == nil:
		return dto.MusicLyricAnnotationBatchDone, ""
	case errors.Is(err, errLyricAnnotationEdited):
		return dto.MusicLyricAnnotationBatchSkipped, lyricAnnotationBatchSkipEdited
	case errors.Is(err, errLyricAnnotationDeleted):
		return dto.MusicLyricAnnotationBatchSkipped, lyricAnnotationBatchSkipDeleted
	default:
		return dto.MusicLyricAnnotationBatchFailed, "lyric_annotations_failed"
	}
}

// lyricAnnotationBatchFailure 准备阶段的错误是否算失败（而不是跳过）：等不到全站歌词版本、内部错误与上游出错（5xx）是暂时的，
// 记为失败便于再次批量重试；其余（没有逐字歌词、不在歌单、没有歌词等）是这首歌本身不需要生成，记为跳过
func lyricAnnotationBatchFailure(svcerr *errs.ServiceError) bool {
	return svcerr == errLyricVersionPending || svcerr.Code >= http.StatusInternalServerError
}
