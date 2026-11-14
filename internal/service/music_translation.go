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
// - 参考译文：若当前歌词源自带或同曲其他源带有非目标语言的参考翻译，将原文（及语言）与参考翻译（及语言）一并送给模型辅助理解
// - 非唱词过滤：歌手名提示行、段落标注与署名行不翻译；行首歌手名/声部提示前缀先剥离再译，译文保留对应原行匹配键
// - 多词源独立缓存：ttml-amll / ttml-custom / ncm-yrc / ncm-lrc / qq-qrc / qq-lrc / kugou-krc / kugou-lrc 各自按其文本与来源单独翻译

const (
	lyricTranslationStatusReady   = "ready"
	lyricTranslationStatusPending = "pending"

	lyricTranslationMaxLines        = 320
	lyricTranslationMaxLineRunes    = 500
	lyricTranslationFirstChunkLines = 24
	lyricTranslationChunkLines      = 80
	lyricTranslationMaxChunks       = 4
	lyricTranslationMaxRetries      = 1
	lyricTranslationTimeout         = 2 * time.Minute
	lyricTranslationJobTTL          = 5 * time.Minute
	lyricTranslationRetryAfter      = 5 * time.Minute
	lyricTranslationTemperature     = 0.3
	lyricTranslationReasoning       = "none"
	lyricTranslationContextLines    = 4
)

var (
	lyricTranslationRetryDelay = time.Second
	lyricAllLRCTimesRe         = regexp.MustCompile(`\[(\d+):(\d+)(?:[.:](\d+))?\]`)
)

// lyricTranslationService 管理多语言歌词 AI 翻译任务的生命周期（共享状态互斥 + 失败冷却）
type lyricTranslationService struct {
	name        string
	initOnce    sync.Once
	mu          sync.Mutex
	limiter     *llmclient.Limiter
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
	done        func()
}

var lyricTranslations = &lyricTranslationService{
	name:    "lyric_translation",
	limiter: llmclient.DefaultLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricTranslationTemperature, lyricTranslationReasoning)
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
	Track         *dto.MusicTrackDto
	Source        string
	TargetLang    string
	LyricHash     string
	OrigLang      string
	RefLang       string
	NativeTarget  bool
	SameLanguage  bool
	ClassicalMode bool
	Tasks         []lyricTranslationLineTask
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
	if input.NativeTarget {
		return &dto.MusicLyricTranslationsDto{
			Status:     lyricTranslationStatusReady,
			Source:     input.Source,
			TargetLang: targetLang,
			Native:     true,
			Lines:      []dto.MusicLyricTranslationLine{},
		}, nil
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
	return lyricTranslations.getOrStart(input)
}

// RefreshLyricTranslations 管理员手动触发重新翻译一首歌指定来源与目标语言的歌词（忽略冷却与已有缓存），返回 pending
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
	if input.NativeTarget {
		return &dto.MusicLyricTranslationsDto{
			Status:     lyricTranslationStatusReady,
			Source:     input.Source,
			TargetLang: targetLang,
			Native:     true,
			Lines:      []dto.MusicLyricTranslationLine{},
		}, nil
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

	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_translations_unavailable")
	}

	if running {
		lines := a.loadPartial(key)
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
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	a.startLocked(key, input, cfg)
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
		a.startLocked(key, input, cfg)
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

func (a *lyricTranslationService) partialKey(key string) string {
	return a.prefix() + ":partial:" + key
}

func (a *lyricTranslationService) savePartial(key string, lines []dto.MusicLyricTranslationLine) {
	if key == "" || len(lines) == 0 {
		return
	}
	if err := sharedstate.SetJSON(a.partialKey(key), lines, lyricTranslationTimeout+time.Minute); err != nil {
		logrus.Warnf("save partial lyric translation %s: %v", key, err)
	}
}

func (a *lyricTranslationService) loadPartial(key string) []dto.MusicLyricTranslationLine {
	if key == "" {
		return nil
	}
	var lines []dto.MusicLyricTranslationLine
	found, err := sharedstate.GetJSON(a.partialKey(key), &lines)
	if err != nil || !found {
		return nil
	}
	return lines
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

func (a *lyricTranslationService) startLocked(key string, input *lyricTranslationInput, cfg tools.AIConfig) {
	jobKey, failedKey := a.stateKeys(key)
	lease, err := sharedstate.AcquireLease(jobKey, lyricTranslationJobTTL)
	if err != nil || lease == nil {
		if err != nil {
			logrus.Warnf("start lyric translation %s: %v", key, err)
		}
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	go a.run(lease, key, input, cfg)
}

func (a *lyricTranslationService) run(lease *sharedstate.Lease, key string, input *lyricTranslationInput, cfg tools.AIConfig) {
	_ = a.execute(lease, key, input, cfg)
}

func (a *lyricTranslationService) execute(lease *sharedstate.Lease, key string, input *lyricTranslationInput, cfg tools.AIConfig) (err error) {
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
		}
		_ = sharedstate.Current().Delete(a.partialKey(key))
		lease.Release()
		if a.done != nil {
			a.done()
		}
	}()

	lines, genErr := a.generateWithPartial(key, cfg, input)
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
	return nil
}

func parseLyricTranslationData(raw string) lyricTranslationData {
	var data lyricTranslationData
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &data)
	}
	return data
}

func (a *lyricTranslationService) call(cfg tools.AIConfig, system, user string) (string, error) {
	return a.callTier(cfg, llmclient.TierBackground, system, user)
}

func (a *lyricTranslationService) callFirstScreen(cfg tools.AIConfig, system, user string) (string, error) {
	return a.callTier(cfg, llmclient.TierFirstScreen, system, user)
}

func (a *lyricTranslationService) callTier(cfg tools.AIConfig, tier llmclient.PriorityTier, system, user string) (string, error) {
	_ = a.limiter.AcquireTier(context.Background(), a.concurrency, tier, nil)
	defer a.limiter.Release()
	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeTranslation, 0), lyricTranslationTimeout)
	defer cancel()
	return a.complete(ctx, cfg, system, user)
}

func lyricTranslationChunks(n int) [][2]int {
	if n <= 0 {
		return nil
	}
	if n <= lyricTranslationFirstChunkLines+4 {
		return [][2]int{{0, n}}
	}
	chunks := [][2]int{{0, lyricTranslationFirstChunkLines}}
	rem := n - lyricTranslationFirstChunkLines
	restCount := min((rem+lyricTranslationChunkLines-1)/lyricTranslationChunkLines, max(1, lyricTranslationMaxChunks-1))
	size := (rem + restCount - 1) / restCount
	for from := lyricTranslationFirstChunkLines; from < n; from += size {
		chunks = append(chunks, [2]int{from, min(from+size, n)})
	}
	return chunks
}

type lyricTranslationModelResponse struct {
	Lines []struct {
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
	return a.generateWithPartial("", cfg, input)
}

// lyricTranslationChunksForTasks 按首屏/常规阈值切段，并尽量避免将背景和声行拆离主唱段落在段首孤立翻译
func lyricTranslationChunksForTasks(tasks []lyricTranslationLineTask) [][2]int {
	chunks := lyricTranslationChunks(len(tasks))
	if len(chunks) <= 1 {
		return chunks
	}
	for i := 0; i < len(chunks)-1; i++ {
		split := chunks[i][1]
		steps := 0
		for steps < 2 && split < chunks[i+1][1] && tasks[split].Bg {
			split++
			steps++
		}
		chunks[i][1] = split
		chunks[i+1][0] = split
	}
	return chunks
}

// generateWithPartial 并行分段翻译整首歌：chunk 0 优先抢占首屏名额并在多段任务中先落共享状态，随后与其余分段并发完成。
func (a *lyricTranslationService) generateWithPartial(key string, cfg tools.AIConfig, input *lyricTranslationInput) ([]dto.MusicLyricTranslationLine, error) {
	if len(input.Tasks) == 0 {
		return []dto.MusicLyricTranslationLine{}, nil
	}
	system := buildLyricTranslationSystemPrompt(input.TargetLang, input.ClassicalMode)
	chunks := lyricTranslationChunksForTasks(input.Tasks)
	translated := make([]string, len(input.Tasks))
	errsList := make([]error, len(chunks))

	var wg sync.WaitGroup
	for chunkIdx, chunk := range chunks {
		wg.Add(1)
		go func(chunkIdx int, from, to int) {
			defer wg.Done()
			beforeStart := max(0, from-lyricTranslationContextLines)
			afterEnd := min(len(input.Tasks), to+lyricTranslationContextLines)
			baseUser := buildLyricTranslationUserPrompt(
				input,
				input.Tasks[beforeStart:from],
				input.Tasks[from:to],
				input.Tasks[to:afterEnd],
			)

			var chunkMap map[int]string
			var lastErr error
			user := baseUser
			for attempt := 0; attempt <= lyricTranslationMaxRetries; attempt++ {
				if attempt > 0 {
					time.Sleep(lyricTranslationRetryDelay)
				}
				var raw string
				var callErr error
				if chunkIdx == 0 {
					raw, callErr = a.callFirstScreen(cfg, system, user)
				} else {
					raw, callErr = a.call(cfg, system, user)
				}
				if callErr != nil {
					lastErr = callErr
					continue
				}
				parsedMap, parseErr := parseLyricTranslationChunk(raw, input.Tasks[from:to])
				if parseErr != nil {
					lastErr = parseErr
					continue
				}
				nonEmptyOut, rejectedScript := countRejectedChunkScripts(input.Tasks[from:to], parsedMap, input.TargetLang)
				if attempt < lyricTranslationMaxRetries && rejectedScript >= 2 && rejectedScript*100 >= max(nonEmptyOut, 1)*40 {
					user = baseUser + fmt.Sprintf("\nCRITICAL RETRY NOTICE: Your previous output used the wrong language/script (e.g. copying Chinese characters instead of translating). You MUST translate every non-target lyric into %s (%s).", input.TargetLang, lyricTranslateLanguages[input.TargetLang])
					lastErr = errors.New("lyric translation chunk returned wrong target script")
					chunkMap = parsedMap
					continue
				}
				chunkMap = parsedMap
				lastErr = nil
				break
			}
			if lastErr != nil && chunkMap == nil {
				errsList[chunkIdx] = lastErr
				return
			}
			for idx := from; idx < to; idx++ {
				task := input.Tasks[idx]
				translated[idx] = finalizeSingleLineTranslation(task, chunkMap[task.Index], input.TargetLang, input.Track.Artists)
			}
			if chunkIdx == 0 && len(chunks) > 1 && key != "" {
				partial := buildTranslatedLinesResult(input.Tasks[:to], translated[:to])
				a.savePartial(key, partial)
			}
		}(chunkIdx, chunk[0], chunk[1])
	}
	wg.Wait()
	for _, chunkErr := range errsList {
		if chunkErr != nil {
			return nil, chunkErr
		}
	}
	return buildTranslatedLinesResult(input.Tasks, translated), nil
}

func countRejectedChunkScripts(tasks []lyricTranslationLineTask, parsedMap map[int]string, targetLang string) (nonEmptyOut, rejected int) {
	for _, task := range tasks {
		raw := collapseLyricSpace(parsedMap[task.Index])
		if raw == "" {
			continue
		}
		nonEmptyOut++
		if !isValidTargetScriptTranslation(task.VocalText, raw, targetLang) {
			rejected++
		}
	}
	return nonEmptyOut, rejected
}

func parseLyricTranslationChunk(raw string, tasks []lyricTranslationLineTask) (map[int]string, error) {
	obj, err := extractJSONObject(raw)
	if err != nil {
		return nil, err
	}
	var parsed lyricTranslationModelResponse
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return nil, err
	}
	validIndices := make(map[int]bool, len(tasks))
	for _, task := range tasks {
		validIndices[task.Index] = true
	}
	out := make(map[int]string, len(tasks))
	matched := 0
	for _, item := range parsed.Lines {
		if !validIndices[item.I] {
			continue
		}
		matched++
		text := item.T
		if text == "" {
			text = item.Translation
		}
		out[item.I] = text
	}
	if len(tasks) > 0 && matched == 0 {
		return nil, errors.New("lyric translation chunk returned no matching indices")
	}
	return out, nil
}

func finalizeSingleLineTranslation(task lyricTranslationLineTask, raw, targetLang string, artists []string) string {
	cleaned := collapseLyricSpace(raw)
	if cleaned == "" {
		return ""
	}
	if !task.Hint {
		cleaned = stripLeakedCuePrefix(task.OrigText, task.VocalText, cleaned, artists)
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
	targetDesc := lyricTranslateLanguages[targetLang]
	var b strings.Builder
	b.WriteString("You are an accomplished literary music lyric translator.\n")
	b.WriteString(fmt.Sprintf("Translate the provided song lyrics STRICTLY into %s (language code: %s).\n\n", targetDesc, targetLang))
	b.WriteString("Guidelines:\n")
	b.WriteString("1. You may receive both \"orig\" (original lyrics) and \"ref\" (an upstream/sibling reference translation, e.g. Simplified Chinese, English, or multi-language \"[lang] ...\"). Use BOTH together to grasp idioms, wordplay, implied subjects, and emotion accurately.\n")
	b.WriteString("   CONSTRUCTED / FICTIONAL / OBSCURE LANGUAGES: When \"orig\" appears to be a self-invented/constructed language (e.g., *LaVI-Bavellabion* or fantasy lyrics) or an unfamiliar non-standard language AND a meaningful \"ref\" is provided, you MUST use \"ref\" (plus \"context_before\" / \"context_after\") as the primary semantic basis and translate it naturally into targetLang. NEVER mistake constructed-language lines with \"ref\" for empty non-lexical scat! If \"ref\" is already in targetLang borrowed from a sibling source, refine it smoothly for this line split instead of returning \"\"; if \"ref\" is in another language, translate it rather than copying \"ref\" verbatim.\n")
	if targetLang == "ja" || targetLang == "ko" || targetLang == "en" {
		b.WriteString(fmt.Sprintf("   CRITICAL TARGET-LANGUAGE RULE: When target_lang is %s (%s), NEVER copy or echo Chinese sentences from \"ref\" or Chinese \"orig\" into your output! You MUST translate Chinese/foreign lines naturally into %s using authentic target-language script and grammar", targetLang, targetDesc, targetDesc))
		if targetLang == "ja" {
			b.WriteString(" (for Japanese, write natural Japanese phrases with Hiragana/Katakana okurigana and particles — NEVER output pure Chinese Kanji sentences)")
		} else if targetLang == "ko" {
			b.WriteString(" (for Korean, write natural Hangul sentences — NEVER output raw Chinese/Hanja sentences)")
		}
		b.WriteString(".\n")
	}
	b.WriteString("2. Pursue \"信、达、雅\" (faithfulness, fluency, and poetic elegance) infused with the song's emotion, persona, and expressive tone (tender, playful, proud, dramatic, sorrowful, etc.):\n")
	b.WriteString("   - Expressive cultural flavor (apply by analogy): When an iconic emotional or cultural keyword would lose its charm if flattened (e.g., Japanese \"かわい\" / \"かわいい\" in a cute character song translated into English as \"kawaii (cute)\"), you may keep the standout original/romanized keyword paired with a tiny 1–3 word parenthetical gloss in targetLang so readers feel both the original vibe and exact meaning. Use this sparingly and tastefully only where it truly shines.\n")
	b.WriteString("   - Selective difficult-term notes: For deep local cultural allusions, historical titles, classical references (e.g., allusions in Classical Chinese poems like 琵琶行 translated for foreign listeners), or obscure concepts hard to grasp directly, you may add a concise parenthetical gloss (within 2–5 words) ONLY on the first occurrence of genuinely difficult terms — skip common words and never write lengthy footnotes.\n")
	switch targetLang {
	case "zh-tw":
		b.WriteString("3. CRITICAL for zh-tw: Write authentic, idiomatic Taiwanese Traditional Chinese (台灣繁體中文與台灣地道書面用語，如台灣習慣詞彙與語氣). Do NOT perform mechanical Simplified-to-Traditional character substitution, and avoid Mainland or Hong Kong Cantonese-specific phrasing.\n")
	case "zh-hk":
		b.WriteString("3. CRITICAL for zh-hk: Write authentic, idiomatic Hong Kong / Macau Traditional Chinese (香港澳門繁體書面語與地道港澳用語). Unless the source lyrics are explicitly colloquial Cantonese, prefer polished written Hong Kong / Macau Chinese; do NOT perform mechanical Simplified-to-Traditional character substitution, and avoid stiff Taiwanese or Mainland-specific phrasing.\n")
	default:
		b.WriteString("3. Match the natural register, tense, imagery, and emotional tone of the song in the target language.\n")
	}
	b.WriteString("4. Mixed-language & scat/onomatopoeia handling: Evaluate each line individually:\n")
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
	b.WriteString("5. Cross-line clause linking (串句合译与自然断句): Lyrics often split one connected sentence across adjacent lines (e.g., \"春风吹不倒\" + \"我的杨柳腰\" forms \"春风吹不倒我的杨柳腰\"). When consecutive lines (including background vocals and context_before / context_after) form one connected clause or modifier phrase, translate the combined thought naturally in targetLang grammar first, then split it cleanly across the exact item indices i at natural phrasing pauses so adjacent lines flow smoothly together. Do NOT cram two lines into one index while leaving the companion line \"\".\n")
	b.WriteString("6. Proper nouns: Real or fictional place names, games/anime/media (e.g. 《原神》 -> \"Genshin Impact\"), famous historical or modern figures, books, and song titles MUST use standard recognized official translations in targetLang (respecting regional and script conventions of targetLang); fall back to semantic translation or phonetic transliteration only when no official/recognized name exists.\n")
	step := 7
	if classicalMode {
		b.WriteString(fmt.Sprintf("%d. CLASSICAL CHINESE -> MODERN VERNACULAR MODE (古文转白话): This song contains Classical Chinese (文言文 / 古诗词 / 古风文言句). For every line written in Classical Chinese or archaic poetic diction, translate it into concise, graceful, poetic modern Chinese vernacular (%s) suited for lyric subtitles. Do NOT leave Classical Chinese lines untranslated; however, return \"\" for lines that are already plain modern Chinese, and return \"\" for immediate short echo fragments that merely repeat a few trailing syllables of the preceding classical line without adding new meaning.\n", step, targetDesc))
		step++
	}
	b.WriteString(fmt.Sprintf("%d. Hint/credit lines (items with \"hint\": true, such as \"词作者：XXX\", \"曲作者：XXX\", \"作词：XXX\") -> translate the role label and artist/creator name concisely into targetLang ONLY when an established/confident localized form exists (for creator names, use only publicly recognized names or keep the original name; NEVER invent translations). Return \"\" if uncertain or already in targetLang. For non-hint lines, NEVER prepend singer names or colons.\n", step))
	step++
	b.WriteString(fmt.Sprintf("%d. Repeated lines should keep consistent wording for recurring refrains, except first-occurrence parenthetical notes need not repeat and phrasing may adapt when linked with different neighboring lines.\n", step))
	step++
	b.WriteString(fmt.Sprintf("%d. Output strictly a single valid JSON object matching {\"lines\":[{\"i\":<int>,\"t\":\"<string>\"}]} containing every requested index i in order. No markdown fences or extra commentary.\n", step))
	return b.String()
}

func buildLyricTranslationUserPrompt(input *lyricTranslationInput, before, chunk, after []lyricTranslationLineTask) string {
	type promptItem struct {
		I    int    `json:"i"`
		Orig string `json:"orig"`
		Ref  string `json:"ref,omitempty"`
		Bg   bool   `json:"bg,omitempty"`
		Hint bool   `json:"hint,omitempty"`
	}
	type contextItem struct {
		Orig string `json:"orig"`
		Ref  string `json:"ref,omitempty"`
		Bg   bool   `json:"bg,omitempty"`
	}

	payload := struct {
		TargetLang    string        `json:"target_lang"`
		Title         string        `json:"title,omitempty"`
		Artists       []string      `json:"artists,omitempty"`
		Album         string        `json:"album,omitempty"`
		Aliases       []string      `json:"aliases,omitempty"`
		OrigLang      string        `json:"orig_lang,omitempty"`
		RefLang       string        `json:"ref_lang,omitempty"`
		ClassicalMode bool          `json:"classical_mode,omitempty"`
		ContextBefore []contextItem `json:"context_before,omitempty"`
		Items         []promptItem  `json:"items"`
		ContextAfter  []contextItem `json:"context_after,omitempty"`
	}{
		TargetLang:    fmt.Sprintf("%s (%s)", input.TargetLang, lyricTranslateLanguages[input.TargetLang]),
		Title:         input.Track.Name,
		Artists:       input.Track.Artists,
		Album:         input.Track.Album,
		Aliases:       input.Track.Aliases,
		OrigLang:      input.OrigLang,
		RefLang:       input.RefLang,
		ClassicalMode: input.ClassicalMode,
	}

	for _, item := range before {
		payload.ContextBefore = append(payload.ContextBefore, contextItem{Orig: item.VocalText, Ref: item.RefText, Bg: item.Bg})
	}
	for _, item := range after {
		payload.ContextAfter = append(payload.ContextAfter, contextItem{Orig: item.VocalText, Ref: item.RefText, Bg: item.Bg})
	}
	payload.Items = make([]promptItem, 0, len(chunk))
	for _, item := range chunk {
		payload.Items = append(payload.Items, promptItem{
			I:    item.Index,
			Orig: item.VocalText,
			Ref:  item.RefText,
			Bg:   item.Bg,
			Hint: item.Hint,
		})
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

// extractTranslationInput 提取指定歌曲和词源的行数据，检测原文与内置/借用译文语言，并构建任务
func (s *MusicService) extractTranslationInput(ctx context.Context, track *dto.MusicTrackDto, requestedSource, targetLang string) (*lyricTranslationInput, *errs.ServiceError) {
	snapshot, _ := loadLyricVersionSnapshot(ctx, track.ID)

	resolvedSource := requestedSource
	if resolvedSource == "" {
		version, svcerr := s.siteLyricVersion(ctx, track.ID)
		if svcerr != nil {
			return nil, svcerr
		}
		if version == nil || version.Lines == nil || len(version.Lines.Timed) == 0 {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		resolvedSource = version.Lines.Source
		// 刚决策出全站版本尚未落库时，确保 snapshot 中带有所选来源的数据
		if snapshot == nil {
			snapshot = s.snapshotForKind(ctx, track.ID, version.Kind)
		}
	}

	extracted, svcerr := s.extractSourceLines(ctx, track.ID, resolvedSource, snapshot)
	if svcerr != nil {
		return nil, svcerr
	}
	if len(extracted) == 0 {
		return nil, errs.NewNotFound("lyric_not_found")
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
		return nil, errs.NewNotFound("lyric_not_found")
	}

	// 检测内置翻译语言，若当前词源无可用翻译，从同曲其他已缓存来源（NCM / QQ / Kugou / TTML）借用参考译文
	nativeTarget, refLang, refTexts := resolveTranslationReferences(extracted, targetLang)
	if !nativeTarget && refLang == "" {
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
		key := occKey{bg: line.Bg, norm: normalizeLyricMatch(line.Text)}
		occ := occCounts[key]
		occCounts[key] = occ + 1

		vocalText, skip, isHint := classifyLyricTranslationLine(line.Text, track.Artists)
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
	sameLanguage := !nativeTarget && songAlreadyInTargetLang(vocalTexts, targetLang)
	classicalMode := (targetLang == "zh" || targetLang == "zh-tw" || targetLang == "zh-hk") && !sameLanguage && songHasClassicalChinese(vocalTexts)

	return &lyricTranslationInput{
		Track:         track,
		Source:        resolvedSource,
		TargetLang:    targetLang,
		LyricHash:     computeLyricTranslationHash(resolvedSource, extracted, refLang, refTexts, classicalMode, tasks),
		OrigLang:      origLang,
		RefLang:       refLang,
		NativeTarget:  nativeTarget,
		SameLanguage:  sameLanguage,
		ClassicalMode: classicalMode,
		Tasks:         tasks,
	}, nil
}

func computeLyricTranslationHash(source string, extracted []lyricTranslationExtracted, refLang string, refTexts []string, classicalMode bool, tasks []lyricTranslationLineTask) string {
	var b strings.Builder
	b.WriteString(source)
	b.WriteByte('\n')
	b.WriteString(refLang)
	if classicalMode {
		b.WriteString("\nclassical")
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
		origNorm := normalizeLyricMatch(line.Text)
		for tag, text := range line.BuiltInByLang {
			tr := collapseLyricSpace(text)
			if tr == "" || tr == "//" || normalizeLyricMatch(tr) == origNorm {
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
		if tr == "" || tr == "//" || normalizeLyricMatch(tr) == normalizeLyricMatch(line.Text) {
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
		norm := normalizeLyricMatch(orig)
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
		norm := normalizeLyricMatch(line.Text)
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

type ttmlKeyedLangPair struct {
	main string
	bg   string
}

// ttmlHeadTranslationsByLang 读取 head 中各语种的 itunes:key 翻译块；返回按归一化语言标签分组的 map
func ttmlHeadTranslationsByLang(root *ttmlNode) map[string]map[string]ttmlKeyedLangPair {
	out := map[string]map[string]ttmlKeyedLangPair{}
	readTextNode := func(tag string, textNode *ttmlNode) {
		key := ttmlAttr(textNode, "for")
		if key == "" {
			return
		}
		if _, ok := out[tag]; !ok {
			out[tag] = map[string]ttmlKeyedLangPair{}
		}
		if _, exists := out[tag][key]; exists {
			return
		}
		var mainBuilder strings.Builder
		var bgText string
		for _, ch := range textNode.children {
			if ch.name == "" {
				mainBuilder.WriteString(ch.text)
				continue
			}
			if ch.name == "span" && ttmlAttr(ch, "role") == "x-bg" {
				if bgText == "" {
					bgText = collapseLyricSpace(ttmlTextWithoutRuby(ch))
				}
				continue
			}
			mainBuilder.WriteString(ttmlTextWithoutRuby(ch))
		}
		mainText := collapseLyricSpace(mainBuilder.String())
		if mainText != "" || bgText != "" {
			out[tag][key] = ttmlKeyedLangPair{main: mainText, bg: bgText}
		}
	}

	walkTTML(root, func(block *ttmlNode) bool {
		if block.name != "translations" {
			return true
		}
		defaultTag := normalizeLyricLangTag(ttmlAttr(block, "lang"))
		walkTTML(block, func(transNode *ttmlNode) bool {
			if transNode.name == "text" {
				tag := normalizeLyricLangTag(ttmlAttr(transNode, "lang"))
				if tag == "" {
					tag = defaultTag
				}
				readTextNode(tag, transNode)
				return false
			}
			if transNode.name != "translation" {
				return true
			}
			tag := normalizeLyricLangTag(ttmlAttr(transNode, "lang"))
			if tag == "" {
				tag = defaultTag
			}
			walkTTML(transNode, func(textNode *ttmlNode) bool {
				if textNode.name != "text" {
					return true
				}
				readTextNode(tag, textNode)
				return false
			})
			return false
		})
		return false
	})
	return out
}

func ttmlTextWithoutRuby(node *ttmlNode) string {
	if node.name == "" {
		return node.text
	}
	ruby := ttmlAttr(node, "ruby")
	if ruby == "text" || ruby == "textContainer" || ruby == "delimiter" {
		return ""
	}
	var b strings.Builder
	for _, ch := range node.children {
		b.WriteString(ttmlTextWithoutRuby(ch))
	}
	return b.String()
}

type ttmlParsedRichLine struct {
	text       string
	start, end int64
	hasTiming  bool
	inlineTr   map[string]string
	bg         *ttmlParsedRichLine
	bgFirst    bool
}

func readTTMLRichLine(p *ttmlNode) ttmlParsedRichLine {
	var res ttmlParsedRichLine
	var buf strings.Builder
	res.start, res.end = int64(math.MaxInt64), -1
	bgSeen := false
	hasMainContent := false

	appendWordText := func(s string) {
		if s == "" {
			return
		}
		if strings.TrimSpace(s) == "" {
			if buf.Len() > 0 {
				buf.WriteByte(' ')
			}
			return
		}
		buf.WriteString(s)
		hasMainContent = true
	}

	var collectChild func(node *ttmlNode)
	collectChild = func(node *ttmlNode) {
		if node.name == "" {
			appendWordText(node.text)
			return
		}
		if node.name != "span" {
			for _, ch := range node.children {
				collectChild(ch)
			}
			return
		}
		ruby := ttmlAttr(node, "ruby")
		if ruby == "text" || ruby == "textContainer" || ruby == "delimiter" {
			return
		}
		switch ttmlAttr(node, "role") {
		case "x-translation":
			trText := collapseLyricSpace(ttmlTextWithoutRuby(node))
			if trText != "" {
				tag := normalizeLyricLangTag(ttmlAttr(node, "lang"))
				if res.inlineTr == nil {
					res.inlineTr = map[string]string{}
				}
				if _, exists := res.inlineTr[tag]; !exists {
					res.inlineTr[tag] = trText
				}
			}
			return
		case "x-roman":
			return
		case "x-bg":
			if res.bg == nil {
				if !hasMainContent && !bgSeen {
					res.bgFirst = true
				}
				bgSeen = true
				parsedBg := readTTMLRichLine(node)
				res.bg = &parsedBg
			}
			return
		}
		if st, stOK := parseTTMLTime(ttmlAttr(node, "begin")); stOK {
			if ed, edOK := parseTTMLTime(ttmlAttr(node, "end")); edOK {
				if !(st == 0 && ed == 0) {
					res.hasTiming = true
					res.start = min(res.start, st)
					res.end = max(res.end, max(st, ed))
				}
			}
		}
		txt := ttmlTextWithoutRuby(node)
		if strings.TrimSpace(txt) != "" {
			buf.WriteString(txt)
			hasMainContent = true
		}
	}

	for _, ch := range p.children {
		collectChild(ch)
	}
	res.text = collapseLyricSpace(buf.String())
	if runes := []rune(res.text); len(runes) > lyricTranslationMaxLineRunes {
		res.text = string(runes[:lyricTranslationMaxLineRunes])
	}
	return res
}

// parseTTMLTranslationLines 解析 TTML 并拆出与前端 parse-ttml.ts 一致的主唱行与 x-bg 背景行（含仅 bg 提升为主唱及多语种翻译提取）
func parseTTMLTranslationLines(raw string) []lyricTranslationExtracted {
	root := parseTTMLTree(raw)
	if root == nil {
		return nil
	}
	headByLang := ttmlHeadTranslationsByLang(root)
	var out []lyricTranslationExtracted

	walkTTML(root, func(p *ttmlNode) bool {
		if p.name != "p" {
			return true
		}
		pBegin, pBeginOK := parseTTMLTime(ttmlAttr(p, "begin"))
		_, pEndOK := parseTTMLTime(ttmlAttr(p, "end"))
		rich := readTTMLRichLine(p)
		if !pBeginOK && rich.hasTiming {
			pBegin, pBeginOK = rich.start, true
		}
		if !pEndOK && rich.hasTiming && rich.end >= 0 {
			pEndOK = true
		}
		if !pBeginOK || !pEndOK {
			return false
		}
		mainStart := pBegin
		if rich.hasTiming && rich.start < math.MaxInt64 {
			mainStart = rich.start
		}

		key := ttmlAttr(p, "key")
		mainBuiltIn := map[string]string{}
		for tag, text := range rich.inlineTr {
			mainBuiltIn[tag] = text
		}
		bgBuiltIn := map[string]string{}
		if rich.bg != nil {
			for tag, text := range rich.bg.inlineTr {
				bgBuiltIn[tag] = text
			}
		}
		if key != "" {
			for tag, keyed := range headByLang {
				if pair, ok := keyed[key]; ok {
					if pair.main != "" && mainBuiltIn[tag] == "" {
						mainBuiltIn[tag] = pair.main
					}
					if pair.bg != "" && bgBuiltIn[tag] == "" {
						bgBuiltIn[tag] = pair.bg
					}
				}
			}
		}

		hasMain := rich.text != ""
		hasBg := rich.bg != nil && rich.bg.text != ""
		if !hasMain && !hasBg {
			return false
		}
		if !hasMain && hasBg {
			// 纯背景人声段落提升为主唱行（与前端 parse-ttml.ts promotedBg 一致）
			bgStart := pBegin
			if rich.bg.hasTiming && rich.bg.start < math.MaxInt64 {
				bgStart = rich.bg.start
			}
			out = append(out, lyricTranslationExtracted{
				Start:         bgStart,
				Text:          rich.bg.text,
				Bg:            false,
				BuiltInByLang: bgBuiltIn,
			})
			return false
		}

		mainItem := lyricTranslationExtracted{
			Start:         mainStart,
			Text:          rich.text,
			Bg:            false,
			BuiltInByLang: mainBuiltIn,
		}
		if !hasBg {
			out = append(out, mainItem)
			return false
		}
		bgStart := pBegin
		if rich.bg.hasTiming && rich.bg.start < math.MaxInt64 {
			bgStart = rich.bg.start
		}
		bgItem := lyricTranslationExtracted{
			Start:         bgStart,
			Text:          rich.bg.text,
			Bg:            true,
			BuiltInByLang: bgBuiltIn,
		}
		if rich.bgFirst && bgStart <= mainStart {
			out = append(out, bgItem, mainItem)
		} else {
			out = append(out, mainItem, bgItem)
		}
		return false
	})

	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}
