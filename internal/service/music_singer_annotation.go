package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
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

// 歌词多声部 / 歌手分配独立服务（脱离特效开关与逐字限制，支持所有词源与全部曲目）：
// - TTML 显式声明了多声部且均具名时，零开销确定性生成并按需翻译歌手名
// - 多歌手歌曲、未具名 TTML 声部或带行内 "男：/女：/歌手名：" 提示的歌词走 AI 归属分析（结合热评上下文）
// - 各目标语言下的歌手译名增量缓存在 Translations JSON 中，严格遵循「官方译名优先，无公认译名时才音译」

const (
	lyricSingerTimeout             = 60 * time.Second
	lyricSingerJobTTL              = 2 * time.Minute
	lyricSingerRetryAfter          = 5 * time.Minute
	lyricSingerNameTransTimeout    = 30 * time.Second
	lyricSingerNameTransJobTTL     = time.Minute
	lyricSingerNameTransRetryAfter = 5 * time.Minute
	lyricSingerTemperature         = 0.2
	lyricSingerReasoning           = "none"
	lyricSingerWriteLockTTL        = 20 * time.Second
)

var lyricSingerDefaultColors = []string{"ocean", "cherry-blossom", "gold", "mint", "lavender", "coral"}

type lyricSingerService struct {
	name              string
	initOnce          sync.Once
	mu                sync.Mutex
	limiter           *llmclient.Limiter
	complete          func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	translateComplete func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	hotComments       func(ctx context.Context, id int64) []lyricAnnotationComment
	concurrency       func() int
	done              func()
}

var lyricSingers = &lyricSingerService{
	name:    "lyric_singer_annotation",
	limiter: llmclient.DefaultLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricSingerTemperature, lyricSingerReasoning)
	},
	translateComplete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, songTranslationTemperature, songTranslationReasoning)
	},
	hotComments: fetchNCMHotComments,
	concurrency: tools.GetAISummaryConcurrency,
}

type lyricSingerDeclaredAgent struct {
	ID      string
	Name    string
	Role    string // "person" | "group"
	IsGroup bool
}

type lyricSingerExtractedLine struct {
	Text       string
	Occurrence int
	Bg         bool
	RawAgent   string
	HasCue     bool
	IsNonVocal bool
}

type lyricSingerLineTask struct {
	Index      int // 1-based，对应模型输入/输出的 i
	Text       string
	Occurrence int
	Bg         bool
	RawAgent   string
}

type lyricSingerInput struct {
	Track         *dto.MusicTrackDto
	Source        string
	LyricHash     string
	IsTTML        bool
	Agents        []lyricSingerDeclaredAgent
	Lines         []lyricSingerExtractedLine
	Tasks         []lyricSingerLineTask
	HasInlineCue  bool
	MultiAgentSys bool // TTML 是否存在 >=2 独唱或群组声部
	ArtistHints   [][]string
}

type lyricSingerAIResp struct {
	Empty   bool `json:"empty"`
	Singers []struct {
		ID      string   `json:"id"`
		Name    string   `json:"name"`
		Role    string   `json:"role"`
		Color   string   `json:"color"`
		Align   string   `json:"align"`
		Members []string `json:"members"`
	} `json:"singers"`
	Lines []struct {
		Index int    `json:"i"`
		Agent string `json:"agent"`
	} `json:"lines"`
}

// GetLyricSingers 获取指定词源下的独立歌手分配及目标语言下的译名；尚未生成时开启后台任务并返回 pending
func (s *MusicService) GetLyricSingers(ctx context.Context, id int64, source, lang string) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
	targetLang, track, svcerr := s.prepareLyricSingerAccess(ctx, id, source, lang)
	if svcerr != nil {
		return nil, svcerr
	}
	resolvedSource, pendingDto, svcerr := s.resolveLyricSingerSource(ctx, id, source)
	if svcerr != nil {
		return nil, svcerr
	}
	if pendingDto != nil {
		return pendingDto, nil
	}
	input, svcerr := s.extractLyricSingerInput(ctx, track, resolvedSource)
	if svcerr != nil {
		return nil, svcerr
	}
	return lyricSingers.getOrStart(input, targetLang)
}

// RefreshLyricSingers 管理员手动重新生成指定词源的歌手分配与目标语言下的歌手译名
func (s *MusicService) RefreshLyricSingers(ctx context.Context, id int64, source, lang string) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
	targetLang, track, svcerr := s.prepareLyricSingerAccess(ctx, id, source, lang)
	if svcerr != nil {
		return nil, svcerr
	}
	resolvedSource, pendingDto, svcerr := s.resolveLyricSingerSource(ctx, id, source)
	if svcerr != nil {
		return nil, svcerr
	}
	if pendingDto != nil {
		return pendingDto, nil
	}
	input, svcerr := s.extractLyricSingerInput(ctx, track, resolvedSource)
	if svcerr != nil {
		return nil, svcerr
	}
	return lyricSingers.refresh(input, targetLang)
}

func (s *MusicService) prepareLyricSingerAccess(ctx context.Context, id int64, source, lang string) (string, *dto.MusicTrackDto, *errs.ServiceError) {
	targetLang := ""
	if strings.TrimSpace(lang) != "" {
		targetLang = normalizeLyricLangTag(lang)
		if lyricTranslateLanguages[targetLang] == "" {
			return "", nil, errs.NewBadRequest("invalid_request_parameters")
		}
	}
	if id <= 0 || (source != "" && !lyricSettingSources[source]) {
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
		return "", nil, errs.NewNotFound("lyric_annotations_unavailable")
	}
	return targetLang, track, nil
}

func (s *MusicService) resolveLyricSingerSource(ctx context.Context, id int64, source string) (string, *dto.MusicLyricSingersDto, *errs.ServiceError) {
	if source != "" {
		return source, nil, nil
	}
	version, svcerr := s.siteLyricVersion(withLyricVersionWait(ctx, lyricVersionPollWait), id)
	if svcerr != nil {
		if svcerr == errLyricVersionPending {
			return "", &dto.MusicLyricSingersDto{
				Status:  lyricTranslationStatusPending,
				Singers: []dto.LyricSingerItem{},
				Lines:   []dto.LyricSingerLine{},
			}, nil
		}
		return "", nil, svcerr
	}
	if version == nil || version.Lines == nil {
		return "", nil, errs.NewNotFound("lyric_not_found")
	}
	return version.Lines.Source, nil, nil
}

func (s *MusicService) extractLyricSingerInput(ctx context.Context, track *dto.MusicTrackDto, resolvedSource string) (*lyricSingerInput, *errs.ServiceError) {
	snapshot := s.snapshotForKind(ctx, track.ID, resolvedSource)
	var (
		lines  []lyricSingerExtractedLine
		agents []lyricSingerDeclaredAgent
		isTTML bool
	)
	if resolvedSource == "ttml-amll" || resolvedSource == "ttml-custom" {
		rawTTML := s.resolveRawTTMLForSource(ctx, track.ID, resolvedSource, snapshot)
		if rawTTML == "" {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		lines, agents = parseTTMLSingerLines(rawTTML)
		isTTML = true
	} else {
		extracted, svcerr := s.extractSourceLines(ctx, track.ID, resolvedSource, snapshot)
		if svcerr != nil {
			return nil, svcerr
		}
		texts := make([]string, len(extracted))
		for i, item := range extracted {
			texts[i] = item.Text
		}
		head, tail := lyricCreditRange(texts, track.Name, track.Artists)
		extracted = extracted[head:tail]
		lines = make([]lyricSingerExtractedLine, len(extracted))
		for i, item := range extracted {
			lines[i] = lyricSingerExtractedLine{Text: item.Text, Bg: item.Bg}
		}
	}
	if len(lines) == 0 {
		return nil, errs.NewNotFound("lyric_not_found")
	}

	type occKey struct {
		bg   bool
		norm string
	}
	occCounts := make(map[occKey]int, len(lines))
	tasks := make([]lyricSingerLineTask, 0, len(lines))
	hasInlineCue := false
	usedSolo := map[string]bool{}
	usedGroup := false
	groupIDs := map[string]bool{}
	for _, ag := range agents {
		if ag.IsGroup {
			groupIDs[ag.ID] = true
		}
	}

	var hashBuilder strings.Builder
	hashBuilder.WriteString(resolvedSource)
	for i := range lines {
		line := &lines[i]
		key := occKey{bg: line.Bg, norm: normalizeLyricMatch(line.Text)}
		line.Occurrence = occCounts[key]
		occCounts[key] = line.Occurrence + 1

		hashBuilder.WriteByte('\n')
		if line.Bg {
			hashBuilder.WriteString("bg:")
		}
		hashBuilder.WriteString(line.Text)
		if line.RawAgent != "" {
			hashBuilder.WriteByte('|')
			hashBuilder.WriteString(line.RawAgent)
		}

		trimmed := strings.TrimSpace(line.Text)
		if isNonLyricCueLine(trimmed) {
			line.IsNonVocal = true
			continue
		}
		if prefix, rest, ok := cutLeadingColon(trimmed, 24); ok && !isLyricCreditText(trimmed) && isSingerCuePrefix(prefix, track.Artists) {
			line.HasCue = true
			hasInlineCue = true
			if isNonLyricCueLine(rest) {
				line.IsNonVocal = true
				continue
			}
		}
		for _, id := range strings.Fields(line.RawAgent) {
			if groupIDs[id] || isConventionalTTMLGroupID(id) {
				usedGroup = true
			} else {
				usedSolo[id] = true
			}
		}
		if len(strings.Fields(line.RawAgent)) > 1 {
			usedGroup = true
		}
		tasks = append(tasks, lyricSingerLineTask{
			Index:      len(tasks) + 1,
			Text:       trimmed,
			Occurrence: line.Occurrence,
			Bg:         line.Bg,
			RawAgent:   line.RawAgent,
		})
	}

	sum := sha256.Sum256([]byte(hashBuilder.String()))
	lyricHash := hex.EncodeToString(sum[:])
	hints := loadSongHints(track.ID)
	multiAgentSys := isTTML && (len(usedSolo) >= 2 || (usedGroup && len(usedSolo) >= 1))

	return &lyricSingerInput{
		Track:         track,
		Source:        resolvedSource,
		LyricHash:     lyricHash,
		IsTTML:        isTTML,
		Agents:        agents,
		Lines:         lines,
		Tasks:         tasks,
		HasInlineCue:  hasInlineCue,
		MultiAgentSys: multiAgentSys,
		ArtistHints:   hints.ArtistHints,
	}, nil
}

func (a *lyricSingerService) prefix() string {
	a.initOnce.Do(func() {
		if a.name == "" {
			a.name = "lyric_singer_" + utils.Strings.GenerateRandomString(8)
		}
	})
	return a.name
}

func (a *lyricSingerService) stateKeys(input *lyricSingerInput) (job, failed string) {
	suffix := fmt.Sprintf("%d:%s:%s", input.Track.ID, input.Source, input.LyricHash)
	return a.prefix() + ":job:" + suffix, a.prefix() + ":failed:" + suffix
}

func (a *lyricSingerService) transStateKeys(input *lyricSingerInput, targetLang string) (job, failed string) {
	suffix := fmt.Sprintf("%d:%s:%s:%s", input.Track.ID, input.Source, input.LyricHash, targetLang)
	return a.prefix() + ":tr_job:" + suffix, a.prefix() + ":tr_failed:" + suffix
}

func (a *lyricSingerService) writeLockKey(input *lyricSingerInput) string {
	return fmt.Sprintf("%s:write:%d:%s:%s", a.prefix(), input.Track.ID, input.Source, input.LyricHash)
}

func (a *lyricSingerService) jobState(jobKey, failedKey string) (running, coolingDown bool) {
	values, err := sharedstate.Current().GetMany(jobKey, failedKey)
	if err != nil {
		return false, false
	}
	_, running = values[jobKey]
	_, coolingDown = values[failedKey]
	return running, coolingDown
}

func (a *lyricSingerService) getOrStart(input *lyricSingerInput, targetLang string) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
	jobKey, failedKey := a.stateKeys(input)
	a.mu.Lock()
	running, coolingDown := a.jobState(jobKey, failedKey)

	var record model.LyricSingerAnnotation
	err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		a.mu.Unlock()
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if err == nil {
		a.mu.Unlock()
		data := parseLyricSingerData(record.Data)
		return a.buildReadyResponse(input, &record, data, targetLang, running, false)
	}

	// Fast Path A: 单人独唱、无多声部 TTML、无行内歌手提示 -> 直接落库空标注，不消耗模型额度
	if isSoloFastPath(input) {
		data := dto.LyricSingerData{Empty: true}
		_ = a.saveData(input, data, "rule:solo")
		a.mu.Unlock()
		return &dto.MusicLyricSingersDto{
			Status:  lyricTranslationStatusReady,
			Source:  input.Source,
			Singers: []dto.LyricSingerItem{},
			Lines:   []dto.LyricSingerLine{},
		}, nil
	}

	// Fast Path B: TTML 多声部且所有独唱声部均已自带 <ttm:name> -> 确定性分配色板与左右居中对齐并落库
	if fastData, ok := buildNamedTTMLSingerData(input); ok {
		rec := a.saveAndLoadData(input, fastData, "ttml:agents")
		a.mu.Unlock()
		if rec == nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
		return a.buildReadyResponse(input, rec, fastData, targetLang, false, false)
	}

	// AI Path
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		a.mu.Unlock()
		return nil, errs.NewNotFound("lyric_annotations_unavailable")
	}
	if running {
		a.mu.Unlock()
		return &dto.MusicLyricSingersDto{
			Status:  lyricTranslationStatusPending,
			Source:  input.Source,
			Singers: []dto.LyricSingerItem{},
			Lines:   []dto.LyricSingerLine{},
		}, nil
	}
	if coolingDown {
		a.mu.Unlock()
		return nil, errs.NewNotFound("lyric_annotations_failed")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		a.mu.Unlock()
		return nil, svcerr
	}
	a.startAttributionLocked(jobKey, failedKey, input, cfg)
	a.mu.Unlock()

	return &dto.MusicLyricSingersDto{
		Status:  lyricTranslationStatusPending,
		Source:  input.Source,
		Singers: []dto.LyricSingerItem{},
		Lines:   []dto.LyricSingerLine{},
	}, nil
}

func (a *lyricSingerService) refresh(input *lyricSingerInput, targetLang string) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
	if isSoloFastPath(input) {
		data := dto.LyricSingerData{Empty: true}
		_ = a.saveData(input, data, "rule:solo")
		return &dto.MusicLyricSingersDto{
			Status:  lyricTranslationStatusReady,
			Source:  input.Source,
			Singers: []dto.LyricSingerItem{},
			Lines:   []dto.LyricSingerLine{},
		}, nil
	}

	if fastData, ok := buildNamedTTMLSingerData(input); ok {
		rec := a.saveAndLoadData(input, fastData, "ttml:agents")
		if rec == nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
		return a.buildReadyResponse(input, rec, fastData, targetLang, false, targetLang != "")
	}

	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_annotations_unavailable")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}

	jobKey, failedKey := a.stateKeys(input)
	a.mu.Lock()
	if running, _ := a.jobState(jobKey, failedKey); !running {
		a.startAttributionLocked(jobKey, failedKey, input, cfg)
	}
	var record model.LyricSingerAnnotation
	err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error
	a.mu.Unlock()

	if err == nil {
		data := parseLyricSingerData(record.Data)
		if targetLang != "" {
			return a.buildReadyResponse(input, &record, data, targetLang, true, true)
		}
		return toLyricSingersDto(input.Source, data, nil, true, false), nil
	}
	return &dto.MusicLyricSingersDto{
		Status:  lyricTranslationStatusPending,
		Source:  input.Source,
		Singers: []dto.LyricSingerItem{},
		Lines:   []dto.LyricSingerLine{},
	}, nil
}

func isSoloFastPath(input *lyricSingerInput) bool {
	if len(input.Tasks) == 0 {
		return true
	}
	if input.MultiAgentSys || input.HasInlineCue {
		return false
	}
	return len(input.Track.Artists) <= 1
}

func buildNamedTTMLSingerData(input *lyricSingerInput) (dto.LyricSingerData, bool) {
	if !input.MultiAgentSys {
		return dto.LyricSingerData{}, false
	}
	declaredMap := make(map[string]lyricSingerDeclaredAgent, len(input.Agents))
	for _, ag := range input.Agents {
		declaredMap[ag.ID] = ag
	}

	soloOrder := make([]string, 0, len(input.Agents))
	soloSeen := map[string]bool{}
	groupCombos := map[string][]string{} // synthetic ID -> members
	var hasGroup bool

	lineAgents := make([]string, len(input.Tasks))
	for idx, task := range input.Tasks {
		ids := strings.Fields(task.RawAgent)
		if len(ids) == 0 {
			continue
		}
		var solos []string
		var hasGroupTag bool
		for _, id := range ids {
			if ag, ok := declaredMap[id]; ok && ag.IsGroup || isConventionalTTMLGroupID(id) {
				hasGroupTag = true
			} else {
				solos = append(solos, id)
				if !soloSeen[id] {
					soloSeen[id] = true
					soloOrder = append(soloOrder, id)
				}
			}
		}
		if hasGroupTag || len(solos) > 1 {
			hasGroup = true
			if len(solos) > 1 {
				comboID := strings.Join(solos, "+")
				groupCombos[comboID] = solos
				lineAgents[idx] = comboID
			} else {
				lineAgents[idx] = lyricSingerTogether
			}
		} else if len(solos) == 1 {
			lineAgents[idx] = solos[0]
		}
	}

	if len(soloOrder) < 2 && !(hasGroup && len(soloOrder) >= 1) {
		return dto.LyricSingerData{}, false
	}
	// 所有独唱声部均必须显式具名，才走免 AI 的确定性路径；否则走 AI 推断真实歌手名
	for _, id := range soloOrder {
		if ag, ok := declaredMap[id]; !ok || strings.TrimSpace(ag.Name) == "" {
			return dto.LyricSingerData{}, false
		}
	}

	defaultSolo := ""
	if len(soloOrder) > 0 {
		defaultSolo = soloOrder[0]
	}

	singers := make([]dto.LyricSingerItem, 0, len(soloOrder)+len(groupCombos)+1)
	for i, id := range soloOrder {
		align := "left"
		if i > 0 {
			if len(soloOrder) == 2 || i%2 == 1 {
				align = "right"
			}
		}
		singers = append(singers, dto.LyricSingerItem{
			ID:    id,
			Name:  sanitizeLyricSingerName(declaredMap[id].Name),
			Role:  "person",
			Color: lyricSingerDefaultColors[i%len(lyricSingerDefaultColors)],
			Align: align,
		})
	}

	comboKeys := make([]string, 0, len(groupCombos))
	for cid := range groupCombos {
		comboKeys = append(comboKeys, cid)
	}
	sort.Strings(comboKeys)
	for idx, cid := range comboKeys {
		members := groupCombos[cid]
		names := make([]string, 0, len(members))
		for _, m := range members {
			if name := sanitizeLyricSingerName(declaredMap[m].Name); name != "" {
				names = append(names, name)
			}
		}
		label := "合唱"
		if len(names) > 0 {
			label = strings.Join(names, " / ")
		}
		singers = append(singers, dto.LyricSingerItem{
			ID:      cid,
			Name:    label,
			Role:    "group",
			Color:   lyricSingerDefaultColors[(len(soloOrder)+idx)%len(lyricSingerDefaultColors)],
			Align:   "center",
			Members: members,
		})
	}

	usedTogether := false
	lines := make([]dto.LyricSingerLine, 0, len(input.Tasks))
	for idx, task := range input.Tasks {
		agent := lineAgents[idx]
		if agent == "" {
			agent = defaultSolo
		}
		if agent == lyricSingerTogether {
			usedTogether = true
		}
		if agent == "" {
			continue
		}
		lines = append(lines, dto.LyricSingerLine{
			Text:       task.Text,
			Occurrence: task.Occurrence,
			Bg:         task.Bg,
			Agent:      agent,
		})
	}
	if usedTogether {
		label := "合唱"
		for _, ag := range input.Agents {
			if ag.IsGroup && ag.Name != "" {
				label = sanitizeLyricSingerName(ag.Name)
				break
			}
		}
		singers = append(singers, dto.LyricSingerItem{
			ID:      lyricSingerTogether,
			Name:    label,
			Role:    "group",
			Color:   lyricSingerDefaultColors[(len(soloOrder)+len(comboKeys))%len(lyricSingerDefaultColors)],
			Align:   "center",
			Members: soloOrder,
		})
	}
	if len(singers) == 0 || len(lines) == 0 {
		return dto.LyricSingerData{Empty: true}, true
	}
	return dto.LyricSingerData{Singers: singers, Lines: lines}, true
}

func (a *lyricSingerService) buildReadyResponse(
	input *lyricSingerInput,
	record *model.LyricSingerAnnotation,
	data dto.LyricSingerData,
	targetLang string,
	stale bool,
	forceTransRefresh bool,
) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
	if data.Empty || len(data.Singers) == 0 || targetLang == "" {
		return toLyricSingersDto(input.Source, data, nil, stale, false), nil
	}

	translations := parseSingerTranslationsMap(record.Translations)
	if !forceTransRefresh {
		if existing, ok := translations[targetLang]; ok {
			return toLyricSingersDto(input.Source, data, existing, stale, false), nil
		}
	}

	// 先复用确定性标签翻译（合唱 / 男 / 女）与已生成的 SongMetaTranslation 歌手译名
	cachedSongArtists := loadCachedSongArtistTranslationMap(input.Track, targetLang)
	deterministic := make(map[string]string)
	var needAI []dto.LyricSingerItem
	for _, singer := range data.Singers {
		if generic := translateGenericSingerRole(singer.Name, targetLang); generic != "" {
			if !strings.EqualFold(generic, singer.Name) {
				deterministic[singer.ID] = generic
			}
			continue
		}
		if tr, found := cachedSongArtists[normalizeLyricMatch(singer.Name)]; found {
			if tr != "" && !strings.EqualFold(tr, singer.Name) {
				deterministic[singer.ID] = tr
			}
			continue
		}
		if songMetaAlreadyInTargetLang("", []string{singer.Name}, targetLang) {
			continue
		}
		needAI = append(needAI, singer)
	}

	if len(needAI) == 0 {
		if err := a.saveTranslatedNames(input, targetLang, deterministic); err != nil {
			logrus.Warnf("save deterministic singer translations for song %d: %v", input.Track.ID, err)
		}
		return toLyricSingersDto(input.Source, data, deterministic, stale, false), nil
	}

	cfg := tools.GetAIConfig()
	if !cfg.Configured() || checkSiteAIBudget(time.Now()) != nil {
		return toLyricSingersDto(input.Source, data, deterministic, stale, false), nil
	}

	jobKey, failedKey := a.transStateKeys(input, targetLang)
	a.mu.Lock()
	running, coolingDown := a.jobState(jobKey, failedKey)
	if !running && (!coolingDown || forceTransRefresh) {
		a.startTranslationLocked(jobKey, failedKey, input, targetLang, needAI, deterministic, cfg)
		running = true
	}
	a.mu.Unlock()

	return toLyricSingersDto(input.Source, data, deterministic, stale, running), nil
}

func toLyricSingersDto(source string, data dto.LyricSingerData, translatedNames map[string]string, stale, transPending bool) *dto.MusicLyricSingersDto {
	singers := data.Singers
	if singers == nil {
		singers = []dto.LyricSingerItem{}
	}
	lines := data.Lines
	if lines == nil {
		lines = []dto.LyricSingerLine{}
	}
	if data.Empty {
		singers = []dto.LyricSingerItem{}
		lines = []dto.LyricSingerLine{}
	}
	return &dto.MusicLyricSingersDto{
		Status:             lyricTranslationStatusReady,
		Stale:              stale,
		TranslationPending: transPending,
		Source:             source,
		Singers:            singers,
		TranslatedNames:    translatedNames,
		Lines:              lines,
	}
}

func (a *lyricSingerService) startAttributionLocked(jobKey, failedKey string, input *lyricSingerInput, cfg tools.AIConfig) {
	lease, err := sharedstate.AcquireLease(jobKey, lyricSingerJobTTL)
	if err != nil || lease == nil {
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	go a.executeAttribution(lease, failedKey, input, cfg)
}

func (a *lyricSingerService) executeAttribution(lease *sharedstate.Lease, failedKey string, input *lyricSingerInput, cfg tools.AIConfig) {
	var jobErr error
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("lyric singer attribution panic for song %d (%s): %v", input.Track.ID, input.Source, r)
			jobErr = fmt.Errorf("panic: %v", r)
		}
		if jobErr != nil {
			_ = sharedstate.Current().Set(failedKey, "1", lyricSingerRetryAfter)
		}
		lease.Release()
		if a.done != nil {
			a.done()
		}
	}()

	var comments []lyricAnnotationComment
	if a.hotComments != nil {
		cctx, ccancel := context.WithTimeout(context.Background(), 10*time.Second)
		comments = a.hotComments(cctx, input.Track.ID)
		ccancel()
	}

	data, err := a.generateAttribution(cfg, input, comments)
	if err != nil {
		logrus.Warnf("lyric singer attribution failed for song %d (%s): %v", input.Track.ID, input.Source, err)
		jobErr = err
		return
	}
	if dbErr := a.saveData(input, data, cfg.Model); dbErr != nil {
		logrus.Errorf("save lyric singer attribution failed for song %d (%s): %v", input.Track.ID, input.Source, dbErr)
		jobErr = dbErr
	}
}

func (a *lyricSingerService) generateAttribution(cfg tools.AIConfig, input *lyricSingerInput, comments []lyricAnnotationComment) (dto.LyricSingerData, error) {
	_ = a.limiter.AcquireTier(context.Background(), a.concurrency, llmclient.TierBackground, nil)
	defer a.limiter.Release()

	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeLyricAnnotation, 0), lyricSingerTimeout)
	defer cancel()

	system := buildLyricSingerAttributionSystemPrompt()
	user := buildLyricSingerAttributionUserPrompt(input, comments)
	raw, err := a.complete(ctx, cfg, system, user)
	if err != nil {
		return dto.LyricSingerData{}, err
	}
	return parseAndSanitizeLyricSingerAIResp(raw, input.Tasks)
}

func buildLyricSingerAttributionSystemPrompt() string {
	var colorNames []string
	for _, c := range lyricAnnotationPalette {
		colorNames = append(colorNames, c.Key)
	}
	var b strings.Builder
	b.WriteString("You analyze music lyrics and assign each vocal line to its singer or chorus group.\n\n")
	b.WriteString("RULES:\n")
	b.WriteString("1. Decide first if the song actually has multiple distinct vocalists/parts (duet, featuring, choir, male/female dialogue, or distinct TTML agents). If it is purely solo or indistinguishable, return {\"empty\":true}.\n")
	b.WriteString("2. SINGER NAMING PRINCIPLE: Use real official/credited singer names from `artists`, `artist_hints`, `hot_comments`, or inline prefixes (e.g. `周杰伦`, `张惠妹`). NEVER fabricate person names; for generic unnamed labels use concise role names (`男`, `女`, `合唱`).\n")
	b.WriteString("3. Assign each singer/group:\n")
	b.WriteString("   - `id`: short ASCII ID matching `[A-Za-z0-9_.:+-]{1,32}` (reuse TTML agent tags like `v1`, `v2`, `together` when present in input lines).\n")
	b.WriteString("   - `name`: clean display name (<= 32 runes).\n")
	b.WriteString("   - `role`: \"person\" for solo vocalist or \"group\" for chorus/duet together.\n")
	b.WriteString(fmt.Sprintf("   - `color`: MUST be chosen strictly from this palette: %s.\n", strings.Join(colorNames, ", ")))
	b.WriteString("   - `align`: \"left\" (lead/first vocalist), \"right\" (duet partner/second vocalist), or \"center\" (group/chorus).\n")
	b.WriteString("   - `members`: for role=\"group\", array of member `id`s if known.\n")
	b.WriteString("4. Output every line index `i` (1-based) paired with its `agent` ID in `lines`.\n")
	b.WriteString("5. Output strictly ONE valid JSON object: {\"empty\":false,\"singers\":[{\"id\":\"v1\",\"name\":\"...\",\"role\":\"person\",\"color\":\"ocean\",\"align\":\"left\"}],\"lines\":[{\"i\":1,\"agent\":\"v1\"}]}. No markdown fences.\n")
	return b.String()
}

func buildLyricSingerAttributionUserPrompt(input *lyricSingerInput, comments []lyricAnnotationComment) string {
	type promptLine struct {
		I     int    `json:"i"`
		Text  string `json:"text"`
		Bg    bool   `json:"bg,omitempty"`
		Agent string `json:"ttml_agent,omitempty"`
	}
	lines := make([]promptLine, len(input.Tasks))
	for idx, task := range input.Tasks {
		lines[idx] = promptLine{
			I:     task.Index,
			Text:  task.Text,
			Bg:    task.Bg,
			Agent: task.RawAgent,
		}
	}
	commentTexts := make([]string, 0, min(len(comments), 5))
	for i := 0; i < len(comments) && i < 5; i++ {
		if c := strings.TrimSpace(comments[i].Content); c != "" {
			commentTexts = append(commentTexts, c)
		}
	}
	payload := struct {
		Title       string       `json:"title"`
		Artists     []string     `json:"artists"`
		ArtistHints [][]string   `json:"artist_hints,omitempty"`
		Album       string       `json:"album,omitempty"`
		Comments    []string     `json:"hot_comments,omitempty"`
		Lines       []promptLine `json:"lines"`
	}{
		Title:       input.Track.Name,
		Artists:     input.Track.Artists,
		ArtistHints: input.ArtistHints,
		Album:       input.Track.Album,
		Comments:    commentTexts,
		Lines:       lines,
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func parseAndSanitizeLyricSingerAIResp(raw string, tasks []lyricSingerLineTask) (dto.LyricSingerData, error) {
	obj, err := extractJSONObject(raw)
	if err != nil {
		return dto.LyricSingerData{}, err
	}
	var parsed lyricSingerAIResp
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return dto.LyricSingerData{}, err
	}
	if parsed.Empty {
		return dto.LyricSingerData{Empty: true}, nil
	}

	taskMap := make(map[int]lyricSingerLineTask, len(tasks))
	for _, t := range tasks {
		taskMap[t.Index] = t
	}

	validSingers := make([]dto.LyricSingerItem, 0, len(parsed.Singers))
	singerSeen := map[string]bool{}
	for idx, item := range parsed.Singers {
		id := strings.TrimSpace(item.ID)
		if !lyricSingerIDPattern.MatchString(id) || singerSeen[id] {
			continue
		}
		name := sanitizeLyricSingerName(item.Name)
		if name == "" {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(item.Role))
		if role != "group" {
			role = "person"
		}
		color := normalizeLyricColor(strings.TrimSpace(item.Color))
		if color == "" {
			color = lyricSingerDefaultColors[idx%len(lyricSingerDefaultColors)]
		}
		align := strings.ToLower(strings.TrimSpace(item.Align))
		if align != "left" && align != "right" && align != "center" {
			switch {
			case role == "group":
				align = "center"
			case len(validSingers)%2 == 1:
				align = "right"
			default:
				align = "left"
			}
		}
		singerSeen[id] = true
		validSingers = append(validSingers, dto.LyricSingerItem{
			ID:      id,
			Name:    name,
			Role:    role,
			Color:   color,
			Align:   align,
			Members: item.Members,
		})
	}
	if len(validSingers) == 0 {
		return dto.LyricSingerData{Empty: true}, nil
	}

	// 清洗组合成员引用，仅保留存在的 ID
	for i := range validSingers {
		if len(validSingers[i].Members) == 0 {
			continue
		}
		var cleaned []string
		for _, m := range validSingers[i].Members {
			if singerSeen[m] && m != validSingers[i].ID {
				cleaned = append(cleaned, m)
			}
		}
		validSingers[i].Members = cleaned
	}

	keptLines := make([]dto.LyricSingerLine, 0, len(parsed.Lines))
	lineSeen := map[int]bool{}
	for _, item := range parsed.Lines {
		if lineSeen[item.Index] {
			continue
		}
		task, ok := taskMap[item.Index]
		if !ok || !singerSeen[strings.TrimSpace(item.Agent)] {
			continue
		}
		lineSeen[item.Index] = true
		keptLines = append(keptLines, dto.LyricSingerLine{
			Text:       task.Text,
			Occurrence: task.Occurrence,
			Bg:         task.Bg,
			Agent:      strings.TrimSpace(item.Agent),
		})
	}
	if len(keptLines) == 0 {
		return dto.LyricSingerData{Empty: true}, nil
	}
	return dto.LyricSingerData{
		Singers: validSingers,
		Lines:   keptLines,
	}, nil
}

func (a *lyricSingerService) saveData(input *lyricSingerInput, data dto.LyricSingerData, modelName string) error {
	ctx, cancel := context.WithTimeout(context.Background(), lyricSingerWriteLockTTL)
	defer cancel()
	release, err := sharedstate.Lock(ctx, a.writeLockKey(input), lyricSingerWriteLockTTL)
	if err != nil {
		return err
	}
	defer release()

	encoded, _ := json.Marshal(data)
	record := &model.LyricSingerAnnotation{
		SongID:       input.Track.ID,
		Source:       input.Source,
		LyricHash:    input.LyricHash,
		Data:         string(encoded),
		Translations: "{}",
		Model:        modelName,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "source"}, {Name: "lyric_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"data", "translations", "model", "updated_at"}),
	}
	return repo.GetDB().Clauses(upsert).Create(record).Error
}

func (a *lyricSingerService) saveAndLoadData(input *lyricSingerInput, data dto.LyricSingerData, modelName string) *model.LyricSingerAnnotation {
	if err := a.saveData(input, data, modelName); err != nil {
		logrus.Errorf("save lyric singer annotation for song %d (%s): %v", input.Track.ID, input.Source, err)
		return nil
	}
	var record model.LyricSingerAnnotation
	if err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error; err != nil {
		return nil
	}
	return &record
}

func (a *lyricSingerService) startTranslationLocked(
	jobKey, failedKey string,
	input *lyricSingerInput,
	targetLang string,
	needAI []dto.LyricSingerItem,
	deterministic map[string]string,
	cfg tools.AIConfig,
) {
	lease, err := sharedstate.AcquireLease(jobKey, lyricSingerNameTransJobTTL)
	if err != nil || lease == nil {
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	go a.executeTranslation(lease, failedKey, input, targetLang, needAI, deterministic, cfg)
}

func (a *lyricSingerService) executeTranslation(
	lease *sharedstate.Lease,
	failedKey string,
	input *lyricSingerInput,
	targetLang string,
	needAI []dto.LyricSingerItem,
	deterministic map[string]string,
	cfg tools.AIConfig,
) {
	var jobErr error
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("singer name translation panic for song %d (%s): %v", input.Track.ID, targetLang, r)
			jobErr = fmt.Errorf("panic: %v", r)
		}
		if jobErr != nil {
			_ = sharedstate.Current().Set(failedKey, "1", lyricSingerNameTransRetryAfter)
		}
		lease.Release()
		if a.done != nil {
			a.done()
		}
	}()

	translated, err := a.generateSingerTranslations(cfg, input, targetLang, needAI)
	if err != nil {
		logrus.Warnf("singer name translation failed for song %d (%s): %v", input.Track.ID, targetLang, err)
		jobErr = err
		return
	}
	merged := make(map[string]string, len(deterministic)+len(translated))
	for k, v := range deterministic {
		if v != "" {
			merged[k] = v
		}
	}
	for k, v := range translated {
		if v != "" {
			merged[k] = v
		}
	}
	if err := a.saveTranslatedNames(input, targetLang, merged); err != nil {
		logrus.Errorf("save singer translations for song %d (%s): %v", input.Track.ID, targetLang, err)
		jobErr = err
	}
}

func (a *lyricSingerService) generateSingerTranslations(
	cfg tools.AIConfig,
	input *lyricSingerInput,
	targetLang string,
	needAI []dto.LyricSingerItem,
) (map[string]string, error) {
	_ = a.limiter.AcquireTier(context.Background(), a.concurrency, llmclient.TierFirstScreen, nil)
	defer a.limiter.Release()

	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeTranslation, 0), lyricSingerNameTransTimeout)
	defer cancel()

	targetDesc := lyricTranslateLanguages[targetLang]
	var sys strings.Builder
	sys.WriteString("You localize lyric singer names strictly according to established naming conventions.\n")
	sys.WriteString(fmt.Sprintf("Target language: %s (code: %s).\n\n", targetDesc, targetLang))
	sys.WriteString("STRICT NAMING PRINCIPLE:\n")
	sys.WriteString("1. NEVER invent or fabricate literal translations for artist/character names!\n")
	sys.WriteString("2. Use established/officially recognized names in target_lang first (including regional zh-tw / zh-hk conventions).\n")
	sys.WriteString("3. If an artist is canonically referred to by their original name in target_lang (e.g. Aimer, YOASOBI), return \"\" for that ID.\n")
	sys.WriteString("4. Only phonetically transliterate into target_lang's script when in a foreign script and no official name exists.\n")
	sys.WriteString("5. For Chinese <-> zh-tw / zh-hk, convert orthography accurately or return \"\" if identical.\n")
	sys.WriteString("6. Output strictly one JSON object: {\"names\":{\"<id>\":\"<translated or empty string>\"}}. No markdown fences.\n")

	type singerPayloadItem struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	items := make([]singerPayloadItem, len(needAI))
	for i, s := range needAI {
		items[i] = singerPayloadItem{ID: s.ID, Name: s.Name}
	}
	userPayload := struct {
		TargetLang  string              `json:"target_lang"`
		Title       string              `json:"title"`
		Artists     []string            `json:"artists,omitempty"`
		ArtistHints [][]string          `json:"artist_hints,omitempty"`
		Singers     []singerPayloadItem `json:"singers"`
	}{
		TargetLang:  fmt.Sprintf("%s (%s)", targetLang, targetDesc),
		Title:       input.Track.Name,
		Artists:     input.Track.Artists,
		ArtistHints: input.ArtistHints,
		Singers:     items,
	}
	userRaw, _ := json.Marshal(userPayload)

	fn := a.translateComplete
	if fn == nil {
		fn = a.complete
	}
	raw, err := fn(ctx, cfg, sys.String(), string(userRaw))
	if err != nil {
		return nil, err
	}
	obj, err := extractJSONObject(raw)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Names map[string]string `json:"names"`
	}
	if err := json.Unmarshal([]byte(obj), &resp); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(needAI))
	for _, s := range needAI {
		if candidate := sanitizeSongMetaItem(s.Name, resp.Names[s.ID], targetLang, 64); candidate != "" {
			out[s.ID] = candidate
		}
	}
	return out, nil
}

func (a *lyricSingerService) saveTranslatedNames(input *lyricSingerInput, targetLang string, names map[string]string) error {
	ctx, cancel := context.WithTimeout(context.Background(), lyricSingerWriteLockTTL)
	defer cancel()
	release, err := sharedstate.Lock(ctx, a.writeLockKey(input), lyricSingerWriteLockTTL)
	if err != nil {
		return err
	}
	defer release()

	var record model.LyricSingerAnnotation
	if err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error; err != nil {
		return err
	}
	translations := parseSingerTranslationsMap(record.Translations)
	if names == nil {
		names = map[string]string{}
	}
	translations[targetLang] = names
	encoded, _ := json.Marshal(translations)
	return repo.GetDB().Model(&model.LyricSingerAnnotation{}).
		Where("id = ?", record.ID).
		Updates(map[string]any{"translations": string(encoded), "updated_at": time.Now()}).Error
}

func parseLyricSingerData(raw string) dto.LyricSingerData {
	var data dto.LyricSingerData
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &data)
	}
	return data
}

func parseSingerTranslationsMap(raw string) map[string]map[string]string {
	out := map[string]map[string]string{}
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	return out
}

func loadCachedSongArtistTranslationMap(track *dto.MusicTrackDto, targetLang string) map[string]string {
	out := map[string]string{}
	if track == nil || len(track.Artists) == 0 {
		return out
	}
	var record model.MusicSongTranslation
	if err := repo.GetDB().Where("song_id = ? AND target_lang = ?", track.ID, targetLang).First(&record).Error; err != nil {
		return out
	}
	translatedArtists := parseSongTranslatedArtists(record.Artists, len(track.Artists))
	for i, orig := range track.Artists {
		if norm := normalizeLyricMatch(orig); norm != "" && i < len(translatedArtists) {
			out[norm] = translatedArtists[i]
		}
	}
	return out
}

func translateGenericSingerRole(name, targetLang string) string {
	norm := strings.ToLower(strings.TrimSpace(name))
	switch norm {
	case "合唱", "合", "齐唱", "齊唱", "chorus", "all", "group", "together", "everyone":
		switch targetLang {
		case "en":
			return "Chorus"
		case "ko":
			return "합창"
		default:
			return "合唱"
		}
	case "男", "男声", "男聲", "male", "man", "boy":
		switch targetLang {
		case "en":
			return "Male"
		case "zh-tw", "zh-hk":
			return "男"
		case "ja":
			return "男性ボーカル"
		case "ko":
			return "남성"
		default:
			return "男"
		}
	case "女", "女声", "女聲", "female", "woman", "girl":
		switch targetLang {
		case "en":
			return "Female"
		case "zh-tw", "zh-hk":
			return "女"
		case "ja":
			return "女性ボーカル"
		case "ko":
			return "여성"
		default:
			return "女"
		}
	default:
		return ""
	}
}

// parseTTMLSingerLines 解析 TTML 中的声部声明与歌词主行/x-bg 背景行（按与前端 parse-ttml.ts 一致的排序与 bg 归属）
func parseTTMLSingerLines(raw string) ([]lyricSingerExtractedLine, []lyricSingerDeclaredAgent) {
	root := parseTTMLTree(raw)
	if root == nil {
		return nil, nil
	}

	var agents []lyricSingerDeclaredAgent
	agentSeen := map[string]bool{}
	walkTTML(root, func(node *ttmlNode) bool {
		if node.name != "agent" {
			return true
		}
		id := strings.TrimSpace(ttmlAttr(node, "id"))
		if id == "" || agentSeen[id] {
			return false
		}
		agentSeen[id] = true
		isGroup := strings.EqualFold(ttmlAttr(node, "type"), "group") || isConventionalTTMLGroupID(id)
		role := "person"
		if isGroup {
			role = "group"
		}
		agents = append(agents, lyricSingerDeclaredAgent{
			ID:      id,
			Name:    readTTMLAgentName(node),
			Role:    role,
			IsGroup: isGroup,
		})
		return false
	})

	type item struct {
		start int64
		line  lyricSingerExtractedLine
	}
	var items []item
	walkTTMLWithAgent(root, "", "", func(p *ttmlNode, inheritedAgent string) bool {
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
		hasMain := rich.text != ""
		hasBg := rich.bg != nil && rich.bg.text != ""
		if !hasMain && !hasBg {
			return false
		}
		if !hasMain && hasBg {
			bgStart := pBegin
			if rich.bg.hasTiming && rich.bg.start < math.MaxInt64 {
				bgStart = rich.bg.start
			}
			items = append(items, item{
				start: bgStart,
				line:  lyricSingerExtractedLine{Text: rich.bg.text, Bg: false, RawAgent: inheritedAgent},
			})
			return false
		}
		mainItem := item{
			start: mainStart,
			line:  lyricSingerExtractedLine{Text: rich.text, Bg: false, RawAgent: inheritedAgent},
		}
		if !hasBg {
			items = append(items, mainItem)
			return false
		}
		bgStart := pBegin
		if rich.bg.hasTiming && rich.bg.start < math.MaxInt64 {
			bgStart = rich.bg.start
		}
		bgItem := item{
			start: bgStart,
			line:  lyricSingerExtractedLine{Text: rich.bg.text, Bg: true, RawAgent: inheritedAgent},
		}
		if rich.bgFirst && bgStart <= mainStart {
			items = append(items, bgItem, mainItem)
		} else {
			items = append(items, mainItem, bgItem)
		}
		return false
	})

	sort.SliceStable(items, func(i, j int) bool { return items[i].start < items[j].start })
	out := make([]lyricSingerExtractedLine, len(items))
	for i, it := range items {
		out[i] = it.line
	}
	return out, agents
}
