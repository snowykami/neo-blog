package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	lyricMotionTimeout     = 30 * time.Second
	lyricMotionJobTTL      = 45 * time.Second
	lyricMotionRetryAfter  = 15 * time.Minute
	lyricMotionTemperature = 0.35
	lyricMotionMaxExcerpt  = 48
)

var lyricMotionSystemPrompt = fillLyricAnnotationPrompt(`You are a music motion choreographer selecting the single best song-wide lyric line scroll physics preset for a synchronized lyric stage.
Weigh BOTH:
1. Musical genre, arrangement texture, vocal delivery, and emotional vibe inferred from the title, artists, album, and lyrics.
2. Quantitative empirical pace metrics in <song> (Line progression pace: median s/line, p25 fast-section s/line, verse-to-chorus surge ratio, rapid <1.5s step %, vocal units/s, held note %, step CV, plus Audio tempo BPM when available).

Available 6 presets (choose deliberately across all 6 — "plush" is broadly versatile for warm/mid-tempo grooves; never default blindly to one preset):
{{motions}}

Decision rules calibrated on a 798-song real-world library:
- Pick "crisp" when rapid-fire vocals, rap, EDM, cyberpunk, or driving rock demand instant lock (median ≤2.30s/line, p25 ≤1.60s, rapid ≥22%, or ≥3.9 units/s). Avoid "gentle" or "plush" on rapid tracks.
- Pick "bouncy" when the track is playful, cute, idol, denpa, cheerful anime OP, or bouncy dance-pop (median ~2.2–3.5s/line or p25 ≤2.2s with upbeat energy).
- Pick "gentle" when the track is a slow, spacious piano/acoustic/strings ballad, lullaby, classical/poetic song, or quiet sorrow (median ≥4.55s/line with p25 ≥3.25s, or abundant held notes and calm mood). Avoid "crisp" or "bouncy".
- Pick "cascade" when the track has theatrical, jazz/waltz, musical, grand orchestral OST character, or dramatic dynamic contrast between calm verses and surging choruses (step CV ≥0.45 or surge ≥1.65x).
- Pick "plush" for warm, cushioned mid-tempo / mid-slow pop, R&B, City Pop, healing synth/acoustic pop, lo-fi groove, or tender emotional pop (median ~3.0–5.4s/line, low rapid %). "plush" works naturally across a wide range of warm/relaxed songs.
- Pick "flow" for steady, forward-moving classic J-Pop/C-Pop, narrative pop-rock, or melodic anime themes with even line cadence (median ~2.6–3.8s/line) where zero bounce feels cleanest.

Reply with strictly one JSON object only:
{"motion":"plush"}`)

type lyricMotionService struct {
	name        string
	initOnce    sync.Once
	mu          sync.Mutex
	limiter     *llmclient.Limiter
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
	done        func()
}

var lyricMotions = &lyricMotionService{
	name:    "lyric_motion",
	limiter: llmclient.DefaultLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricMotionTemperature, "none")
	},
	concurrency: tools.GetAISummaryConcurrency,
}

func lookupCachedSongBPM(id int64) float64 {
	if id <= 0 {
		return 0
	}
	analysis, svcerr := loadSavedSongRhythm(id)
	if svcerr != nil || analysis == nil {
		return 0
	}
	if analysis.BPM >= 45 && analysis.BPM <= 240 && analysis.Confidence >= 0.25 {
		return analysis.BPM
	}
	return 0
}

func syncLyricMotionFromAnnotation(songID int64, hash, source, modelName, motion string) {
	motion = strings.ToLower(strings.TrimSpace(motion))
	if songID <= 0 || hash == "" || !lyricAnnotationMotions[motion] {
		return
	}
	db := repo.GetDB()
	if db == nil {
		return
	}
	now := time.Now()
	record := &model.LyricMotion{
		SongID:    songID,
		LyricHash: hash,
		Motion:    motion,
		Source:    source,
		Model:     modelName,
		CreatedAt: now,
		UpdatedAt: now,
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "lyric_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"motion", "source", "model", "updated_at"}),
	}
	if err := db.Clauses(upsert).Create(record).Error; err != nil {
		logrus.Warnf("sync lyric motion for song %d failed: %v", songID, err)
	}
}

func (s *MusicService) resolveMotionTrack(ctx context.Context, id int64) *dto.MusicTrackDto {
	if id <= 0 {
		return nil
	}
	if track := s.annotatableTrack(ctx, id); track != nil {
		return track
	}
	if ctxutils.IsAdmin(ctx) {
		if song, svcerr := s.GetSong(ctx, id); svcerr == nil {
			return &dto.MusicTrackDto{
				ID:       song.ID,
				Name:     song.Name,
				Artists:  song.Artists,
				Album:    song.Album,
				AlbumPic: song.AlbumPic,
				Link:     song.Link,
				Duration: song.Duration,
			}
		}
	}
	return nil
}

// resolveMotionSourceLines 提取用于计算与生成歌词弹性的歌词行与结构化时间信息（同时支持逐字歌词与逐行 LRC）
func (s *MusicService) resolveMotionSourceLines(ctx context.Context, track *dto.MusicTrackDto, source string) ([]string, lyricAnnotationInfo, *errs.ServiceError) {
	if source != "" && !lyricSettingSources[source] {
		return nil, lyricAnnotationInfo{}, errs.NewBadRequest("invalid_request_parameters")
	}
	var vLines *lyricVersionLines
	if source == "" {
		version, svcerr := s.siteLyricVersion(ctx, track.ID)
		if svcerr != nil {
			return nil, lyricAnnotationInfo{}, svcerr
		}
		if version == nil || version.Lines == nil || len(version.Lines.Timed) == 0 {
			return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
		}
		vLines = version.Lines
	} else {
		snapshot, _ := s.GetLyricCache(ctx, track.ID)
		switch source {
		case "ttml-custom", "ttml-amll":
			rawTTML := s.resolveRawTTMLForSource(ctx, track.ID, source, snapshot)
			if rawTTML == "" {
				return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
			}
			parsed := parseTTMLLyrics(rawTTML)
			if len(parsed.Lines) == 0 {
				return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
			}
			vLines = &lyricVersionLines{
				Source:       source,
				WordTimed:    parsed.WordTimed,
				Timed:        parsed.Lines,
				Translations: parsed.Translations,
				Agents:       parsed.Agents,
			}
		case "ncm-yrc", "ncm-lrc":
			ncm := s.resolveNCMLyric(ctx, track.ID, snapshot)
			if ncm == nil {
				return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
			}
			wordTimed := source == "ncm-yrc"
			var raw string
			if wordTimed && ncm.Yrc != nil {
				raw = ncm.Yrc.Lyric
			} else if !wordTimed && ncm.Lrc != nil {
				raw = ncm.Lrc.Lyric
			}
			timed := lyricTimedLines(raw, lyricAnnotationMaxLines)
			if len(timed) == 0 {
				return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
			}
			vLines = &lyricVersionLines{
				Source:       source,
				WordTimed:    wordTimed,
				Timed:        timed,
				Translations: alignLyricTranslations(timed, lyricTranslationSource(ncm, wordTimed)),
			}
		case "qq-qrc", "qq-lrc":
			qq := s.resolveQQLyric(ctx, track.ID, snapshot)
			if qq == nil || (source == "qq-qrc") != (qq.Format == "qrc") {
				return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
			}
			vLines = platformVersion(qq.Format, qq.Lyric, qq.Translation, qq.Romanization, "qq-qrc", "qq-lrc")
		case "kugou-krc", "kugou-lrc":
			kugou := s.resolveKugouLyric(ctx, track.ID, snapshot)
			if kugou == nil || (source == "kugou-krc") != (kugou.Format == "qrc") {
				return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
			}
			vLines = platformVersion(kugou.Format, kugou.Lyric, kugou.Translation, kugou.Romanization, "kugou-krc", "kugou-lrc")
		}
		if vLines == nil || len(vLines.Timed) == 0 {
			return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
		}
	}

	info := lyricAnnotationInfo{
		Title:        track.Name,
		Artists:      track.Artists,
		Album:        track.Album,
		Aliases:      track.Aliases,
		Translations: vLines.Translations,
		Timed:        vLines.Timed,
		Agents:       vLines.Agents,
		WordTimed:    vLines.WordTimed,
		Source:       vLines.Source,
		Duration:     track.Duration,
	}
	return vLines.Texts(), info, nil
}

// GetLyricMotion 获取一首歌的歌词上浮弹性（支持逐字与逐行 LRC，也支持关闭歌词特效时独立使用）：
// 优先读取独立缓存与已有的歌词标注，未命中时立即返回经歌单实测标定的启发式预设并在后台启动轻量级 AI 识别。
func (s *MusicService) GetLyricMotion(ctx context.Context, id int64, source string) (*dto.MusicLyricMotionDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	track := s.resolveMotionTrack(ctx, id)
	if track == nil {
		return nil, errs.NewNotFound("lyric_annotations_unavailable")
	}
	lines, info, svcerr := s.resolveMotionSourceLines(withLyricVersionWait(ctx, lyricVersionPollWait), track, source)
	if svcerr == errLyricVersionPending {
		return &dto.MusicLyricMotionDto{
			Status: lyricAnnotationStatusPending,
			Motion: "plush",
		}, nil
	}
	if svcerr != nil {
		return nil, svcerr
	}
	ttl := time.Duration(tools.GetLyricAnnotationTTLDays()) * 24 * time.Hour
	return lyricMotions.getOrStart(id, lines, info, ttl)
}

// RefreshLyricMotion 管理员单独重新生成一首歌的 AI 歌词上浮弹性（不覆盖手动编辑的短语特效，仅同步更新弹性预设）
func (s *MusicService) RefreshLyricMotion(ctx context.Context, id int64, source string) (*dto.MusicLyricMotionDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_annotations_unavailable")
	}
	track := s.resolveMotionTrack(ctx, id)
	if track == nil {
		return nil, errs.NewNotFound("lyric_annotations_unavailable")
	}
	lines, info, svcerr := s.resolveMotionSourceLines(ctx, track, source)
	if svcerr != nil {
		return nil, svcerr
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	return lyricMotions.refresh(id, lines, info, cfg), nil
}

func (m *lyricMotionService) prefix() string {
	m.initOnce.Do(func() {
		if m.name == "" {
			m.name = "lyric_motion_" + utils.Strings.GenerateRandomString(8)
		}
	})
	return m.name
}

func (m *lyricMotionService) stateKeys(key string) (job, failed string) {
	return m.prefix() + ":job:" + key, m.prefix() + ":failed:" + key
}

func (m *lyricMotionService) jobState(key string) (running, coolingDown bool) {
	jobKey, failedKey := m.stateKeys(key)
	values, err := sharedstate.Current().GetMany(jobKey, failedKey)
	if err != nil {
		return false, false
	}
	_, running = values[jobKey]
	_, coolingDown = values[failedKey]
	return running, coolingDown
}

func (m *lyricMotionService) getOrStart(id int64, lines []string, info lyricAnnotationInfo, ttl time.Duration) (*dto.MusicLyricMotionDto, *errs.ServiceError) {
	key, hash := lyricAnnotationKey(id, lines)
	heuristic := suggestHeuristicLyricMotion(info)
	db := repo.GetDB()
	if db == nil {
		return &dto.MusicLyricMotionDto{Status: lyricAnnotationStatusReady, Source: info.Source, Motion: heuristic}, nil
	}

	var motionRec model.LyricMotion
	err := db.Where("song_id = ? AND lyric_hash = ?", id, hash).First(&motionRec).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if err == nil && lyricAnnotationMotions[motionRec.Motion] {
		m.mu.Lock()
		running, coolingDown := m.jobState(key)
		cfg := tools.GetAIConfig()
		refTimestamp := motionRec.UpdatedAt
		if refTimestamp.IsZero() {
			refTimestamp = motionRec.CreatedAt
		}
		if !running && !coolingDown && motionRec.Model != "manual" && cfg.Configured() && ttl > 0 && time.Since(refTimestamp) > ttl && checkSiteAIBudget(time.Now()) == nil {
			m.startLocked(key, id, hash, lines, info, cfg, false)
			running = true
		}
		m.mu.Unlock()
		return &dto.MusicLyricMotionDto{
			Status: lyricAnnotationStatusReady,
			Stale:  running,
			Source: info.Source,
			Motion: motionRec.Motion,
			AI:     motionRec.Model != "" && motionRec.Model != "heuristic",
		}, nil
	}

	// 兼容复用已有的完整歌词标注（回填独立表，无需重复请求大模型）
	var annRec model.LyricAnnotation
	if annErr := db.Where("song_id = ? AND lyric_hash = ?", id, hash).First(&annRec).Error; annErr == nil {
		parsed := parseLyricAnnotationData(annRec.Data)
		resolved := parsed.Motion
		if !lyricAnnotationMotions[resolved] && annRec.EditedAt != nil {
			resolved = "flow"
		}
		if lyricAnnotationMotions[resolved] {
			modelName := annRec.Model
			if annRec.EditedAt != nil {
				modelName = "manual"
			}
			syncLyricMotionFromAnnotation(id, hash, info.Source, modelName, resolved)
			return &dto.MusicLyricMotionDto{
				Status: lyricAnnotationStatusReady,
				Source: info.Source,
				Motion: resolved,
				AI:     true,
			}, nil
		}
	}

	// 若完整歌词特效任务正在跑：Stage-1 规划已完成则直接取 partial.Motion，否则复用该任务等待完成，避免并发双倍调模型
	if partial := lyricAnnotations.loadPartial(key, lines); partial != nil && lyricAnnotationMotions[partial.Motion] {
		return &dto.MusicLyricMotionDto{
			Status: lyricAnnotationStatusReady,
			Source: info.Source,
			Motion: partial.Motion,
			AI:     true,
		}, nil
	}
	if lyricAnnotations.running(key) {
		return &dto.MusicLyricMotionDto{
			Status: lyricAnnotationStatusPending,
			Source: info.Source,
			Motion: heuristic,
		}, nil
	}

	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return &dto.MusicLyricMotionDto{
			Status: lyricAnnotationStatusReady,
			Source: info.Source,
			Motion: heuristic,
		}, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	running, coolingDown := m.jobState(key)
	if running {
		return &dto.MusicLyricMotionDto{
			Status: lyricAnnotationStatusPending,
			Source: info.Source,
			Motion: heuristic,
		}, nil
	}
	if coolingDown || checkSiteAIBudget(time.Now()) != nil {
		return &dto.MusicLyricMotionDto{
			Status: lyricAnnotationStatusReady,
			Source: info.Source,
			Motion: heuristic,
		}, nil
	}
	m.startLocked(key, id, hash, lines, info, cfg, false)
	return &dto.MusicLyricMotionDto{
		Status: lyricAnnotationStatusPending,
		Source: info.Source,
		Motion: heuristic,
	}, nil
}

func (m *lyricMotionService) refresh(id int64, lines []string, info lyricAnnotationInfo, cfg tools.AIConfig) *dto.MusicLyricMotionDto {
	key, hash := lyricAnnotationKey(id, lines)
	current := suggestHeuristicLyricMotion(info)
	if db := repo.GetDB(); db != nil {
		var existing model.LyricMotion
		if db.Where("song_id = ? AND lyric_hash = ?", id, hash).First(&existing).Error == nil && lyricAnnotationMotions[existing.Motion] {
			current = existing.Motion
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if running, _ := m.jobState(key); !running {
		m.startLocked(key, id, hash, lines, info, cfg, true)
	}
	return &dto.MusicLyricMotionDto{
		Status: lyricAnnotationStatusPending,
		Source: info.Source,
		Motion: current,
	}
}

func (m *lyricMotionService) startLocked(key string, id int64, hash string, lines []string, info lyricAnnotationInfo, cfg tools.AIConfig, syncAnnotation bool) {
	jobKey, failedKey := m.stateKeys(key)
	lease, err := sharedstate.AcquireLease(jobKey, lyricMotionJobTTL)
	if err != nil || lease == nil {
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	go m.execute(lease, key, id, hash, lines, info, cfg, syncAnnotation)
}

func buildLyricMotionUserPrompt(info lyricAnnotationInfo, lines []string) string {
	var b strings.Builder
	writeLyricAnnotationSong(&b, info, true)
	b.WriteString("\n<lyrics_excerpt>\n")
	if len(lines) <= lyricMotionMaxExcerpt {
		for i, line := range lines {
			writeCompactMotionLine(&b, i, line, info)
		}
	} else {
		// 均匀抽样全曲前、中、后代表行，兼顾前奏主歌与副歌尾声且极省 Token
		step := float64(len(lines)-1) / float64(lyricMotionMaxExcerpt-1)
		lastIdx := -1
		for k := 0; k < lyricMotionMaxExcerpt; k++ {
			idx := int(float64(k)*step + 0.5)
			if idx <= lastIdx || idx >= len(lines) {
				continue
			}
			lastIdx = idx
			writeCompactMotionLine(&b, idx, lines[idx], info)
		}
	}
	b.WriteString("</lyrics_excerpt>\n")
	return b.String()
}

func writeCompactMotionLine(b *strings.Builder, idx int, text string, info lyricAnnotationInfo) {
	fmt.Fprintf(b, "%d: %s", idx, text)
	if idx < len(info.Timed) {
		t := info.Timed[idx]
		if t.End > t.Start && t.Start >= 0 {
			fmt.Fprintf(b, " [%.1fs]", float64(t.End-t.Start)/1000.0)
		}
		if t.Held != nil {
			fmt.Fprintf(b, " [held %.1fs]", float64(t.Held.Duration)/1000.0)
		}
	}
	if idx < len(info.Translations) && info.Translations[idx] != "" {
		fmt.Fprintf(b, " (%s)", info.Translations[idx])
	}
	b.WriteByte('\n')
}

func parseStandaloneLyricMotion(raw string) (string, error) {
	obj, err := extractJSONObject(raw)
	if err != nil {
		return "", err
	}
	var parsed struct {
		Motion string `json:"motion"`
	}
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return "", err
	}
	motion := strings.ToLower(strings.TrimSpace(parsed.Motion))
	if !lyricAnnotationMotions[motion] {
		return "", fmt.Errorf("invalid motion %q", parsed.Motion)
	}
	return motion, nil
}

func (m *lyricMotionService) callFirstScreen(cfg tools.AIConfig, system, user string) (string, error) {
	limiter := m.limiter
	if limiter == nil {
		limiter = llmclient.DefaultLimiter
	}
	concurrency := m.concurrency
	if concurrency == nil {
		concurrency = tools.GetAISummaryConcurrency
	}
	_ = limiter.AcquireTier(context.Background(), concurrency, llmclient.TierFirstScreen, nil)
	defer limiter.Release()

	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeLyricAnnotation, 0), lyricMotionTimeout)
	defer cancel()
	return m.complete(ctx, cfg, system, user)
}

func (m *lyricMotionService) execute(lease *sharedstate.Lease, key string, id int64, hash string, lines []string, info lyricAnnotationInfo, cfg tools.AIConfig, syncAnnotation bool) {
	startedAt := time.Now()
	var err error
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("lyric motion panic for song %d: %v", id, r)
			err = fmt.Errorf("panic: %v", r)
		}
		if err != nil {
			_, failedKey := m.stateKeys(key)
			_ = sharedstate.Current().Set(failedKey, "1", lyricMotionRetryAfter)
		}
		lease.Release()
		if m.done != nil {
			m.done()
		}
	}()

	// 若非管理员显式刷新且完整歌词标注任务已在运行，直接让渡由完整标注任务一并生成，避免重复调用大模型
	if !syncAnnotation && lyricAnnotations.running(key) {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), lyricMotionTimeout)
	defer cancel()
	if !info.WordTimed && lyricAnnotations.wordTimed != nil {
		if rawWord := lyricAnnotations.wordTimed(ctx, id); rawWord != "" {
			info.Timed = borrowHeldNotes(info.Timed, rawWord)
		}
	}
	if info.VisualTheme == "" {
		info.VisualTheme = lookupLyricDirectorVisualTheme(id, lines)
	}
	if info.BPM <= 0 {
		info.BPM = lookupCachedSongBPM(id)
	}

	if !syncAnnotation && lyricAnnotations.running(key) {
		return
	}

	user := buildLyricMotionUserPrompt(info, lines)
	var motion string
	for attempt := 0; attempt <= 1; attempt++ {
		var raw string
		raw, err = m.callFirstScreen(cfg, lyricMotionSystemPrompt, user)
		if err == nil {
			motion, err = parseStandaloneLyricMotion(raw)
		}
		if err == nil {
			break
		}
	}
	if err != nil {
		logrus.Warnf("standalone lyric motion failed for song %d: %v", id, err)
		return
	}

	if err := saveGeneratedStandaloneMotion(id, hash, info.Source, cfg.Model, motion, startedAt, syncAnnotation); err != nil {
		if !errors.Is(err, errLyricAnnotationDeleted) && !errors.Is(err, errLyricAnnotationEdited) {
			logrus.Warnf("save standalone lyric motion for song %d failed: %v", id, err)
		}
	}
}

func saveGeneratedStandaloneMotion(songID int64, hash, source, modelName, motion string, startedAt time.Time, syncAnnotation bool) error {
	db := repo.GetDB()
	if db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), lyricAnnotationWriteLockWait)
	defer cancel()
	release, err := sharedstate.Lock(ctx, lyricAnnotations.writeLockKey(), lyricAnnotationWriteLockTTL)
	if err != nil {
		return err
	}
	defer release()

	var deleted map[int64]int64
	if _, err := sharedstate.GetJSON(lyricAnnotations.deletedKey(), &deleted); err != nil {
		return err
	}
	if at, ok := deleted[songID]; ok && at >= startedAt.UnixNano() {
		return errLyricAnnotationDeleted
	}

	if !syncAnnotation {
		var existingMotion model.LyricMotion
		if db.Where("song_id = ? AND lyric_hash = ?", songID, hash).First(&existingMotion).Error == nil {
			if existingMotion.Model == "manual" || existingMotion.UpdatedAt.After(startedAt) {
				return errLyricAnnotationEdited
			}
		}
		var existingAnn model.LyricAnnotation
		if db.Where("song_id = ? AND lyric_hash = ?", songID, hash).First(&existingAnn).Error == nil {
			if existingAnn.EditedAt != nil || existingAnn.CreatedAt.After(startedAt) {
				return errLyricAnnotationEdited
			}
		}
	}

	now := time.Now()
	record := &model.LyricMotion{
		SongID:    songID,
		LyricHash: hash,
		Motion:    motion,
		Source:    source,
		Model:     modelName,
		CreatedAt: now,
		UpdatedAt: now,
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "lyric_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"motion", "source", "model", "updated_at"}),
	}
	if err := db.Clauses(upsert).Create(record).Error; err != nil {
		return err
	}

	if syncAnnotation && !lyricAnnotations.running(fmt.Sprintf("%d:%s", songID, hash)) {
		var existingAnn model.LyricAnnotation
		if db.Where("song_id = ? AND lyric_hash = ?", songID, hash).First(&existingAnn).Error == nil {
			data := parseLyricAnnotationData(existingAnn.Data)
			if data.Motion != motion {
				data.Motion = motion
				if raw, mErr := json.Marshal(data); mErr == nil {
					_ = db.Model(&model.LyricAnnotation{}).Where("id = ?", existingAnn.ID).Update("data", string(raw)).Error
				}
			}
		}
	}
	return nil
}
