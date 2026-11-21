package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
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

// AI 歌词翻译服务：按「歌曲 id + 歌词来源 + 歌词文本哈希 + 目标语言」生成并缓存逐行歌词翻译。
// - 语言判定（见 music_translation_lang.go）：检测原词语言与歌词自带翻译语言，若目标语言已有原生翻译或整曲已属目标语言则返回 ready，不消耗模型额度
// - 参考译文：跨语言翻译时送入非目标语言参考译文；同语种覆盖默认不带内置参考译文以防锚定，仅由 Stage 1 导演判定为造语/摩斯电码等抽象歌词时才透传参考译文
// - 非唱词过滤：歌手名提示行、段落标注与署名行不翻译；行首歌手名/声部提示前缀先剥离再译，译文保留对应原行匹配键
// - 多词源独立缓存：ttml-amll / ttml-custom / ncm-yrc / ncm-lrc / qq-qrc / qq-lrc / kugou-krc / kugou-lrc 各自按其文本与来源单独翻译

const (
	lyricTranslationStatusReady   = "ready"
	lyricTranslationStatusPending = "pending"

	lyricTranslationMaxLines     = 320
	lyricTranslationMaxLineRunes = 500
	lyricTranslationMaxRetries   = 1
	lyricTranslationTimeout      = 2 * time.Minute
	lyricTranslationJobTTL       = 5 * time.Minute
	lyricTranslationRetryAfter   = 5 * time.Minute
	lyricTranslationTemperature  = 0.3
)

var (
	lyricTranslationRetryDelay = time.Second
	lyricAllLRCTimesRe         = regexp.MustCompile(`\[(\d+):(\d+)(?:[.:](\d+))?\]`)
)

type musicLyricTranslationStreamDone struct {
	Status       string `json:"status"`
	Source       string `json:"source,omitempty"`
	TargetLang   string `json:"target_lang"`
	Native       bool   `json:"native,omitempty"`
	SameLanguage bool   `json:"same_language,omitempty"`
}

// lyricTranslationService 管理多语言歌词 AI 翻译任务的生命周期（共享状态互斥 + 单产多消广播 + 失败冷却）
type lyricTranslationService struct {
	name        string
	initOnce    sync.Once
	mu          sync.Mutex
	limiter     *llmclient.Limiter
	director    *lyricDirectorService
	stream      func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content string) error) error
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
	done        func()
	hubOnce     sync.Once
	hubVal      *lyricStreamHub[dto.MusicLyricTranslationLine, musicLyricTranslationStreamDone]
}

var lyricTranslations = &lyricTranslationService{
	name:     "lyric_translation",
	limiter:  llmclient.DefaultLimiter,
	director: lyricDirectors,
	stream: func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content string) error) error {
		temp := lyricTranslationTemperature
		return chatCompletionStreamWithOptions(ctx, cfg, system, user, &temp, tools.GetAILyricTranslationThinking(), func(content, _ string) error {
			if content == "" {
				return nil
			}
			return onChunk(content)
		})
	},
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricTranslationTemperature, tools.GetAILyricTranslationThinking())
	},
	concurrency: tools.GetAISummaryConcurrency,
}

type lyricTranslationData struct {
	Lines []dto.MusicLyricTranslationLine `json:"lines"`
}

// lyricTranslationExtracted 解析来源后与前端行粒度对齐的候选歌词行
type lyricTranslationExtracted struct {
	Start         int64
	Text          string
	Bg            bool
	BuiltInByLang map[string]string
}

// lyricTranslationLineTask 送往模型翻译的单行任务及最终匹配所需的原行定位键
type lyricTranslationLineTask struct {
	Index      int // 1-based，对应模型输入/输出的 i
	OrigText   string
	VocalText  string
	Occurrence int
	Bg         bool
	Hint       bool
	RefText    string
}

// lyricTranslationInput 完成解析、语言检测与过滤后可供缓存查询或 AI 生成的任务描述
type lyricTranslationInput struct {
	Track            *dto.MusicTrackDto
	Source           string
	TargetLang       string
	LyricHash        string
	OrigLang         string
	RefLang          string
	NativeTarget     bool
	SameLanguage     bool
	ClassicalMode    bool
	ClassicalChinese bool
	Tasks            []lyricTranslationLineTask
}

// GetLyricTranslations 获取指定歌曲、歌词来源、目标语言的 AI 翻译；尚未生成时开启后台任务并返回 pending
func (s *MusicService) GetLyricTranslations(ctx context.Context, id int64, source, lang string) (*dto.MusicLyricTranslationsDto, *errs.ServiceError) {
	targetLang, track, svcerr := s.prepareTranslationAccess(ctx, id, source, lang)
	if svcerr != nil {
		return nil, svcerr
	}
	input, svcerr := s.extractTranslationInput(withLyricVersionWait(ctx, lyricVersionPollWait), track, source, targetLang)
	if svcerr == errLyricVersionPending {
		return &dto.MusicLyricTranslationsDto{
			Status:     lyricTranslationStatusPending,
			TargetLang: targetLang,
			Lines:      []dto.MusicLyricTranslationLine{},
		}, nil
	}
	if svcerr != nil {
		return nil, svcerr
	}
	if input.SameLanguage {
		return &dto.MusicLyricTranslationsDto{
			Status:       lyricTranslationStatusReady,
			Source:       input.Source,
			TargetLang:   targetLang,
			SameLanguage: true,
			Lines:        []dto.MusicLyricTranslationLine{},
		}, nil
	}
	if input.NativeTarget && !lyricTranslations.hasOverrideOrRunning(input) {
		return &dto.MusicLyricTranslationsDto{
			Status:     lyricTranslationStatusReady,
			Source:     input.Source,
			TargetLang: targetLang,
			Native:     true,
			Lines:      []dto.MusicLyricTranslationLine{},
		}, nil
	}
	return lyricTranslations.getOrStart(input)
}

// StreamLyricTranslations 以 SSE 推送指定歌曲、歌词来源、目标语言的 AI 翻译：
// 已就绪时立即回放完整行并发送 done；生成中时先回放共享状态中的历史行再无缝接入单生产者实时广播流。
// 权限、参数、冷却或预算等校验失败均在调用 onReady 之前返回，便于控制器输出常规 JSON 错误响应。
func (s *MusicService) StreamLyricTranslations(
	ctx context.Context,
	id int64,
	source, lang string,
	onReady func(),
	send func(event string, data any) error,
) *errs.ServiceError {
	targetLang, track, svcerr := s.prepareTranslationAccess(ctx, id, source, lang)
	if svcerr != nil {
		return svcerr
	}
	input, svcerr := s.extractTranslationInput(withLyricVersionWait(ctx, 10*time.Second), track, source, targetLang)
	if svcerr != nil {
		return svcerr
	}
	if input.SameLanguage {
		onReady()
		_ = send("done", musicLyricTranslationStreamDone{
			Status:       lyricTranslationStatusReady,
			Source:       input.Source,
			TargetLang:   targetLang,
			SameLanguage: true,
		})
		return nil
	}
	if input.NativeTarget && !lyricTranslations.hasOverrideOrRunning(input) {
		onReady()
		_ = send("done", musicLyricTranslationStreamDone{
			Status:     lyricTranslationStatusReady,
			Source:     input.Source,
			TargetLang: targetLang,
			Native:     true,
		})
		return nil
	}
	return lyricTranslations.streamWithReplay(ctx, input, onReady, send)
}

// RefreshLyricTranslations 管理员手动触发重新翻译一首歌指定来源与目标语言的歌词（忽略冷却与已有缓存，支持覆盖内置翻译），返回 pending
func (s *MusicService) RefreshLyricTranslations(ctx context.Context, id int64, source, lang string) (*dto.MusicLyricTranslationsDto, *errs.ServiceError) {
	targetLang, track, svcerr := s.prepareTranslationAccess(ctx, id, source, lang)
	if svcerr != nil {
		return nil, svcerr
	}
	input, svcerr := s.extractTranslationInput(withLyricVersionWait(ctx, lyricVersionPollWait), track, source, targetLang)
	if svcerr == errLyricVersionPending {
		return &dto.MusicLyricTranslationsDto{
			Status:     lyricTranslationStatusPending,
			TargetLang: targetLang,
			Lines:      []dto.MusicLyricTranslationLine{},
		}, nil
	}
	if svcerr != nil {
		return nil, svcerr
	}
	if input.SameLanguage {
		return &dto.MusicLyricTranslationsDto{
			Status:       lyricTranslationStatusReady,
			Source:       input.Source,
			TargetLang:   targetLang,
			SameLanguage: true,
			Lines:        []dto.MusicLyricTranslationLine{},
		}, nil
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	return lyricTranslations.refresh(input, cfg), nil
}

// GetLyricTranslationLanguages 查询指定歌曲和词源下各支持目标语言的翻译可用状态（只读查询与运行状态检查，绝不触发 AI 生成）
func (s *MusicService) GetLyricTranslationLanguages(ctx context.Context, id int64, source string) (*dto.MusicLyricTranslationLanguagesDto, *errs.ServiceError) {
	if id <= 0 || (source != "" && !lyricSettingSources[source]) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	track := s.annotatableTrack(ctx, id)
	if track == nil {
		return nil, errs.NewNotFound("song_not_found")
	}
	resolvedSource, extracted, snapshot, svcerr := s.extractTranslationSourceLines(withLyricVersionWait(ctx, lyricVersionPollWait), track, source)
	if svcerr == errLyricVersionPending {
		return &dto.MusicLyricTranslationLanguagesDto{
			Status:    lyricTranslationStatusPending,
			Languages: []dto.MusicLyricTranslationLangStatusDto{},
		}, nil
	}
	if svcerr != nil {
		return nil, svcerr
	}

	var records []model.LyricTranslation
	if err := repo.GetDB().Where("song_id = ? AND source = ?", track.ID, resolvedSource).Find(&records).Error; err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	existingAI := make(map[string]bool, len(records))
	for _, rec := range records {
		if len(parseLyricTranslationData(rec.Data).Lines) > 0 {
			existingAI[rec.TargetLang+"|"+rec.LyricHash] = true
		}
	}

	orderedLangs := []string{"zh", "zh-tw", "zh-hk", "en", "ja", "ko"}
	statuses := make([]dto.MusicLyricTranslationLangStatusDto, 0, len(orderedLangs))
	origLang := ""
	var vocalTexts []string
	for _, lang := range orderedLangs {
		inp := s.buildTranslationInputFromExtracted(ctx, track, resolvedSource, extracted, snapshot, lang)
		if origLang == "" {
			origLang = inp.OrigLang
		}
		if vocalTexts == nil {
			vocalTexts = make([]string, 0, len(inp.Tasks))
			for _, task := range inp.Tasks {
				if !task.Hint {
					vocalTexts = append(vocalTexts, task.VocalText)
				}
			}
		}
		running, _ := lyricTranslations.jobState(translationStateKey(inp))
		statuses = append(statuses, dto.MusicLyricTranslationLangStatusDto{
			Lang:         lang,
			HasAI:        existingAI[lang+"|"+inp.LyricHash],
			HasNative:    inp.NativeTarget,
			Generating:   running,
			SameLanguage: inp.SameLanguage,
		})
	}
	songLang := resolveSongDisplayLang(track.ID, resolvedSource, vocalTexts, origLang)
	return &dto.MusicLyricTranslationLanguagesDto{
		Status:    lyricTranslationStatusReady,
		Source:    resolvedSource,
		OrigLang:  origLang,
		SongLang:  songLang,
		Languages: statuses,
	}, nil
}

// resolveSongDisplayLang 只读汇总歌曲的标准展示语种（BCP-47 小写）：优先复用 AI 导演分析、AI 歌词标注与 AI 读音结果，最后回退到启发式识别
func resolveSongDisplayLang(songID int64, source string, vocalTexts []string, rawOrigLang string) string {
	if lang := lookupLyricDirectorSongLang(songID, vocalTexts); lang != "" {
		return lang
	}
	if lang := lookupLyricAnnotationSongLang(songID, source, vocalTexts); lang != "" {
		return lang
	}
	if lang := lookupLyricPronunciationSongLang(songID, source, vocalTexts); lang != "" {
		return lang
	}
	return heuristicSongDisplayLang(vocalTexts, rawOrigLang)
}

func lookupLyricAnnotationSongLang(songID int64, source string, vocalTexts []string) string {
	if songID <= 0 {
		return ""
	}
	db := repo.GetDB()
	if db == nil {
		return ""
	}
	var records []model.LyricAnnotation
	if err := db.Select("source, data, created_at").Where("song_id = ?", songID).Order("created_at DESC").Limit(4).Find(&records).Error; err != nil {
		return ""
	}
	for pass := 0; pass < 2; pass++ {
		for _, rec := range records {
			if (pass == 0) != (source != "" && rec.Source == source) {
				continue
			}
			parsed := parseLyricAnnotationData(rec.Data)
			if lang := validateSongLangWithTexts(parsed.SongLang, vocalTexts); lang != "" {
				return lang
			}
		}
	}
	return ""
}

func lookupLyricPronunciationSongLang(songID int64, source string, vocalTexts []string) string {
	if songID <= 0 {
		return ""
	}
	db := repo.GetDB()
	if db == nil {
		return ""
	}
	var rec model.LyricPronunciation
	query := db.Select("lang").Where("song_id = ? AND lang <> '' AND lang <> 'other'", songID)
	if source != "" {
		if err := query.Where("source = ?", source).Order("updated_at DESC").First(&rec).Error; err != nil {
			_ = db.Select("lang").Where("song_id = ? AND lang <> '' AND lang <> 'other'", songID).Order("updated_at DESC").First(&rec).Error
		}
	} else {
		_ = query.Order("updated_at DESC").First(&rec).Error
	}
	switch strings.ToLower(strings.TrimSpace(rec.Lang)) {
	case "zh-hk":
		return validateSongLangWithTexts("yue", vocalTexts)
	case "zh-tw":
		if songHasClassicalChinese(vocalTexts) {
			return validateSongLangWithTexts("lzh", vocalTexts)
		}
		return validateSongLangWithTexts("zh-tw", vocalTexts)
	case "zh":
		if songHasClassicalChinese(vocalTexts) {
			return validateSongLangWithTexts("lzh", vocalTexts)
		}
		return validateSongLangWithTexts("zh-cn", vocalTexts)
	case "ja", "ko", "en":
		return validateSongLangWithTexts(rec.Lang, vocalTexts)
	default:
		return ""
	}
}

func (s *MusicService) prepareTranslationAccess(ctx context.Context, id int64, source, lang string) (string, *dto.MusicTrackDto, *errs.ServiceError) {
	targetLang := normalizeLyricLangTag(lang)
	if id <= 0 || lyricTranslateLanguages[targetLang] == "" || (source != "" && !lyricSettingSources[source]) {
		return "", nil, errs.NewBadRequest("invalid_request_parameters")
	}
	track := s.annotatableTrack(ctx, id)
	if track == nil && ctxutils.IsAdmin(ctx) {
		if song, svcerr := s.GetSong(ctx, id); svcerr == nil {
			track = &dto.MusicTrackDto{
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
	if track == nil {
		return "", nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	return targetLang, track, nil
}

func (a *lyricTranslationService) hub() *lyricStreamHub[dto.MusicLyricTranslationLine, musicLyricTranslationStreamDone] {
	a.hubOnce.Do(func() {
		a.hubVal = newLyricStreamHub[dto.MusicLyricTranslationLine, musicLyricTranslationStreamDone](a.prefix())
	})
	return a.hubVal
}

func (a *lyricTranslationService) hasOverrideOrRunning(input *lyricTranslationInput) bool {
	if input == nil {
		return false
	}
	if running, _ := a.jobState(translationStateKey(input)); running {
		return true
	}
	var record model.LyricTranslation
	err := repo.GetDB().Where(
		"song_id = ? AND source = ? AND lyric_hash = ? AND target_lang = ?",
		input.Track.ID, input.Source, input.LyricHash, input.TargetLang,
	).First(&record).Error
	return err == nil && len(parseLyricTranslationData(record.Data).Lines) > 0
}

func (a *lyricTranslationService) ensureProducer(key string, input *lyricTranslationInput) (
	replay []dto.MusicLyricTranslationLine,
	doneMeta *musicLyricTranslationStreamDone,
	alreadyDone bool,
	svcerr *errs.ServiceError,
) {
	a.mu.Lock()
	defer a.mu.Unlock()

	running, coolingDown := a.jobState(key)
	var record model.LyricTranslation
	err := repo.GetDB().Where(
		"song_id = ? AND source = ? AND lyric_hash = ? AND target_lang = ?",
		input.Track.ID, input.Source, input.LyricHash, input.TargetLang,
	).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, false, errs.Internal("failed_to_get_target", err)
	}
	if err == nil && !running {
		data := parseLyricTranslationData(record.Data)
		lines := data.Lines
		if lines == nil {
			lines = []dto.MusicLyricTranslationLine{}
		}
		meta := &musicLyricTranslationStreamDone{
			Status:       lyricTranslationStatusReady,
			Source:       input.Source,
			TargetLang:   input.TargetLang,
			SameLanguage: len(lines) == 0,
		}
		return lines, meta, true, nil
	}

	if running {
		return nil, nil, false, nil
	}
	if coolingDown {
		return nil, nil, false, errs.NewNotFound("lyric_translations_failed")
	}
	// 内置已有目标语言译文且当前既无 DB AI 覆盖也没有后台任务在跑时，绝不通过 SSE 自动启动 AI 生成
	if input.NativeTarget {
		meta := &musicLyricTranslationStreamDone{
			Status:     lyricTranslationStatusReady,
			Source:     input.Source,
			TargetLang: input.TargetLang,
			Native:     true,
		}
		return nil, meta, true, nil
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, nil, false, errs.NewNotFound("lyric_translations_unavailable")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, nil, false, svcerr
	}
	a.startLocked(key, input, cfg, false)
	return nil, nil, false, nil
}

func (a *lyricTranslationService) streamWithReplay(
	ctx context.Context,
	input *lyricTranslationInput,
	onReady func(),
	send func(event string, data any) error,
) *errs.ServiceError {
	key := translationStateKey(input)
	hub := a.hub()
	// 必须在启动/检查生产者前先挂载订阅，避免回放快照与实时广播衔接窗口丢失增量行
	sub := hub.subscribe(key)
	defer sub.Close()

	replay, doneMeta, alreadyDone, svcerr := a.ensureProducer(key, input)
	if svcerr != nil {
		return svcerr
	}
	onReady()
	if alreadyDone {
		if len(replay) > 0 {
			if err := send("replay", replay); err != nil {
				return nil
			}
		}
		if doneMeta != nil {
			_ = send("done", *doneMeta)
		}
		return nil
	}

	consumeLyricStream(ctx, hub, key, sub, send, func() ([]dto.MusicLyricTranslationLine, *musicLyricTranslationStreamDone, bool, string) {
		running, coolingDown := a.jobState(key)
		var record model.LyricTranslation
		err := repo.GetDB().Where(
			"song_id = ? AND source = ? AND lyric_hash = ? AND target_lang = ?",
			input.Track.ID, input.Source, input.LyricHash, input.TargetLang,
		).First(&record).Error
		if err == nil && !running {
			data := parseLyricTranslationData(record.Data)
			return data.Lines, &musicLyricTranslationStreamDone{
				Status:       lyricTranslationStatusReady,
				Source:       input.Source,
				TargetLang:   input.TargetLang,
				SameLanguage: len(data.Lines) == 0,
			}, true, ""
		}
		if coolingDown && !running {
			return nil, nil, false, "lyric_translations_failed"
		}
		if !running {
			return nil, nil, false, "lyric_translations_aborted"
		}
		return nil, nil, false, ""
	})
	return nil
}

func (a *lyricTranslationService) getOrStart(input *lyricTranslationInput) (*dto.MusicLyricTranslationsDto, *errs.ServiceError) {
	key := translationStateKey(input)
	a.mu.Lock()
	defer a.mu.Unlock()

	running, coolingDown := a.jobState(key)
	var record model.LyricTranslation
	err := repo.GetDB().Where(
		"song_id = ? AND source = ? AND lyric_hash = ? AND target_lang = ?",
		input.Track.ID, input.Source, input.LyricHash, input.TargetLang,
	).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if err == nil {
		data := parseLyricTranslationData(record.Data)
		lines := data.Lines
		if lines == nil {
			lines = []dto.MusicLyricTranslationLine{}
		}
		return &dto.MusicLyricTranslationsDto{
			Status:       lyricTranslationStatusReady,
			Stale:        running,
			Source:       input.Source,
			TargetLang:   input.TargetLang,
			SameLanguage: len(lines) == 0,
			Lines:        lines,
		}, nil
	}

	if running {
		var lines []dto.MusicLyricTranslationLine
		if snap := a.hub().loadSnapshot(key); snap != nil {
			lines = snap.Lines
		}
		if lines == nil {
			lines = []dto.MusicLyricTranslationLine{}
		}
		return &dto.MusicLyricTranslationsDto{
			Status:     lyricTranslationStatusPending,
			Source:     input.Source,
			TargetLang: input.TargetLang,
			Lines:      lines,
		}, nil
	}
	if coolingDown {
		return nil, errs.NewNotFound("lyric_translations_failed")
	}
	// 并发竞态兜底：已有内置目标语言译文时，非管理员 refresh 路径不主动启动 AI 生成
	if input.NativeTarget {
		return &dto.MusicLyricTranslationsDto{
			Status:     lyricTranslationStatusReady,
			Source:     input.Source,
			TargetLang: input.TargetLang,
			Native:     true,
			Lines:      []dto.MusicLyricTranslationLine{},
		}, nil
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	a.startLocked(key, input, cfg, false)
	return &dto.MusicLyricTranslationsDto{
		Status:     lyricTranslationStatusPending,
		Source:     input.Source,
		TargetLang: input.TargetLang,
		Lines:      []dto.MusicLyricTranslationLine{},
	}, nil
}

func (a *lyricTranslationService) refresh(input *lyricTranslationInput, cfg tools.AIConfig) *dto.MusicLyricTranslationsDto {
	key := translationStateKey(input)
	a.mu.Lock()
	defer a.mu.Unlock()
	if running, _ := a.jobState(key); !running {
		a.startLocked(key, input, cfg, true)
	}
	var record model.LyricTranslation
	if err := repo.GetDB().Where(
		"song_id = ? AND source = ? AND lyric_hash = ? AND target_lang = ?",
		input.Track.ID, input.Source, input.LyricHash, input.TargetLang,
	).First(&record).Error; err == nil {
		data := parseLyricTranslationData(record.Data)
		lines := data.Lines
		if lines == nil {
			lines = []dto.MusicLyricTranslationLine{}
		}
		return &dto.MusicLyricTranslationsDto{
			Status:       lyricTranslationStatusReady,
			Stale:        true,
			Source:       input.Source,
			TargetLang:   input.TargetLang,
			SameLanguage: len(lines) == 0,
			Lines:        lines,
		}
	}
	return &dto.MusicLyricTranslationsDto{
		Status:     lyricTranslationStatusPending,
		Source:     input.Source,
		TargetLang: input.TargetLang,
		Lines:      []dto.MusicLyricTranslationLine{},
	}
}

func translationStateKey(input *lyricTranslationInput) string {
	return strconv.FormatInt(input.Track.ID, 10) + ":" + input.Source + ":" + input.LyricHash + ":" + input.TargetLang
}

func (a *lyricTranslationService) prefix() string {
	a.initOnce.Do(func() {
		if a.name == "" {
			a.name = "lyric_translation_" + utils.Strings.GenerateRandomString(8)
		}
	})
	return a.name
}

func (a *lyricTranslationService) stateKeys(key string) (job, failed string) {
	return a.prefix() + ":job:" + key, a.prefix() + ":failed:" + key
}

func (a *lyricTranslationService) jobState(key string) (running, coolingDown bool) {
	jobKey, failedKey := a.stateKeys(key)
	values, err := sharedstate.Current().GetMany(jobKey, failedKey)
	if err != nil {
		logrus.Warnf("read lyric translation state %s: %v", key, err)
		return false, false
	}
	_, running = values[jobKey]
	_, coolingDown = values[failedKey]
	return running, coolingDown
}

func (a *lyricTranslationService) startLocked(key string, input *lyricTranslationInput, cfg tools.AIConfig, forceRefresh bool) {
	jobKey, failedKey := a.stateKeys(key)
	lease, err := sharedstate.AcquireLease(jobKey, lyricTranslationJobTTL)
	if err != nil || lease == nil {
		if err != nil {
			logrus.Warnf("start lyric translation %s: %v", key, err)
		}
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	writer := a.hub().initSnapshot(key, nil, lyricTranslationTimeout+2*time.Minute)
	go a.run(lease, key, writer, input, cfg, forceRefresh)
}

func (a *lyricTranslationService) run(
	lease *sharedstate.Lease,
	key string,
	writer *lyricStreamWriter[dto.MusicLyricTranslationLine, musicLyricTranslationStreamDone],
	input *lyricTranslationInput,
	cfg tools.AIConfig,
	forceRefresh bool,
) {
	_ = a.execute(lease, key, writer, input, cfg, forceRefresh)
}

func (a *lyricTranslationService) execute(
	lease *sharedstate.Lease,
	key string,
	writer *lyricStreamWriter[dto.MusicLyricTranslationLine, musicLyricTranslationStreamDone],
	input *lyricTranslationInput,
	cfg tools.AIConfig,
	forceRefresh bool,
) (err error) {
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("lyric translation panic for song %d (%s/%s): %v", input.Track.ID, input.Source, input.TargetLang, r)
			err = fmt.Errorf("panic: %v", r)
		}
		if err != nil {
			_, failedKey := a.stateKeys(key)
			if setErr := sharedstate.Current().Set(failedKey, "1", lyricTranslationRetryAfter); setErr != nil {
				logrus.Warnf("save lyric translation failure %s: %v", key, setErr)
			}
			if writer != nil {
				writer.Fail(err.Error())
			}
		}
		lease.Release()
		if a.done != nil {
			a.done()
		}
	}()

	lines, genErr := a.generateStream(cfg, input, writer, forceRefresh)
	if genErr != nil {
		logrus.Warnf("lyric translation failed for song %d (%s/%s): %v", input.Track.ID, input.Source, input.TargetLang, genErr)
		err = genErr
		return err
	}

	rawData, _ := json.Marshal(lyricTranslationData{Lines: lines})
	record := &model.LyricTranslation{
		SongID:     input.Track.ID,
		Source:     input.Source,
		LyricHash:  input.LyricHash,
		TargetLang: input.TargetLang,
		Data:       string(rawData),
		Model:      cfg.Model,
		CreatedAt:  time.Now(),
	}
	upsert := clause.OnConflict{
		Columns: []clause.Column{
			{Name: "song_id"},
			{Name: "source"},
			{Name: "lyric_hash"},
			{Name: "target_lang"},
		},
		DoUpdates: clause.AssignmentColumns([]string{"data", "model", "created_at"}),
	}
	if dbErr := repo.GetDB().Clauses(upsert).Create(record).Error; dbErr != nil {
		logrus.Errorf("save lyric translation for song %d (%s/%s) failed: %v", input.Track.ID, input.Source, input.TargetLang, dbErr)
		err = dbErr
		return err
	}
	if writer != nil {
		writer.Finish(musicLyricTranslationStreamDone{
			Status:       lyricTranslationStatusReady,
			Source:       input.Source,
			TargetLang:   input.TargetLang,
			SameLanguage: len(lines) == 0,
		})
	}
	return nil
}

func parseLyricTranslationData(raw string) lyricTranslationData {
	var data lyricTranslationData
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &data)
	}
	return data
}

func (a *lyricTranslationService) callStream(
	ctx context.Context,
	cfg tools.AIConfig,
	system, user string,
	onChunk func(content string) error,
) error {
	_ = a.limiter.AcquireTier(ctx, a.concurrency, llmclient.TierFirstScreen, nil)
	defer a.limiter.Release()
	callCtx, cancel := context.WithTimeout(withLLMPurpose(ctx, constant.LLMPurposeTranslation, 0), lyricTranslationTimeout)
	defer cancel()
	if a.stream != nil {
		return a.stream(callCtx, cfg, system, user, onChunk)
	}
	if a.complete != nil {
		raw, err := a.complete(callCtx, cfg, system, user)
		if err != nil {
			return err
		}
		return onChunk(raw)
	}
	return errors.New("lyric translation provider not configured")
}

type lyricTranslationNDJSONLine struct {
	I           int    `json:"i"`
	T           string `json:"t"`
	Translation string `json:"translation"`
	Lines       []struct {
		I           int    `json:"i"`
		T           string `json:"t"`
		Translation string `json:"translation"`
	} `json:"lines"`
}

func buildTranslatedLinesResult(tasks []lyricTranslationLineTask, translated []string) []dto.MusicLyricTranslationLine {
	result := make([]dto.MusicLyricTranslationLine, 0, len(tasks))
	for i, task := range tasks {
		if i >= len(translated) || translated[i] == "" {
			continue
		}
		result = append(result, dto.MusicLyricTranslationLine{
			Text:        task.OrigText,
			Occurrence:  task.Occurrence,
			Bg:          task.Bg,
			Translation: translated[i],
		})
	}
	return result
}

func (a *lyricTranslationService) generate(cfg tools.AIConfig, input *lyricTranslationInput) ([]dto.MusicLyricTranslationLine, error) {
	return a.generateStream(cfg, input, nil, false)
}

// generateStream 双阶段协同+整篇单流翻译整首歌：若配置了 Stage 1 Director，先完成/复用全曲曲风与借代锦囊，
// 再将整首歌文本一次性送往大模型流式输出 NDJSON（每译完一行立即校验并经 writer 广播给所有订阅客户端）。
func (a *lyricTranslationService) generateStream(
	cfg tools.AIConfig,
	input *lyricTranslationInput,
	writer *lyricStreamWriter[dto.MusicLyricTranslationLine, musicLyricTranslationStreamDone],
	forceRefresh bool,
) ([]dto.MusicLyricTranslationLine, error) {
	if len(input.Tasks) == 0 {
		return []dto.MusicLyricTranslationLine{}, nil
	}
	var blueprint *lyricDirectorAnalysis
	if a.director != nil {
		vocalLines := make([]string, 0, len(input.Tasks))
		for _, task := range input.Tasks {
			if !task.Hint && task.VocalText != "" {
				vocalLines = append(vocalLines, task.VocalText)
			}
		}
		var dirErr error
		blueprint, dirErr = a.director.getOrAnalyze(cfg, input.Track, vocalLines, forceRefresh)
		if dirErr != nil {
			return nil, dirErr
		}
	}

	keepTargetRef := blueprint != nil && blueprint.NeedsReferenceTranslation
	classicalChinese := input.ClassicalChinese || (blueprint != nil && blueprint.SongLang == "lzh")
	system := buildLyricTranslationSystemPromptFull(input.TargetLang, input.ClassicalMode, classicalChinese, blueprint)
	baseUser := buildLyricTranslationUserPromptWithOptions(input, input.Tasks, keepTargetRef)
	posByIndex := make(map[int]int, len(input.Tasks))
	for pos, task := range input.Tasks {
		posByIndex[task.Index] = pos
	}

	translated := make([]string, len(input.Tasks))
	decidedPos := make([]bool, len(input.Tasks))
	skippedEmptyPos := make([]bool, len(input.Tasks))
	emittedTotal := 0

	var lastErr error
	user := baseUser
	for attempt := 0; attempt <= lyricTranslationMaxRetries; attempt++ {
		if attempt > 0 && lyricTranslationRetryDelay > 0 {
			time.Sleep(lyricTranslationRetryDelay)
		}

		parsedCount := 0
		emittedAttempt := 0
		rejectedAttempt := 0
		var scanner ndjsonLineScanner

		handleItem := func(idx int, rawText string) {
			pos, ok := posByIndex[idx]
			if !ok {
				return
			}
			parsedCount++
			task := input.Tasks[pos]
			cleaned := collapseLyricSpace(rawText)
			if cleaned == "" {
				if !decidedPos[pos] {
					skippedEmptyPos[pos] = true
				}
				return
			}
			if !task.Hint {
				cleaned = collapseLyricSpace(stripLeakedCuePrefix(task.OrigText, task.VocalText, cleaned))
			}
			if cleaned == "" {
				if !decidedPos[pos] {
					skippedEmptyPos[pos] = true
				}
				return
			}
			if !isValidTargetScriptTranslation(task.VocalText, cleaned, input.TargetLang) {
				rejectedAttempt++
				return
			}
			if normTr := lyricLineMatchKey(cleaned); normTr != "" && normTr == lyricLineMatchKey(task.VocalText) {
				if !decidedPos[pos] {
					skippedEmptyPos[pos] = true
				}
				return
			}
			if !decidedPos[pos] {
				decidedPos[pos] = true
				translated[pos] = cleaned
				emittedTotal++
				emittedAttempt++
				if writer != nil {
					writer.EmitLine(dto.MusicLyricTranslationLine{
						Text:        task.OrigText,
						Occurrence:  task.Occurrence,
						Bg:          task.Bg,
						Translation: cleaned,
					})
				}
			}
		}

		handleObj := func(objJSON string) {
			var parsed lyricTranslationNDJSONLine
			if err := json.Unmarshal([]byte(objJSON), &parsed); err != nil {
				return
			}
			if len(parsed.Lines) > 0 {
				for _, line := range parsed.Lines {
					text := line.T
					if text == "" {
						text = line.Translation
					}
					handleItem(line.I, text)
				}
				return
			}
			if parsed.I > 0 {
				text := parsed.T
				if text == "" {
					text = parsed.Translation
				}
				handleItem(parsed.I, text)
			}
		}

		callErr := a.callStream(context.Background(), cfg, system, user, func(content string) error {
			scanner.Feed(content, handleObj)
			return nil
		})
		if callErr != nil {
			lastErr = callErr
			continue
		}
		if parsedCount == 0 {
			lastErr = errors.New("lyric translation returned no matching indices")
			continue
		}

		nonEmptyAttempt := emittedAttempt + rejectedAttempt
		needsScriptRetry := (rejectedAttempt >= 2 && rejectedAttempt*100 >= max(nonEmptyAttempt, 1)*40) ||
			(emittedTotal == 0 && rejectedAttempt > 0)
		if attempt < lyricTranslationMaxRetries && needsScriptRetry {
			var pendingIndices []int
			for pos, task := range input.Tasks {
				if !decidedPos[pos] && !skippedEmptyPos[pos] {
					pendingIndices = append(pendingIndices, task.Index)
				}
			}
			notice := fmt.Sprintf("\nCRITICAL RETRY NOTICE: Your previous output used the wrong language/script (e.g. copying Chinese characters instead of translating). You MUST translate every non-target lyric into %s (%s).", input.TargetLang, lyricTranslateLanguages[input.TargetLang])
			if emittedTotal > 0 && len(pendingIndices) > 0 && len(pendingIndices) < len(input.Tasks) {
				pendingJSON, _ := json.Marshal(pendingIndices)
				notice += fmt.Sprintf(" Emit NDJSON lines ONLY for remaining indices %s.", string(pendingJSON))
			}
			user = baseUser + notice
			lastErr = errors.New("lyric translation returned wrong target script")
			continue
		}
		lastErr = nil
		break
	}

	if lastErr != nil && emittedTotal == 0 {
		// 若已有部分合法结构只是错语种行被全部过滤且重试已耗尽，容错保存为空而非挂起错误
		if lastErr.Error() != "lyric translation returned wrong target script" {
			return nil, lastErr
		}
	}
	return buildTranslatedLinesResult(input.Tasks, translated), nil
}

func finalizeSingleLineTranslation(task lyricTranslationLineTask, raw, targetLang string) string {
	cleaned := collapseLyricSpace(raw)
	if cleaned == "" {
		return ""
	}
	if !task.Hint {
		cleaned = stripLeakedCuePrefix(task.OrigText, task.VocalText, cleaned)
		cleaned = collapseLyricSpace(cleaned)
		if cleaned == "" {
			return ""
		}
	}
	// 模型把原文原样抄回时（如未翻译的英文短句或拟声词）视为无需译文，避免在歌词下方重复显示同一行文字
	if normTr := normalizeLyricMatch(cleaned); normTr != "" && normTr == normalizeLyricMatch(task.VocalText) {
		return ""
	}
	if !isValidTargetScriptTranslation(task.VocalText, cleaned, targetLang) {
		return ""
	}
	return cleaned
}

func buildLyricTranslationSystemPrompt(targetLang string, classicalMode bool) string {
	return buildLyricTranslationSystemPromptFull(targetLang, classicalMode, classicalMode, nil)
}

func buildLyricTranslationSystemPromptWithBlueprint(targetLang string, classicalMode bool, blueprint *lyricDirectorAnalysis) string {
	return buildLyricTranslationSystemPromptFull(targetLang, classicalMode, classicalMode || (blueprint != nil && blueprint.SongLang == "lzh"), blueprint)
}

func buildLyricTranslationSystemPromptFull(targetLang string, classicalMode, classicalChinese bool, blueprint *lyricDirectorAnalysis) string {
	targetDesc := lyricTranslateLanguages[targetLang]
	var b strings.Builder
	b.WriteString("You are an accomplished literary music lyric translator.\n")
	b.WriteString(fmt.Sprintf("Translate the provided full-song lyrics STRICTLY into %s (Language Code: %s), keeping pronouns (e.g. 你/您/我/吾), voice, rhyme, and refrain wording 100%% consistent from start to finish.\n\n", targetDesc, targetLang))
	if blueprint != nil && !blueprint.isEmpty() {
		b.WriteString("=== SONG DIRECTOR BLUEPRINT (from Stage 1) ===\n")
		if blueprint.Genre != "" {
			b.WriteString("Genre: " + blueprint.Genre + "\n")
		}
		if blueprint.Mood != "" {
			b.WriteString("Dominant Mood: " + blueprint.Mood + "\n")
		}
		if blueprint.TranslationDirective != "" {
			b.WriteString("Overall Directive: " + blueprint.TranslationDirective + "\n")
		}
		if blueprint.NeedsReferenceTranslation {
			b.WriteString("Reference Policy: Abstract/constructed/encoded lyrics detected — consult \"ref\" (when provided) as primary semantic ground truth while rendering natural, poetic phrasing in targetLang.\n")
		}
		b.WriteString("Identified Cultural Metonyms & Hidden Meanings:\n")
		b.WriteString(blueprint.formatCulturalNotes() + "\n")
		b.WriteString("Director's Custom Craft Skills for This Song:\n")
		b.WriteString(blueprint.formatCustomSkills() + "\n\n")
	}
	b.WriteString("=== CORE FOUNDATION RULES ===\n")
	b.WriteString("1. Pursue \"信、达、雅\" (faithfulness, fluency, and poetic elegance) infused with the song's emotion, persona, and expressive tone.\n")
	b.WriteString("2. Metonymy Preservation & Audience-Aware Allusion Glossing:\n")
	b.WriteString("   - Pure lexical idioms where literal word-by-word translation produces absurd objects (e.g. 青丝 -> \"jet-black hair\", NEVER \"green silk thread\"; 阿姨 in Tang music-quarters context -> \"foster madam\", NEVER \"aunt\") MUST be translated by their true contextual meaning, following the director's cultural notes.\n")
	switch targetLang {
	case "en":
		b.WriteString("   - Historical/classical allusions, metonymic place names, official titles, and symbolic cultural terms (e.g., allusions in Classical Chinese poems like 琵琶行: 五陵, 虾蟆陵, 教坊, 善才, 秋娘, 缠头, 司马, 青衫): You MAY preserve the literal poetic image or romanized proper name to retain authentic classical flavor, PROVIDED you pair its FIRST occurrence with a concise 2–5 word parenthetical gloss. Because native English listeners lack Classical Chinese context, bare literal calques like \"the Five Tombs\" or \"the Five Mausoleums\" for 五陵 sound like literal graves, and bare \"blue robe\" for 青衫 misses official demotion — you MUST gloss them on first occurrence (e.g., \"the Five Tombs (Chang'an's wealthy quarter)\" or \"Wuling (wealthy capital district)\", \"blue robe (humble official's attire)\", \"Sima (exiled sub-prefect)\").\n")
	case "ja":
		b.WriteString("   - Historical/classical allusions & cultural references (e.g., Classical Chinese poems like 琵琶行): Where shared Sino-Japanese Kanji compounds already convey the meaning naturally (e.g., \"五陵の貴公子\"), keep phrasing concise without redundant glosses; add a brief 2–5 word parenthetical gloss ONLY on the first occurrence of genuinely obscure archaic institutions or customs (e.g., \"纏頭（芸妓への贈り物）\", \"青衫（下級官吏の衣）\").\n")
	case "ko":
		b.WriteString("   - Historical/classical allusions & cultural references (e.g., Classical Chinese poems like 琵琶行): Because Hangul hides underlying Hanja characters, when preserving a classical allusion or proper name whose meaning is opaque in Hangul, add a concise 2–4 word parenthetical gloss ONLY on its first occurrence.\n")
	default:
		b.WriteString("   - Selective difficult-term notes: For deep local cultural allusions, historical titles, classical references, or obscure concepts hard to grasp directly, you may add a concise parenthetical gloss (within 2–5 words) ONLY on the first occurrence of genuinely difficult terms.\n")
	}
	b.WriteString("   - Expressive cultural flavor (apply by analogy): When an iconic emotional or subcultural keyword would lose its charm if flattened (e.g., Japanese \"かわい\" / \"かわいい\" in a cute character song translated into English as \"kawaii (cute)\"), you may keep the standout original/romanized keyword paired with a tiny 1–3 word parenthetical gloss in targetLang. Skip common words and NEVER write lengthy footnotes.\n")
	switch targetLang {
	case "zh-tw":
		b.WriteString("3. Genre Adaptation & CRITICAL zh-tw Fidelity: Honor both the baseline genre norms and any director custom craft skills above, while writing authentic, idiomatic Taiwanese Traditional Chinese (台灣繁體中文與台灣地道書面用語，如台灣習慣詞彙與語氣). Do NOT perform mechanical Simplified-to-Traditional character substitution, and avoid Mainland or Hong Kong Cantonese-specific phrasing.\n")
	case "zh-hk":
		b.WriteString("3. Genre Adaptation & CRITICAL zh-hk Fidelity: Honor both the baseline genre norms and any director custom craft skills above, while writing authentic, idiomatic Hong Kong / Macau Traditional Chinese (香港澳門繁體書面語與地道港澳用語). Unless the source lyrics are explicitly colloquial Cantonese, prefer polished written Hong Kong / Macau Chinese; do NOT perform mechanical Simplified-to-Traditional character substitution, and avoid stiff Taiwanese or Mainland-specific phrasing.\n")
	default:
		b.WriteString("3. Genre Adaptation: Honor both the baseline genre norms and any director custom craft skills above. If the song is playful/ACG, keep it vibrant; if it is classical/folk, preserve the literary depth and cadence; if it is rap/spoken, maintain attitude and rhythm.\n")
	}
	b.WriteString("4. Stripping Speaker Cues (CRITICAL for non-hint lines): Platform lyrics often prepend a singer name, surname abbreviation, group/duet tag, or character cue before a colon or in brackets — e.g. \"汪：我是米开朗基罗\", \"BY2：爱要精心来雕刻\", \"合：眼神坚定着我们的选择\", \"男：...\", \"女：...\", \"李荣浩：...\", \"A: ...\", \"[可莉] ...\".\n")
	b.WriteString("   - Recognize any leading speaker/part cue (using `artists`, `title`, `aliases`, and surrounding lines) and STRIP both the speaker label AND its colon completely from your translation! Translate ONLY the sung lyric after the colon (for example: \"汪：我是米开朗基罗\" -> \"I am Michelangelo\", NEVER \"Wang: I am Michelangelo\"; \"合：眼神坚定\" -> \"Our eyes firm\", NEVER \"Chorus: Our eyes firm\").\n")
	b.WriteString("   - If \"ref\" contains a leaked speaker prefix before a colon, strip it as well.\n")
	b.WriteString("   - By contrast, when a colon is genuine narrative speech/punctuation inside the sung lyric itself (e.g. \"她问我：你明天还会回来吗\"), keep the clause and punctuation normally.\n")
	b.WriteString("   - NEVER translate a pure structural section tag (such as \"Verse\", \"Chorus\", \"主歌\", \"副歌\"); return \"\" if a line is purely non-sung structural metadata.\n")
	b.WriteString("5. Cross-line Clause Linking (串句合译与自然断句): Lyrics often split one connected sentence across adjacent lines (e.g., \"春风吹不倒\" + \"我的杨柳腰\" forms \"春风吹不倒我的杨柳腰\"). Because you see all lines of the entire song together, when consecutive lines (including background vocals and neighboring verses) form one connected clause or modifier phrase, translate the combined thought naturally in targetLang grammar first, then split it cleanly across the exact item indices i at natural phrasing pauses so adjacent lines flow smoothly together. Do NOT cram two lines into one index while leaving the companion line \"\".\n")
	b.WriteString("6. Reference Translations (\"ref\"), Constructed/Encoded Languages & Target-Script Integrity:\n")
	b.WriteString("   - You may receive both \"orig\" (original lyrics) and \"ref\" (an upstream/sibling reference translation, e.g. Simplified Chinese, English, or multi-language \"[lang] ...\"). Use BOTH together to grasp idioms, wordplay, implied subjects, and emotion accurately.\n")
	b.WriteString("   - OVERRIDING AN UPSTREAM TARGET-LANGUAGE TRANSLATION: When \"orig\" is written in a foreign/abstract language while \"ref\" is ALREADY in targetLang (for example, overriding a platform translation or decoding constructed/cipher lyrics with an official targetLang guide), use \"ref\" as auxiliary semantic ground truth rather than copying literal flaws verbatim. NEVER output \"\" merely because \"ref\" is already in targetLang (return \"\" ONLY when \"orig\" itself is already sung in targetLang).\n")
	b.WriteString("   - CONSTRUCTED / ENCODED / ABSTRACT LYRICS (Conlangs, Morse Code, Ciphers): When \"orig\" is a constructed/invented language (e.g., *LaVI-Bavellabion*, Hymmnos), Morse code (e.g. \"... --- ...\"), cipher, or obscure non-standard sequence AND a meaningful \"ref\" is provided, you MUST decode/translate it into natural, poetic targetLang text using \"ref\" and surrounding context as the primary semantic basis. NEVER echo raw dots/dashes/ciphers back verbatim and NEVER mistake these lines for empty scat!\n")
	if targetLang == "ja" || targetLang == "ko" || targetLang == "en" {
		b.WriteString(fmt.Sprintf("   - CRITICAL TARGET-LANGUAGE RULE: When target_lang is %s (%s), NEVER copy or echo Chinese sentences from \"ref\" or Chinese \"orig\" into your output! You MUST translate Chinese/foreign lines naturally into %s using authentic target-language script and grammar", targetLang, targetDesc, targetDesc))
		if targetLang == "ja" {
			b.WriteString(" (for Japanese, write natural Japanese phrases with Hiragana/Katakana okurigana and particles — NEVER output pure Chinese Kanji sentences)")
		} else if targetLang == "ko" {
			b.WriteString(" (for Korean, write natural Hangul sentences — NEVER output raw Chinese/Hanja sentences)")
		}
		b.WriteString(".\n")
	}
	b.WriteString("7. Mixed-language & scat/onomatopoeia handling: Evaluate each line individually:\n")
	b.WriteString("   - Pure target-language lines (already written naturally in targetLang) or pure non-lexical scat/onomatopoeia lines WITHOUT meaningful \"ref\" semantics (e.g. \"Ooh\", \"La la la\", \"Pico bala-ba-ba-ba\", \"Nino na-ra-na-na-na\") -> return empty string \"\".\n")
	switch targetLang {
	case "zh":
		b.WriteString("   - Lines mixing a foreign semantic phrase WITH inline scat/onomatopoeia vocables (e.g. \"人は猫dala-da-da-da\" or \"絶対にそう ny-ny-nya-nya-nya\") -> translate ONLY the semantic part into Simplified Chinese and preserve the inline scat/onomatopoeia intact in place (e.g. \"人是猫 dala-da-da-da\", \"绝对如此 ny-ny-nya-nya-nya\"). Lines already in Chinese (e.g. \"叮咚 叮叮咚咚\", \"收到总部命令\") -> return \"\".\n")
	case "zh-tw", "zh-hk":
		b.WriteString("   - Lines mixing a foreign semantic phrase WITH inline scat/onomatopoeia vocables (e.g. \"人は猫dala-da-da-da\" or \"絶対にそう ny-ny-nya-nya-nya\") -> translate ONLY the semantic part into idiomatic Traditional Chinese and preserve the inline scat/onomatopoeia intact in place (e.g. \"人是貓 dala-da-da-da\", \"絕對如此 ny-ny-nya-nya-nya\"). Lines already in idiomatic target-region modern Chinese -> return \"\".\n")
	case "ja":
		b.WriteString("   - Lines mixing a foreign semantic phrase WITH inline scat/onomatopoeia vocables (e.g. \"Hello baby dala-da-da-da\" or \"收到总部命令 beep-beep\") -> translate ONLY the semantic part into natural Japanese and preserve the inline scat/onomatopoeia intact in place (e.g. \"ハロー・ベイビー dala-da-da-da\", \"本部からの指令を受信 beep-beep\"). Lines already in Japanese -> return \"\".\n")
	case "ko":
		b.WriteString("   - Lines mixing a foreign semantic phrase WITH inline scat/onomatopoeia vocables (e.g. \"人は猫dala-da-da-da\" or \"收到总部命令 beep-beep\") -> translate ONLY the semantic part into natural Korean Hangul and preserve the inline scat/onomatopoeia intact in place (e.g. \"사람은 고양이 dala-da-da-da\", \"본부 명령 수신 beep-beep\"). Lines already in Korean -> return \"\".\n")
	case "en":
		b.WriteString("   - Lines mixing a foreign semantic phrase WITH inline scat/onomatopoeia vocables (e.g. \"人は猫dala-da-da-da\" or \"收到总部命令 beep-beep\") -> translate ONLY the semantic part into natural English and preserve the inline scat/onomatopoeia intact in place (e.g. \"People are cats dala-da-da-da\", \"Orders received from HQ beep-beep\"). Lines already in English -> return \"\".\n")
	}
	b.WriteString("   - Other bilingual hooks/phrases -> translate where it aids understanding; return \"\" only if keeping the original phrase unchanged clearly reads better.\n")
	b.WriteString("8. Proper nouns: Real or fictional place names, games/anime/media (e.g. 《原神》 -> \"Genshin Impact\"), famous historical or modern figures, books, and song titles MUST use standard recognized official translations in targetLang (respecting regional and script conventions of targetLang); fall back to semantic translation or phonetic transliteration only when no official/recognized name exists. However, when a historical place name or title functions as a Classical Chinese cultural allusion/metonym whose literal English name is opaque or misleading (such as 五陵 -> \"the Five Tombs\"), ALWAYS pair its first occurrence with a concise parenthetical gloss per Rule 2 rather than leaving a bare misleading literal noun.\n")
	step := 9
	if classicalMode {
		b.WriteString(fmt.Sprintf("%d. CLASSICAL CHINESE -> MODERN VERNACULAR MODE (古文转白话): This song contains Classical Chinese (文言文 / 古诗词 / 古风文言句). For every line written in Classical Chinese or archaic poetic diction, translate it into concise, graceful, poetic modern Chinese vernacular (%s) suited for lyric subtitles. Do NOT leave Classical Chinese lines untranslated; however, return \"\" for lines that are already plain modern Chinese, and return \"\" for immediate short echo fragments that merely repeat a few trailing syllables of the preceding classical line without adding new meaning.\n", step, targetDesc))
		step++
	} else if classicalChinese && targetLang != "zh" && targetLang != "zh-tw" && targetLang != "zh-hk" {
		b.WriteString(fmt.Sprintf("%d. CLASSICAL CHINESE FOREIGN TRANSLATION & GLOSSING MODE (古诗文外译与括号释义): This song contains Classical Chinese (文言文 / 古诗词 / 古风文言句). Consult both the Stage 1 cultural notes and any modern Chinese vernacular \"ref\" (when provided) to grasp the exact real-world meaning of every classical allusion before translating into %s. Preserve poetic cadence and classical imagery (literal poetic translation or romanization is welcome),", step, targetDesc))
		if targetLang == "en" {
			b.WriteString(" and because native English speakers do not know Classical Chinese historical metonyms, you MUST include a concise 2–5 word parenthetical explanation on the FIRST occurrence of every opaque or misleading literal allusion (e.g. \"Five Tombs (Chang'an's wealthy quarter)\" or \"Wuling (wealthy capital district)\" for 五陵, \"blue robe (humble official's attire)\" for 青衫, \"silk gifts\" or \"head-silks (gifts for performers)\" for 缠头) — NEVER leave bare \"Five Tombs\" / \"Five Mausoleums\" unexplained.\n")
		} else {
			b.WriteString(" adding brief first-occurrence parenthetical explanations only for archaic institutions or allusions that native readers of targetLang cannot infer directly from standard vocabulary.\n")
		}
		step++
	}
	b.WriteString(fmt.Sprintf("%d. Hint/credit lines (items with \"hint\": true, such as \"词作者：XXX\", \"曲作者：XXX\", \"作词：XXX\") -> translate the role label and artist/creator name concisely into targetLang ONLY when an established/confident localized form exists (for creator names, use only publicly recognized names or keep the original name; NEVER invent translations). Return \"\" if uncertain or already in targetLang.\n", step))
	step++
	b.WriteString(fmt.Sprintf("%d. Repeated lines should keep consistent wording for recurring refrains, except first-occurrence parenthetical notes need not repeat and phrasing may adapt when linked with different neighboring lines.\n", step))
	step++
	b.WriteString(fmt.Sprintf("%d. STRICT NDJSON STREAMING OUTPUT: Output strictly in NDJSON — emit ONE compact JSON object per line followed immediately by a newline as soon as each line is translated, in ascending order of i:\n{\"i\":1,\"t\":\"<translated text>\"}\nFor lines needing no translation, output {\"i\":<int>,\"t\":\"\"} or omit.\nNEVER wrap the output in an outer JSON object (no {\"lines\":[...]}), NEVER output a JSON array [...], and NEVER output markdown code fences (```) or conversational text.\n", step))
	return b.String()
}

// filterTargetLangReference 按 Stage 1 的 NeedsReferenceTranslation 决定送往 Stage 2 的参考译文：
// 常规歌词生成同语种译文时剥离同语种 ref（若为双参考 "zh+en" 则仅保留非目标语种），防止被内置生硬译文锚定；
// 仅当 Stage 1 判定存在造语/摩斯电码/密文等抽象歌词时才保留同语种参考译文。
func filterTargetLangReference(refLang, targetLang string, tasks []lyricTranslationLineTask, keepTargetRef bool) (string, []string) {
	refs := make([]string, len(tasks))
	for i, task := range tasks {
		refs[i] = task.RefText
	}
	if keepTargetRef || refLang == "" || targetLang == "" {
		return refLang, refs
	}
	if refLang == targetLang {
		return "", make([]string, len(tasks))
	}
	if !strings.Contains(refLang, "+") {
		return refLang, refs
	}
	parts := strings.SplitN(refLang, "+", 2)
	lang1, lang2 := parts[0], parts[1]
	if lang1 != targetLang && lang2 != targetLang {
		return refLang, refs
	}
	otherLang := lang1
	if lang1 == targetLang {
		otherLang = lang2
	}
	if otherLang == "" {
		return "", make([]string, len(tasks))
	}
	prefix := "[" + otherLang + "] "
	filtered := make([]string, len(tasks))
	hasAny := false
	for i, ref := range refs {
		if ref == "" {
			continue
		}
		for _, seg := range strings.Split(ref, " | ") {
			seg = strings.TrimSpace(seg)
			if strings.HasPrefix(seg, prefix) {
				if val := strings.TrimSpace(strings.TrimPrefix(seg, prefix)); val != "" {
					filtered[i] = val
					hasAny = true
				}
				break
			}
		}
	}
	if !hasAny {
		return "", make([]string, len(tasks))
	}
	return otherLang, filtered
}

func buildLyricTranslationUserPrompt(input *lyricTranslationInput, tasks []lyricTranslationLineTask) string {
	return buildLyricTranslationUserPromptWithOptions(input, tasks, false)
}

func buildLyricTranslationUserPromptWithOptions(input *lyricTranslationInput, tasks []lyricTranslationLineTask, keepTargetRef bool) string {
	type promptItem struct {
		I    int    `json:"i"`
		Orig string `json:"orig"`
		Ref  string `json:"ref,omitempty"`
		Bg   bool   `json:"bg,omitempty"`
		Hint bool   `json:"hint,omitempty"`
	}

	effectiveRefLang, effectiveRefs := filterTargetLangReference(input.RefLang, input.TargetLang, tasks, keepTargetRef)

	payload := struct {
		TargetLang    string       `json:"target_lang"`
		Title         string       `json:"title,omitempty"`
		Artists       []string     `json:"artists,omitempty"`
		Album         string       `json:"album,omitempty"`
		Aliases       []string     `json:"aliases,omitempty"`
		OrigLang      string       `json:"orig_lang,omitempty"`
		RefLang       string       `json:"ref_lang,omitempty"`
		ClassicalMode bool         `json:"classical_mode,omitempty"`
		Items         []promptItem `json:"items"`
	}{
		TargetLang:    fmt.Sprintf("%s (%s)", input.TargetLang, lyricTranslateLanguages[input.TargetLang]),
		Title:         input.Track.Name,
		Artists:       input.Track.Artists,
		Album:         input.Track.Album,
		Aliases:       input.Track.Aliases,
		OrigLang:      input.OrigLang,
		RefLang:       effectiveRefLang,
		ClassicalMode: input.ClassicalMode,
	}

	payload.Items = make([]promptItem, 0, len(tasks))
	for i, item := range tasks {
		payload.Items = append(payload.Items, promptItem{
			I:    item.Index,
			Orig: item.VocalText,
			Ref:  effectiveRefs[i],
			Bg:   item.Bg,
			Hint: item.Hint,
		})
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

// extractTranslationSourceLines 提取并裁剪指定歌曲和词源的稳定原文行列表（供单语言生成与多语言状态查询共享同一份基线）
func (s *MusicService) extractTranslationSourceLines(ctx context.Context, track *dto.MusicTrackDto, requestedSource string) (string, []lyricTranslationExtracted, *dto.MusicLyricCacheDto, *errs.ServiceError) {
	snapshot, _ := loadLyricVersionSnapshot(ctx, track.ID)

	resolvedSource := requestedSource
	if resolvedSource == "" {
		version, svcerr := s.siteLyricVersion(ctx, track.ID)
		if svcerr != nil {
			return "", nil, nil, svcerr
		}
		if version == nil || version.Lines == nil || len(version.Lines.Timed) == 0 {
			return "", nil, nil, errs.NewNotFound("lyric_not_found")
		}
		resolvedSource = version.Lines.Source
		// 刚决策出全站版本尚未落库时，确保 snapshot 中带有所选来源的数据
		if snapshot == nil {
			snapshot = s.snapshotForKind(ctx, track.ID, version.Kind)
		}
	}

	extracted, svcerr := s.extractSourceLines(ctx, track.ID, resolvedSource, snapshot)
	if svcerr != nil {
		return "", nil, nil, svcerr
	}
	if len(extracted) == 0 {
		return "", nil, nil, errs.NewNotFound("lyric_not_found")
	}

	// 平台歌词与前端 stripCredits 一致，裁剪首尾署名行；TTML 不去署名行
	if !strings.HasPrefix(resolvedSource, "ttml") {
		rawTexts := make([]string, len(extracted))
		for i, line := range extracted {
			rawTexts[i] = line.Text
		}
		head, tail := lyricCreditRange(rawTexts, track.Name, track.Artists)
		extracted = extracted[head:tail]
	}
	if len(extracted) > lyricTranslationMaxLines {
		extracted = extracted[:lyricTranslationMaxLines]
	}
	if len(extracted) == 0 {
		return "", nil, nil, errs.NewNotFound("lyric_not_found")
	}
	return resolvedSource, extracted, snapshot, nil
}

// buildTranslationInputFromExtracted 基于稳定原文行构建目标语言任务与内容哈希（保证自带译文与 AI 覆盖共享同一 lyric_hash）
func (s *MusicService) buildTranslationInputFromExtracted(
	ctx context.Context,
	track *dto.MusicTrackDto,
	resolvedSource string,
	extracted []lyricTranslationExtracted,
	snapshot *dto.MusicLyricCacheDto,
	targetLang string,
) *lyricTranslationInput {
	// 检测内置翻译语言：当目标语言已有内置翻译时（nativeTarget=true），仍取出其译文作为 AI 覆盖时的参考基准与哈希输入，确保全链路哈希一致
	nativeTarget, refLang, refTexts := resolveTranslationReferences(extracted, targetLang)
	if nativeTarget {
		_, refLang, refTexts = resolveTranslationReferencesWithOptions(extracted, targetLang, true)
	}
	if refLang == "" {
		refLang, refTexts = s.borrowReferenceTranslations(ctx, track.ID, resolvedSource, targetLang, extracted, snapshot)
	}

	// 为全部行计算按 (Bg, normalizeLyricMatch(Text)) 的 0-based 出现序号，并过滤非唱词行
	type occKey struct {
		bg   bool
		norm string
	}
	occCounts := make(map[occKey]int, len(extracted))
	tasks := make([]lyricTranslationLineTask, 0, len(extracted))
	vocalTexts := make([]string, 0, len(extracted))

	for i, line := range extracted {
		key := occKey{bg: line.Bg, norm: lyricLineMatchKey(line.Text)}
		occ := occCounts[key]
		occCounts[key] = occ + 1

		vocalText, skip, isHint := classifyLyricTranslationLine(line.Text)
		if skip {
			continue
		}
		refText := ""
		if i < len(refTexts) {
			refText = refTexts[i]
		}
		if !isHint {
			vocalTexts = append(vocalTexts, vocalText)
		}
		tasks = append(tasks, lyricTranslationLineTask{
			Index:      len(tasks) + 1,
			OrigText:   line.Text,
			VocalText:  vocalText,
			Occurrence: occ,
			Bg:         line.Bg,
			Hint:       isHint,
			RefText:    refText,
		})
	}

	origLang := detectLyricTextLang(vocalTexts, "")
	sameLanguage := songAlreadyInTargetLang(vocalTexts, targetLang)
	hasClassical := songHasClassicalChinese(vocalTexts)
	classicalMode := (targetLang == "zh" || targetLang == "zh-tw" || targetLang == "zh-hk") && !sameLanguage && hasClassical
	classicalForeign := !classicalMode && !sameLanguage && hasClassical && targetLang != "zh" && targetLang != "zh-tw" && targetLang != "zh-hk"

	return &lyricTranslationInput{
		Track:            track,
		Source:           resolvedSource,
		TargetLang:       targetLang,
		LyricHash:        computeLyricTranslationHash(resolvedSource, extracted, refLang, refTexts, classicalMode, classicalForeign, tasks),
		OrigLang:         origLang,
		RefLang:          refLang,
		NativeTarget:     nativeTarget,
		SameLanguage:     sameLanguage,
		ClassicalMode:    classicalMode,
		ClassicalChinese: hasClassical,
		Tasks:            tasks,
	}
}

// extractTranslationInput 提取指定歌曲和词源的行数据，检测原文与内置/借用译文语言，并构建任务
func (s *MusicService) extractTranslationInput(ctx context.Context, track *dto.MusicTrackDto, requestedSource, targetLang string) (*lyricTranslationInput, *errs.ServiceError) {
	resolvedSource, extracted, snapshot, svcerr := s.extractTranslationSourceLines(ctx, track, requestedSource)
	if svcerr != nil {
		return nil, svcerr
	}
	return s.buildTranslationInputFromExtracted(ctx, track, resolvedSource, extracted, snapshot, targetLang), nil
}

func computeLyricTranslationHash(source string, extracted []lyricTranslationExtracted, refLang string, refTexts []string, classicalMode, classicalForeign bool, tasks []lyricTranslationLineTask) string {
	var b strings.Builder
	b.WriteString("v2\n")
	b.WriteString(source)
	b.WriteByte('\n')
	b.WriteString(refLang)
	if classicalMode {
		b.WriteString("\nclassical")
	} else if classicalForeign {
		b.WriteString("\nclassical-gloss-v2")
	}
	for _, task := range tasks {
		if task.Hint {
			b.WriteString("\nhint")
			break
		}
	}
	for i, line := range extracted {
		b.WriteByte('\n')
		if line.Bg {
			b.WriteString("bg:")
		} else {
			b.WriteString("m:")
		}
		b.WriteString(line.Text)
		if i < len(refTexts) && refTexts[i] != "" {
			b.WriteByte('\t')
			b.WriteString(refTexts[i])
		}
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

func loadLyricVersionSnapshot(ctx context.Context, id int64) (*dto.MusicLyricCacheDto, error) {
	record, err := loadLyricVersionRecord(ctx, id)
	if err != nil || record == nil {
		return nil, err
	}
	var snapshot dto.MusicLyricCacheDto
	if unmarshalErr := json.Unmarshal([]byte(record.Data), &snapshot); unmarshalErr != nil {
		return nil, unmarshalErr
	}
	return &snapshot, nil
}

func (s *MusicService) snapshotForKind(ctx context.Context, id int64, kind string) *dto.MusicLyricCacheDto {
	res := lyricSourceFetch(s, ctx, id, kind)
	if res.data == nil {
		return nil
	}
	snapshot := &dto.MusicLyricCacheDto{}
	switch kind {
	case "ncm":
		if ncm, ok := res.data.(*dto.MusicLyricDto); ok {
			snapshot.Ncm = ncm
		}
	case "ttml":
		if ttml, ok := res.data.(*dto.MusicTTMLDto); ok {
			snapshot.TTML = ttml
		}
	case "qq":
		if qq, ok := res.data.(*dto.MusicQQLyricDto); ok {
			snapshot.QQ = qq
		}
	case "kugou":
		if kugou, ok := res.data.(*dto.MusicKugouLyricDto); ok {
			snapshot.Kugou = kugou
		}
	}
	return snapshot
}

func (s *MusicService) extractSourceLines(ctx context.Context, id int64, source string, snapshot *dto.MusicLyricCacheDto) ([]lyricTranslationExtracted, *errs.ServiceError) {
	switch source {
	case "ttml-custom", "ttml-amll":
		rawTTML := s.resolveRawTTMLForSource(ctx, id, source, snapshot)
		if rawTTML == "" {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		lines := parseTTMLTranslationLines(rawTTML)
		if len(lines) == 0 {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		return lines, nil
	case "ncm-yrc", "ncm-lrc":
		ncm := s.resolveNCMLyric(ctx, id, snapshot)
		if ncm == nil {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		var raw, trans string
		if source == "ncm-yrc" {
			if ncm.Yrc == nil || strings.TrimSpace(ncm.Yrc.Lyric) == "" {
				return nil, errs.NewNotFound("lyric_not_found")
			}
			raw = ncm.Yrc.Lyric
			trans = lyricTranslationSource(ncm, true)
		} else {
			if ncm.Lrc == nil || strings.TrimSpace(ncm.Lrc.Lyric) == "" {
				return nil, errs.NewNotFound("lyric_not_found")
			}
			raw = ncm.Lrc.Lyric
			if ncm.Tlyric != nil {
				trans = ncm.Tlyric.Lyric
			}
		}
		lines := parsePlatformTranslationLines(raw, trans)
		if len(lines) == 0 {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		return lines, nil
	case "qq-qrc", "qq-lrc":
		qq := s.resolveQQLyric(ctx, id, snapshot)
		if qq == nil || strings.TrimSpace(qq.Lyric) == "" {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		if (source == "qq-qrc") != (qq.Format == "qrc") {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		lines := parsePlatformTranslationLines(qq.Lyric, qq.Translation)
		if len(lines) == 0 || allLinesInstrumental(lines) {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		return lines, nil
	case "kugou-krc", "kugou-lrc":
		kugou := s.resolveKugouLyric(ctx, id, snapshot)
		if kugou == nil || strings.TrimSpace(kugou.Lyric) == "" {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		if (source == "kugou-krc") != (kugou.Format == "qrc") {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		lines := parsePlatformTranslationLines(kugou.Lyric, kugou.Translation)
		if len(lines) == 0 || allLinesInstrumental(lines) {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		return lines, nil
	default:
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
}

func allLinesInstrumental(lines []lyricTranslationExtracted) bool {
	for _, line := range lines {
		if !lyricInstrumentalRe.MatchString(line.Text) {
			return false
		}
	}
	return true
}

func (s *MusicService) resolveRawTTMLForSource(ctx context.Context, id int64, source string, snapshot *dto.MusicLyricCacheDto) string {
	if snapshot != nil {
		if source == "ttml-custom" {
			if snapshot.TTML != nil && snapshot.TTML.Source == musicTTMLSourceCustom && snapshot.TTML.TTML != "" {
				return snapshot.TTML.TTML
			}
		} else {
			if snapshot.TTML != nil && snapshot.TTML.Source != musicTTMLSourceCustom && snapshot.TTML.TTML != "" {
				return snapshot.TTML.TTML
			}
			if snapshot.QQ != nil && snapshot.QQ.TTML != "" {
				return snapshot.QQ.TTML
			}
		}
	}
	res := lyricSourceFetch(s, ctx, id, "ttml")
	if ttml, ok := res.data.(*dto.MusicTTMLDto); ok && ttml != nil && ttml.TTML != "" {
		isCustom := ttml.Source == musicTTMLSourceCustom
		if (source == "ttml-custom" && isCustom) || (source == "ttml-amll" && !isCustom) {
			return ttml.TTML
		}
	}
	if source == "ttml-amll" {
		if qqRes := lyricSourceFetch(s, ctx, id, "qq"); qqRes.data != nil {
			if qq, ok := qqRes.data.(*dto.MusicQQLyricDto); ok && qq != nil && qq.TTML != "" {
				return qq.TTML
			}
		}
	}
	return ""
}

func (s *MusicService) resolveNCMLyric(ctx context.Context, id int64, snapshot *dto.MusicLyricCacheDto) *dto.MusicLyricDto {
	if snapshot != nil && snapshot.Ncm != nil {
		return snapshot.Ncm
	}
	if res := lyricSourceFetch(s, ctx, id, "ncm"); res.data != nil {
		if ncm, ok := res.data.(*dto.MusicLyricDto); ok && ncm != nil {
			return ncm
		}
	}
	return nil
}

func (s *MusicService) resolveQQLyric(ctx context.Context, id int64, snapshot *dto.MusicLyricCacheDto) *dto.MusicQQLyricDto {
	if snapshot != nil && snapshot.QQ != nil && snapshot.QQ.Lyric != "" {
		return snapshot.QQ
	}
	if res := lyricSourceFetch(s, ctx, id, "qq"); res.data != nil {
		if qq, ok := res.data.(*dto.MusicQQLyricDto); ok && qq != nil {
			return qq
		}
	}
	return nil
}

func (s *MusicService) resolveKugouLyric(ctx context.Context, id int64, snapshot *dto.MusicLyricCacheDto) *dto.MusicKugouLyricDto {
	if snapshot != nil && snapshot.Kugou != nil && snapshot.Kugou.Lyric != "" {
		return snapshot.Kugou
	}
	if res := lyricSourceFetch(s, ctx, id, "kugou"); res.data != nil {
		if kugou, ok := res.data.(*dto.MusicKugouLyricDto); ok && kugou != nil {
			return kugou
		}
	}
	return nil
}

// resolveTranslationReferences 识别每组内置翻译的真实语言，判断目标语言是否已自带，或选出最优参考译文（多语种可用时合并前两种非重复参考）
func resolveTranslationReferences(extracted []lyricTranslationExtracted, targetLang string) (nativeTarget bool, refLang string, refTexts []string) {
	return resolveTranslationReferencesWithOptions(extracted, targetLang, false)
}

func resolveTranslationReferencesWithOptions(extracted []lyricTranslationExtracted, targetLang string, allowTargetAsRef bool) (nativeTarget bool, refLang string, refTexts []string) {
	buckets := map[string][]string{}
	for _, line := range extracted {
		origNorm := lyricLineMatchKey(line.Text)
		for tag, text := range line.BuiltInByLang {
			tr := collapseLyricSpace(text)
			if tr == "" || tr == "//" || lyricLineMatchKey(tr) == origNorm {
				continue
			}
			buckets[tag] = append(buckets[tag], tr)
		}
	}
	if len(buckets) == 0 {
		return false, "", nil
	}

	nonEmptyLines := 0
	for _, line := range extracted {
		if strings.TrimSpace(line.Text) != "" {
			nonEmptyLines++
		}
	}
	minMeaningful := min(2, nonEmptyLines)
	minRefLines := min(1, nonEmptyLines)

	type resolvedBucket struct {
		tag  string
		lang string
		cnt  int
	}
	var resolved []resolvedBucket
	for tag, texts := range buckets {
		if len(texts) < minRefLines {
			continue
		}
		lang := detectLyricTextLang(texts, tag)
		if lang == "" {
			continue
		}
		if !allowTargetAsRef && lang == targetLang && len(texts) >= minMeaningful {
			nativeTarget = true
		}
		resolved = append(resolved, resolvedBucket{tag: tag, lang: lang, cnt: len(texts)})
	}
	if nativeTarget || len(resolved) == 0 {
		return nativeTarget, "", nil
	}

	// 挑选参考翻译优先级：借用跨词源参考时最优先 targetLang 本身；常规下目标为 zh-tw / zh-hk 时优先 zh，其次 zh > zh-tw / zh-hk > en > 覆盖行数最多者
	rank := func(lang string) int {
		if allowTargetAsRef && targetLang != "" && lang == targetLang {
			return 5
		}
		switch lang {
		case "zh":
			if targetLang == "zh-tw" || targetLang == "zh-hk" {
				return 4
			}
			return 3
		case "zh-tw", "zh-hk":
			if targetLang == "zh-tw" || targetLang == "zh-hk" {
				return 3
			}
			return 2
		case "en":
			return 1
		default:
			return 0
		}
	}
	sort.SliceStable(resolved, func(i, j int) bool {
		ri, rj := rank(resolved[i].lang), rank(resolved[j].lang)
		if ri != rj {
			return ri > rj
		}
		return resolved[i].cnt > resolved[j].cnt
	})
	best := resolved[0]
	var second resolvedBucket
	hasSecond := false
	for _, cand := range resolved[1:] {
		if cand.lang != best.lang {
			second = cand
			hasSecond = true
			break
		}
	}

	cleanBuiltIn := func(line lyricTranslationExtracted, tag string) string {
		tr := collapseLyricSpace(line.BuiltInByLang[tag])
		if tr == "" || tr == "//" || lyricLineMatchKey(tr) == lyricLineMatchKey(line.Text) {
			return ""
		}
		return tr
	}

	t1s := make([]string, len(extracted))
	t2s := make([]string, len(extracted))
	usedSecond := false
	for i, line := range extracted {
		t1 := cleanBuiltIn(line, best.tag)
		t1s[i] = t1
		if !hasSecond {
			continue
		}
		t2 := cleanBuiltIn(line, second.tag)
		if t2 != "" && normalizeLyricMatch(t2) != normalizeLyricMatch(t1) {
			t2s[i] = t2
			usedSecond = true
		}
	}
	if !usedSecond {
		return false, best.lang, t1s
	}

	combined := make([]string, len(extracted))
	for i := range extracted {
		t1, t2 := t1s[i], t2s[i]
		switch {
		case t1 != "" && t2 != "":
			combined[i] = fmt.Sprintf("[%s] %s | [%s] %s", best.lang, t1, second.lang, t2)
		case t1 != "":
			combined[i] = fmt.Sprintf("[%s] %s", best.lang, t1)
		case t2 != "":
			combined[i] = fmt.Sprintf("[%s] %s", second.lang, t2)
		}
	}
	return false, best.lang + "+" + second.lang, combined
}

type lyricRefDonor struct {
	origRaw   string
	transRaw  string
	ttmlLines []lyricTranslationExtracted
}

func fillMissingRefByOrigText(extracted []lyricTranslationExtracted, aligned []string, donorOrigTexts, donorRefTexts []string) {
	type textOccKey struct {
		norm string
		occ  int
	}
	byOcc := make(map[textOccKey]string, len(donorOrigTexts))
	firstByNorm := make(map[string]string, len(donorOrigTexts))
	donorOcc := make(map[string]int, len(donorOrigTexts))

	for i, orig := range donorOrigTexts {
		norm := lyricLineMatchKey(orig)
		if len([]rune(norm)) < 2 {
			continue
		}
		occ := donorOcc[norm]
		donorOcc[norm] = occ + 1
		if i >= len(donorRefTexts) {
			continue
		}
		ref := strings.TrimSpace(donorRefTexts[i])
		if ref == "" {
			continue
		}
		key := textOccKey{norm: norm, occ: occ}
		if _, exists := byOcc[key]; !exists {
			byOcc[key] = ref
		}
		if _, exists := firstByNorm[norm]; !exists {
			firstByNorm[norm] = ref
		}
	}
	if len(firstByNorm) == 0 {
		return
	}

	targetOcc := make(map[string]int, len(extracted))
	for i, line := range extracted {
		norm := lyricLineMatchKey(line.Text)
		if len([]rune(norm)) < 2 {
			continue
		}
		occ := targetOcc[norm]
		targetOcc[norm] = occ + 1
		if aligned[i] != "" {
			continue
		}
		if ref, ok := byOcc[textOccKey{norm: norm, occ: occ}]; ok {
			aligned[i] = ref
		} else if ref, ok := firstByNorm[norm]; ok {
			aligned[i] = ref
		}
	}
}

// borrowReferenceTranslations 当当前歌词源没有任何自带翻译时，尝试从同曲快照或已缓存的其他平台（含 NCM/QQ/Kugou/TTML）读取参考翻译（不主动触发外部搜索请求）
func (s *MusicService) borrowReferenceTranslations(ctx context.Context, id int64, source, targetLang string, extracted []lyricTranslationExtracted, snapshot *dto.MusicLyricCacheDto) (string, []string) {
	var donors []lyricRefDonor

	var ncm *dto.MusicLyricDto
	if snapshot != nil && snapshot.Ncm != nil {
		ncm = snapshot.Ncm
	} else if cached, ok := loadMusicLyricCacheEntry(id); ok && !cached.miss() {
		ncm = &cached.Lyric
	} else if !strings.HasPrefix(source, "ncm") && tools.GetNCMConfig().Configured() {
		if res := lyricSourceFetch(s, ctx, id, "ncm"); res.data != nil {
			if fetched, ok := res.data.(*dto.MusicLyricDto); ok {
				ncm = fetched
			}
		}
	}
	if ncm != nil {
		if t := firstLyricPart(ncm.Ytlrc, ncm.Tlyric); t != "" {
			var origRaw string
			if ncm.Yrc != nil && strings.TrimSpace(ncm.Yrc.Lyric) != "" {
				origRaw = ncm.Yrc.Lyric
			} else if ncm.Lrc != nil {
				origRaw = ncm.Lrc.Lyric
			}
			donors = append(donors, lyricRefDonor{origRaw: origRaw, transRaw: t})
		}
	}

	var qq *dto.MusicQQLyricDto
	if snapshot != nil && snapshot.QQ != nil {
		qq = snapshot.QQ
	} else if cached, ok := loadQQCacheEntry(id); ok && cached.Lyric.Translation != "" {
		qq = &cached.Lyric
	}
	if qq != nil && strings.TrimSpace(qq.Translation) != "" {
		donors = append(donors, lyricRefDonor{origRaw: qq.Lyric, transRaw: qq.Translation})
	}

	var kugou *dto.MusicKugouLyricDto
	if snapshot != nil && snapshot.Kugou != nil {
		kugou = snapshot.Kugou
	} else if cached, ok := loadKugouCacheEntry(id); ok && cached.Lyric.Translation != "" {
		kugou = &cached.Lyric
	}
	if kugou != nil && strings.TrimSpace(kugou.Translation) != "" {
		donors = append(donors, lyricRefDonor{origRaw: kugou.Lyric, transRaw: kugou.Translation})
	}

	if !strings.HasPrefix(source, "ttml") {
		seenTTML := map[string]bool{}
		addTTMLDonor := func(raw string) {
			trimmed := strings.TrimSpace(raw)
			if trimmed == "" || seenTTML[trimmed] {
				return
			}
			seenTTML[trimmed] = true
			if parsed := parseTTMLTranslationLines(trimmed); len(parsed) > 0 {
				donors = append(donors, lyricRefDonor{ttmlLines: parsed})
			}
		}
		if snapshot != nil && snapshot.TTML != nil {
			addTTMLDonor(snapshot.TTML.TTML)
		}
		if cached := loadTTMLCacheEntry(musicTTMLCache, ttmlCacheKey(musicTTMLSourceCustom, id)); cached.ok {
			addTTMLDonor(cached.entry.TTML)
		}
		if cached := loadTTMLCacheEntry(musicTTMLCache, ttmlCacheKey(musicTTMLSourceAMLL, id)); cached.ok {
			addTTMLDonor(cached.entry.TTML)
		}
		if snapshot != nil && snapshot.QQ != nil {
			addTTMLDonor(snapshot.QQ.TTML)
		}
	}

	if len(donors) == 0 {
		return "", nil
	}

	timed := make([]lyricTimedLine, len(extracted))
	for i, line := range extracted {
		timed[i] = lyricTimedLine{Start: line.Start, Text: line.Text}
	}

	for _, donor := range donors {
		if len(donor.ttmlLines) > 0 {
			_, dLang, dRefs := resolveTranslationReferencesWithOptions(donor.ttmlLines, targetLang, true)
			if dLang == "" {
				continue
			}
			aligned := make([]string, len(extracted))
			for i, line := range extracted {
				best, bestDiff := "", int64(math.MaxInt64)
				for j, cand := range donor.ttmlLines {
					if j >= len(dRefs) || dRefs[j] == "" || dRefs[j] == line.Text {
						continue
					}
					diff := cand.Start - line.Start
					if diff < 0 {
						diff = -diff
					}
					if diff < bestDiff || (diff == bestDiff && cand.Bg == line.Bg) {
						best, bestDiff = dRefs[j], diff
					}
				}
				if bestDiff <= lyricTranslationTolerance {
					aligned[i] = best
				}
			}
			donorOrigs := make([]string, len(donor.ttmlLines))
			for i, item := range donor.ttmlLines {
				donorOrigs[i] = item.Text
			}
			fillMissingRefByOrigText(extracted, aligned, donorOrigs, dRefs)

			var samples []string
			for _, text := range aligned {
				if text != "" {
					samples = append(samples, text)
				}
			}
			if len(samples) >= min(1, len(extracted)) {
				return dLang, aligned
			}
			continue
		}

		aligned := alignExpandedTranslations(timed, donor.transRaw)
		if donor.origRaw != "" {
			donorTimed := expandPlatformTimedLines(donor.origRaw)
			if len(donorTimed) > 0 {
				donorRefs := alignExpandedTranslations(donorTimed, donor.transRaw)
				donorOrigs := make([]string, len(donorTimed))
				for i, item := range donorTimed {
					donorOrigs[i] = item.Text
				}
				fillMissingRefByOrigText(extracted, aligned, donorOrigs, donorRefs)
			}
		}

		var samples []string
		for _, text := range aligned {
			if text != "" {
				samples = append(samples, text)
			}
		}
		if len(samples) >= min(1, len(extracted)) {
			if lang := detectLyricTextLang(samples, ""); lang != "" {
				return lang, aligned
			}
		}
	}
	return "", nil
}

// parsePlatformTranslationLines 按前端 parse-platform.ts 规则展开多时间戳 LRC 行并按开始时间稳定排序，再对齐同平台翻译
func parsePlatformTranslationLines(raw, translationRaw string) []lyricTranslationExtracted {
	timed := expandPlatformTimedLines(raw)
	if len(timed) == 0 {
		return nil
	}
	aligned := alignExpandedTranslations(timed, translationRaw)
	out := make([]lyricTranslationExtracted, len(timed))
	for i, line := range timed {
		var builtIn map[string]string
		if aligned[i] != "" {
			builtIn = map[string]string{"": aligned[i]}
		}
		out[i] = lyricTranslationExtracted{
			Start:         line.Start,
			Text:          line.Text,
			BuiltInByLang: builtIn,
		}
	}
	return out
}

func expandPlatformTimedLines(raw string) []lyricTimedLine {
	var lines []lyricTimedLine
	for _, rawLine := range strings.Split(raw, "\n") {
		line := strings.TrimSpace(rawLine)
		head := lyricLineHeadRe.FindString(line)
		if head == "" {
			continue
		}
		text := collapseLyricSpace(lyricWordTagRe.ReplaceAllString(line[len(head):], ""))
		if text == "" || text == "no_lyric" || text == "pure_music_without_lyric" {
			continue
		}
		if runes := []rune(text); len(runes) > lyricTranslationMaxLineRunes {
			text = string(runes[:lyricTranslationMaxLineRunes])
		}
		for _, start := range extractHeadStarts(head) {
			lines = append(lines, lyricTimedLine{Start: start, Text: text})
		}
	}
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].Start < lines[j].Start })
	return lines
}

func extractHeadStarts(head string) []int64 {
	if m := lyricSpanTimeRe.FindStringSubmatch(head); m != nil {
		start, _ := strconv.ParseInt(m[1], 10, 64)
		return []int64{start}
	}
	matches := lyricAllLRCTimesRe.FindAllStringSubmatch(head, -1)
	if len(matches) == 0 {
		return nil
	}
	starts := make([]int64, 0, len(matches))
	for _, m := range matches {
		minutes, _ := strconv.ParseInt(m[1], 10, 64)
		seconds, _ := strconv.ParseInt(m[2], 10, 64)
		ms := int64(0)
		if frac := m[3]; frac != "" {
			frac = (frac + "000")[:3]
			ms, _ = strconv.ParseInt(frac, 10, 64)
		}
		starts = append(starts, (minutes*60+seconds)*1000+ms)
	}
	return starts
}

func alignExpandedTranslations(lines []lyricTimedLine, raw string) []string {
	result := make([]string, len(lines))
	if strings.TrimSpace(raw) == "" {
		return result
	}
	var candidates []lyricTimedLine
	for _, line := range expandPlatformTimedLines(raw) {
		if line.Start >= 0 && line.Text != "//" {
			candidates = append(candidates, line)
		}
	}
	if len(candidates) == 0 {
		return result
	}
	for i, line := range lines {
		if line.Start < 0 {
			continue
		}
		best, bestDiff := "", int64(math.MaxInt64)
		for _, cand := range candidates {
			diff := cand.Start - line.Start
			if diff < 0 {
				diff = -diff
			}
			if diff < bestDiff {
				best, bestDiff = cand.Text, diff
			}
		}
		if bestDiff <= lyricTranslationTolerance && best != line.Text {
			result[i] = best
		}
	}
	return result
}

// parseTTMLTranslationLines 解析 TTML 并拆出与前端 parse-ttml.ts 一致的主唱行与 x-bg 背景行（复用 parseTTMLRichDoc）
func parseTTMLTranslationLines(raw string) []lyricTranslationExtracted {
	doc := parseTTMLRichDoc(raw)
	if doc == nil {
		return nil
	}
	out := make([]lyricTranslationExtracted, len(doc.Lines))
	for i, line := range doc.Lines {
		out[i] = lyricTranslationExtracted{
			Start:         line.Start,
			Text:          line.Text,
			Bg:            line.Bg,
			BuiltInByLang: line.BuiltInByLang,
		}
	}
	return out
}
