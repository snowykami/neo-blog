package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 全站歌词版本（见 docs/music-player-spec.md 7.2o）：后端是全站用哪一份歌词的唯一依据，前端默认显示它，歌词标注也只按它生成。
// - 歌词流（SSE）：并发获取 TTML（自定义源 / AMLL）、网易云、QQ 音乐与酷狗音乐，每个来源到达即推送（与各来源接口的返回相同），
//   每个来源最多等 lyricStreamSourceTimeout；都到齐或超时后选出全站版本推送 decided
// - 选择：管理员固定的来源（全站默认来源）有歌词时用它；否则按质量排序（与前端 resolve.ts 一致：TTML > 逐字 > 逐行，
//   同一等级时来源自带的翻译、音译越全越好，仍相同时按 TTML、网易云、QQ 音乐、酷狗音乐的顺序）
// - 只升不降：选出的版本保存下来，之后只在出现严格更好的来源、或管理员改了固定的来源时更换；
//   已选的来源这次获取失败（出错或超时）时保持不变，只有确定没有歌词时才重新选择
// - 同一首歌同时只有一次获取与选择（并发的歌词流共用，后来的先补发已有的事件）；客户端中途断开时选择照常在后台完成
// - 选出的版本连同原始数据保存为歌词缓存快照（model.LyricCache）；只保存博客歌单与公开内容中引用的歌曲（管理员设置固定来源时除外），
//   避免公开接口被用来为任意歌曲写入数据

// lyricOutcome 一个歌词来源这次获取的结果：获取失败（出错或超时，不能据此认为没有歌词）、确定没有、或有歌词
type lyricOutcome int

const (
	lyricOutcomeFailed lyricOutcome = iota
	lyricOutcomeMiss
	lyricOutcomeHit
)

const (
	// 一次选择（含各来源获取）的总时限：各来源另有 lyricStreamSourceTimeout，这里只防止意外卡住
	lyricVersionJobTimeout = 30 * time.Second
	// 选出的版本与快照都没有变化时，隔多久刷新一次保存时间（歌词缓存快照的有效期从保存时间算起）
	lyricVersionTouchInterval = 24 * time.Hour
	// 歌词标注接口等待选择的时长：前端会轮询，等不到时先返回 pending
	lyricVersionPollWait = 1500 * time.Millisecond
)

// lyricSourceKinds 歌词来源，按质量相同时的先后顺序排列（与前端 resolve.ts 一致）
var lyricSourceKinds = []string{"ttml", "ncm", "qq", "kugou"}

// errLyricVersionPending 全站歌词版本还没有选出（歌词标注返回 pending）
var errLyricVersionPending = errs.New(http.StatusConflict, "lyric_version_pending", nil)

var (
	// 每个来源最多等多久（超时的来源记为获取失败，后台获取照常完成并进入各自的缓存）；测试时可调整
	lyricStreamSourceTimeout = 8 * time.Second
	// 获取一个来源，测试时可替换
	lyricSourceFetch = func(s *MusicService, ctx context.Context, id int64, kind string) lyricSourceResult {
		return s.fetchLyricSource(ctx, id, kind)
	}
	// 能否保存这首歌的全站版本（博客歌单与公开内容中引用的歌曲），测试时可替换
	lyricVersionPersistable = func(s *MusicService, ctx context.Context, id int64) bool { return s.songPublic(ctx, id) }
	// 选择并保存全站版本时持有：读取固定来源与已选版本、比较、写入是一个整体
	lyricVersionApplyMu sync.Mutex
	lyricVersionRuns    = &lyricVersionJobs{jobs: map[string]*lyricVersionJob{}}
)

// lyricSourceResult 一个来源这次获取的结果：data 为与该来源接口相同的返回（没有时为 nil）
type lyricSourceResult struct {
	kind    string
	data    any
	outcome lyricOutcome
	// QQ 音乐：AMLL TTML DB 按匹配到的 QQ 歌曲 mid 收录的 TTML 的获取结果
	qqTTML lyricOutcome
}

// lyricVersionCandidate 一个有歌词的来源：歌词、等级（越小越好）与只含这一来源（与网易云）的快照
type lyricVersionCandidate struct {
	kind     string
	lines    *lyricVersionLines
	tier     int
	snapshot *dto.MusicLyricCacheDto
}

// lyricSiteVersion 选出的全站版本：来源、歌词与各行文字的哈希（即歌词标注的 lyric_hash）
type lyricSiteVersion struct {
	Kind  string
	Hash  string
	Lines *lyricVersionLines
}

// dto 推送给前端的全站版本；没有歌词时都为空
func (v *lyricSiteVersion) dto() dto.MusicLyricVersionDto {
	if v == nil {
		return dto.MusicLyricVersionDto{}
	}
	return dto.MusicLyricVersionDto{Kind: v.Kind, Source: v.Lines.Source}
}

// fetchLyricSource 获取一个来源（各来源自带缓存与同一首歌的请求合并）
func (s *MusicService) fetchLyricSource(ctx context.Context, id int64, kind string) lyricSourceResult {
	result := lyricSourceResult{kind: kind}
	switch kind {
	case "ncm":
		// 没有歌词时网易云返回占位歌词，照常推送（前端据此显示纯音乐），是否有歌词在选择时判断
		if lyric, svcerr := s.GetLyric(ctx, id); svcerr == nil {
			result.data, result.outcome = lyric, lyricOutcomeHit
		}
	case "ttml":
		lyric, outcome := probeTTMLSources(ctx, id, []string{musicTTMLSourceCustom, musicTTMLSourceAMLL})
		result.outcome = outcome
		if lyric != nil {
			result.data = lyric
		}
	case "qq":
		lyric, ttml, svcerr := s.qqLyricWithTTML(ctx, id)
		result.qqTTML = ttml
		switch {
		case svcerr != nil:
			result.outcome = lyricSourceErrorOutcome(svcerr)
		case lyric.Lyric == "" && lyric.TTML == "":
			result.outcome = lyricOutcomeMiss
		default:
			result.data, result.outcome = lyric, lyricOutcomeHit
		}
	case "kugou":
		lyric, svcerr := s.GetKugouLyric(ctx, id)
		if svcerr != nil {
			result.outcome = lyricSourceErrorOutcome(svcerr)
		} else {
			result.data, result.outcome = lyric, lyricOutcomeHit
		}
	}
	return result
}

// lyricSourceErrorOutcome 来源接口返回 404（没有匹配或没有歌词）为确定没有，其余错误为获取失败
func lyricSourceErrorOutcome(svcerr *errs.ServiceError) lyricOutcome {
	if svcerr.Code == http.StatusNotFound {
		return lyricOutcomeMiss
	}
	return lyricOutcomeFailed
}

// lyricSources 各来源这次的数据（没有或失败时为 nil）
type lyricSources struct {
	ncm   *dto.MusicLyricDto
	ttml  *dto.MusicTTMLDto
	qq    *dto.MusicQQLyricDto
	kugou *dto.MusicKugouLyricDto
}

func collectLyricSources(results map[string]lyricSourceResult) lyricSources {
	var sources lyricSources
	sources.ncm, _ = results["ncm"].data.(*dto.MusicLyricDto)
	sources.ttml, _ = results["ttml"].data.(*dto.MusicTTMLDto)
	sources.qq, _ = results["qq"].data.(*dto.MusicQQLyricDto)
	sources.kugou, _ = results["kugou"].data.(*dto.MusicKugouLyricDto)
	return sources
}

// lyricKindSnapshot 只含某一来源（与网易云：供前端借翻译与单行歌词）的快照；按 QQ 歌曲收录的 TTML 随 QQ 音乐的歌词保存
func lyricKindSnapshot(kind string, sources lyricSources) *dto.MusicLyricCacheDto {
	snapshot := &dto.MusicLyricCacheDto{Kind: kind, Ncm: sources.ncm}
	switch kind {
	case "ttml":
		if sources.ttml != nil {
			snapshot.TTML = sources.ttml
		} else if sources.qq != nil && sources.qq.TTML != "" {
			snapshot.QQ = sources.qq
		}
	case "qq":
		snapshot.QQ = sources.qq
	case "kugou":
		snapshot.Kugou = sources.kugou
	}
	return snapshot
}

// rankLyricCandidates 有歌词的来源，按质量从高到低排序（排序是稳定的：质量相同时保持 lyricSourceKinds 的顺序）
func rankLyricCandidates(sources lyricSources) []lyricVersionCandidate {
	var candidates []lyricVersionCandidate
	for _, kind := range lyricSourceKinds {
		snapshot := lyricKindSnapshot(kind, sources)
		if lines := lyricVersionOf(kind, snapshot); lines != nil {
			candidates = append(candidates, lyricVersionCandidate{kind: kind, lines: lines, tier: lyricTier(kind, lines), snapshot: snapshot})
		}
	}
	sort.SliceStable(candidates, func(a, b int) bool { return lyricCandidateBetter(candidates[a], candidates[b]) })
	return candidates
}

// lyricTier 来源等级（与前端 lyricTier 一致）：TTML 为 0，逐字为 1，逐行为 2
func lyricTier(kind string, lines *lyricVersionLines) int {
	switch {
	case kind == "ttml":
		return 0
	case lines.WordTimed:
		return 1
	default:
		return 2
	}
}

// lyricCandidateBetter a 是否严格比 b 好：等级更高，或等级相同而自带的翻译、音译更全
func lyricCandidateBetter(a, b lyricVersionCandidate) bool {
	return a.tier < b.tier || (a.tier == b.tier && a.lines.Extras > b.lines.Extras)
}

// lyricKindOutcome 某一来源这次是否确定没有歌词：TTML 要按网易云歌曲与按 QQ 歌曲收录的都确定没有才算（QQ 音乐超时时不知道）
func lyricKindOutcome(results map[string]lyricSourceResult, kind string) lyricOutcome {
	if results[kind].outcome == lyricOutcomeFailed || (kind == "ttml" && results["qq"].qqTTML == lyricOutcomeFailed) {
		return lyricOutcomeFailed
	}
	return lyricOutcomeMiss
}

// chooseLyricVersion 选出全站版本（规则见文件开头）：candidates 已按质量排序，pin 为管理员固定的来源，stored 为已选的来源（都可为空）。
// keep 为已选的来源这次获取失败、应保持原样；否则返回选出的来源，没有歌词时为 nil
func chooseLyricVersion(candidates []lyricVersionCandidate, outcome func(kind string) lyricOutcome, pin, stored string) (chosen *lyricVersionCandidate, keep bool) {
	find := func(kind string) *lyricVersionCandidate {
		for i := range candidates {
			if candidates[i].kind == kind {
				return &candidates[i]
			}
		}
		return nil
	}
	if pin != "" {
		if pinned := find(pin); pinned != nil {
			return pinned, false
		}
	}
	if stored != "" {
		if current := find(stored); current != nil {
			if lyricCandidateBetter(candidates[0], *current) {
				return &candidates[0], false
			}
			return current, false
		}
		// 已选的来源这次获取失败（出错或超时）：保持不变，绝不因此降级
		if outcome(stored) == lyricOutcomeFailed {
			return nil, true
		}
	}
	if len(candidates) == 0 {
		return nil, false
	}
	return &candidates[0], false
}

// applyLyricVersion 按这次各来源的结果选出全站版本，persist 时保存（与已保存的相同时不重复写入）；没有歌词时返回 nil
func (s *MusicService) applyLyricVersion(ctx context.Context, id int64, results map[string]lyricSourceResult, persist bool) *lyricSiteVersion {
	lyricVersionApplyMu.Lock()
	defer lyricVersionApplyMu.Unlock()
	db := repo.GetDB().WithContext(ctx)
	var pin model.LyricSongSetting
	if err := db.Where("song_id = ?", id).Limit(1).Find(&pin).Error; err != nil {
		logrus.Warnf("load lyric pin for song %d failed: %v", id, err)
	}
	stored, err := loadLyricVersionRecord(ctx, id)
	if err != nil {
		logrus.Warnf("load lyric version for song %d failed: %v", id, err)
	}
	storedKind := ""
	if stored != nil {
		storedKind = stored.Kind
	}

	candidates := rankLyricCandidates(collectLyricSources(results))
	chosen, keep := chooseLyricVersion(candidates, func(kind string) lyricOutcome { return lyricKindOutcome(results, kind) }, pin.PinnedKind, storedKind)
	if keep {
		return lyricSiteVersionOf(stored)
	}
	if chosen == nil {
		// 所有来源都确定没有歌词（含已选的来源）：不再有全站版本
		if persist && stored != nil {
			db.Where("song_id = ?", id).Delete(&model.LyricCache{})
		}
		return nil
	}
	version := &lyricSiteVersion{Kind: chosen.kind, Hash: lyricLinesHash(id, chosen.lines), Lines: chosen.lines}
	if persist {
		saveLyricVersion(ctx, id, stored, version, chosen.snapshot)
	}
	return version
}

// saveLyricVersion 保存全站版本与快照；版本与快照都没变、且距上次保存不到 lyricVersionTouchInterval 时不写入
func saveLyricVersion(ctx context.Context, id int64, stored *model.LyricCache, version *lyricSiteVersion, snapshot *dto.MusicLyricCacheDto) {
	data, _ := json.Marshal(snapshot)
	if stored != nil && stored.Kind == version.Kind && stored.Source == version.Lines.Source && stored.LyricHash == version.Hash &&
		stored.Data == string(data) && time.Since(stored.UpdatedAt) < lyricVersionTouchInterval {
		return
	}
	record := &model.LyricCache{SongID: id, Kind: version.Kind, Source: version.Lines.Source, LyricHash: version.Hash, Data: string(data), UpdatedAt: time.Now()}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"kind", "source", "lyric_hash", "data", "updated_at"}),
	}
	if err := repo.GetDB().WithContext(ctx).Clauses(upsert).Create(record).Error; err != nil {
		logrus.Errorf("save lyric version for song %d failed: %v", id, err)
	}
}

// loadLyricVersionRecord 已保存的全站版本（不论快照是否过期）；没有时为 nil
func loadLyricVersionRecord(ctx context.Context, id int64) (*model.LyricCache, error) {
	var record model.LyricCache
	err := repo.GetDB().WithContext(ctx).Where("song_id = ?", id).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// lyricSiteVersionOf 从保存的快照还原全站版本（旧数据没有 source 与哈希，按快照计算）；快照里没有这一来源的歌词时为 nil
func lyricSiteVersionOf(record *model.LyricCache) *lyricSiteVersion {
	if record == nil {
		return nil
	}
	var snapshot dto.MusicLyricCacheDto
	if json.Unmarshal([]byte(record.Data), &snapshot) != nil {
		return nil
	}
	lines := lyricVersionOf(record.Kind, &snapshot)
	if lines == nil {
		return nil
	}
	return &lyricSiteVersion{Kind: record.Kind, Hash: lyricLinesHash(record.SongID, lines), Lines: lines}
}

// lyricLinesHash 歌词各行文字的哈希，与歌词标注的 lyric_hash 相同
func lyricLinesHash(id int64, lines *lyricVersionLines) string {
	_, hash := lyricAnnotationKey(id, lines.Texts())
	return hash
}

type lyricVersionWaitKey struct{}

// withLyricVersionWait 全站版本还没有选出时最多等多久（不设置时等到选择完成）
func withLyricVersionWait(ctx context.Context, wait time.Duration) context.Context {
	return context.WithValue(ctx, lyricVersionWaitKey{}, wait)
}

// siteLyricVersion 一首歌的全站歌词版本：已保存时直接读取；还没有时开始（或加入）一次选择并等待，
// 等不到（见 withLyricVersionWait）时返回 errLyricVersionPending，选择完成后没有歌词时返回 404
func (s *MusicService) siteLyricVersion(ctx context.Context, id int64) (*lyricSiteVersion, *errs.ServiceError) {
	record, err := loadLyricVersionRecord(ctx, id)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if version := lyricSiteVersionOf(record); version != nil {
		return version, nil
	}
	job := s.startLyricVersionJob(id, false)
	var timeout <-chan time.Time
	if wait, ok := ctx.Value(lyricVersionWaitKey{}).(time.Duration); ok {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		timeout = timer.C
	}
	select {
	case <-job.done:
	case <-timeout:
		return nil, errLyricVersionPending
	case <-ctx.Done():
		return nil, errLyricVersionPending
	}
	if job.version == nil {
		return nil, errs.NewNotFound("lyric_not_found")
	}
	return job.version, nil
}

// redecideLyricVersion 立即重新选择一首歌的全站版本并等待结果（管理员改了固定的来源后调用；不与读者的选择合并，以便读到新的固定来源），
// 不论歌曲是否在公开范围内都保存
func (s *MusicService) redecideLyricVersion(ctx context.Context, id int64) (*lyricSiteVersion, *errs.ServiceError) {
	job := newLyricVersionJob()
	go s.runLyricVersionJob(job, id, false, true)
	select {
	case <-job.done:
		return job.version, nil
	case <-ctx.Done():
		return nil, errs.NewInternalServer("failed_to_update_target")
	}
}

// StreamLyrics 歌词流：先推送已保存的歌词缓存快照（cache，没有或已过期时不推送），再推送各来源（source，到达即推送）与全站版本（decided），
// 最后推送 done；refresh 为读者「重新获取歌词」（各来源跳过缓存中「没有歌词」的记录，见 music_lyric_refresh.go）。
// send 出错（客户端断开）或 ctx 结束时停止推送，选择照常在后台完成
func (s *MusicService) StreamLyrics(ctx context.Context, id int64, refresh bool, send func(event string, data any) error) {
	if snapshot, svcerr := s.GetLyricCache(ctx, id); svcerr == nil {
		if send("cache", snapshot) != nil {
			return
		}
	}
	job := s.startLyricVersionJob(id, refresh)
	if job.follow(ctx, func(event lyricStreamEvent) error { return send(event.name, event.data) }) != nil {
		return
	}
	_ = send("done", struct{}{})
}

// lyricStreamEvent 歌词流中的一条事件
type lyricStreamEvent struct {
	name string
	data any
}

// lyricVersionJob 一次获取与选择：事件按顺序追加，订阅者先补发已有的再等新的；done 在选择完成后关闭，version 为结果
type lyricVersionJob struct {
	mu      sync.Mutex
	events  []lyricStreamEvent
	wake    chan struct{}
	done    chan struct{}
	version *lyricSiteVersion
}

func newLyricVersionJob() *lyricVersionJob {
	return &lyricVersionJob{wake: make(chan struct{}), done: make(chan struct{})}
}

func (j *lyricVersionJob) push(name string, data any) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.events = append(j.events, lyricStreamEvent{name: name, data: data})
	close(j.wake)
	j.wake = make(chan struct{})
}

func (j *lyricVersionJob) finish(version *lyricSiteVersion) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.version = version
	close(j.done)
	close(j.wake)
	j.wake = make(chan struct{})
}

// follow 依次交出事件直到选择完成；send 出错或 ctx 结束时提前返回错误
func (j *lyricVersionJob) follow(ctx context.Context, send func(lyricStreamEvent) error) error {
	next := 0
	for {
		j.mu.Lock()
		pending := j.events[next:]
		next = len(j.events)
		wake := j.wake
		finished := false
		select {
		case <-j.done:
			finished = true
		default:
		}
		j.mu.Unlock()
		for _, event := range pending {
			if err := send(event); err != nil {
				return err
			}
		}
		if finished {
			return nil
		}
		select {
		case <-wake:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// lyricVersionJobs 进行中的选择，按歌曲 id 与是否刷新区分（刷新要跳过来源缓存中「没有歌词」的记录，不能与普通请求合并）
type lyricVersionJobs struct {
	mu   sync.Mutex
	jobs map[string]*lyricVersionJob
}

// startLyricVersionJob 开始一次选择；这首歌已有进行中的同类选择时加入它
func (s *MusicService) startLyricVersionJob(id int64, refresh bool) *lyricVersionJob {
	key := strconv.FormatInt(id, 10) + ":" + strconv.FormatBool(refresh)
	runs := lyricVersionRuns
	runs.mu.Lock()
	defer runs.mu.Unlock()
	if job := runs.jobs[key]; job != nil {
		return job
	}
	job := newLyricVersionJob()
	runs.jobs[key] = job
	go func() {
		defer func() {
			runs.mu.Lock()
			delete(runs.jobs, key)
			runs.mu.Unlock()
		}()
		s.runLyricVersionJob(job, id, refresh, false)
	}()
	return job
}

// runLyricVersionJob 并发获取各来源，到达即推送；都到齐或超时后选出全站版本，推送 decided 并结束。不随任何请求取消
func (s *MusicService) runLyricVersionJob(job *lyricVersionJob, id int64, refresh, forcePersist bool) {
	var version *lyricSiteVersion
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("lyric version panic for song %d: %v", id, r)
		}
		job.finish(version)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), lyricVersionJobTimeout)
	defer cancel()

	// 获取函数只取一次：超时的来源仍在后台继续获取（结果进入各自的缓存）
	fetch := lyricSourceFetch
	arrived := make(chan lyricSourceResult, len(lyricSourceKinds))
	for _, kind := range lyricSourceKinds {
		go func(kind string) {
			sourceCtx := ctx
			if refresh {
				sourceCtx = WithLyricRefresh(ctx, kind, id)
			}
			arrived <- fetch(s, sourceCtx, id, kind)
		}(kind)
	}
	results := make(map[string]lyricSourceResult, len(lyricSourceKinds))
	timer := time.NewTimer(lyricStreamSourceTimeout)
	defer timer.Stop()
	for len(results) < len(lyricSourceKinds) {
		select {
		case result := <-arrived:
			results[result.kind] = result
			job.push("source", lyricStreamSource(result))
		case <-timer.C:
			// 超时的来源记为获取失败（不代表没有歌词）
			for _, kind := range lyricSourceKinds {
				if _, ok := results[kind]; !ok {
					results[kind] = lyricSourceResult{kind: kind}
					job.push("source", lyricStreamSource(results[kind]))
				}
			}
		}
	}
	version = s.applyLyricVersion(ctx, id, results, forcePersist || lyricVersionPersistable(s, ctx, id))
	job.push("decided", version.dto())
}

func lyricStreamSource(result lyricSourceResult) dto.MusicLyricStreamSourceDto {
	return dto.MusicLyricStreamSourceDto{Kind: result.kind, Data: result.data, Failed: result.outcome == lyricOutcomeFailed}
}
