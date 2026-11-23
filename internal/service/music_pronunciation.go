package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

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

// AI 歌词读音（拼音 / 粤拼 / 注音 / IPA / 罗马音）独立生成与缓存服务：
// - 每首歌曲的每个词源仅生成并保存一套本语种标准读音（与界面语言无关，由前端按用户语言决定是否隐藏同语种读音）
// - 若部分句子已带有原生或同曲兄弟源音译（如《紫荆花盛开》的粤语部分），仅对缺失读音的行插入 AI 读音，并将完整自带标记 CompleteUpstream 返回给前端
// - 逐字歌词严格按 frontend normalizeLine + 可发音词元规则对齐，保证每个含字母/数字的词与 AI 输出 tokens 一一对应

const (
	lyricPronunciationMaxLines    = 320
	lyricPronunciationMaxRetries  = 1
	lyricPronunciationTimeout     = 3 * time.Minute
	lyricPronunciationJobTTL      = 5 * time.Minute
	lyricPronunciationRetryAfter  = 5 * time.Minute
	lyricPronunciationTemperature = 0.15
)

var (
	lyricJyutpingRe = regexp.MustCompile(`\b[a-z]{1,6}[1-6]\b`)
	lyricYrcSplitRe = regexp.MustCompile(`\(\d+,\d+,\d+\)`)
	lyricQrcWordRe  = regexp.MustCompile(`([\s\S]*?)\((\d+),(\d+)\)`)
)

type musicLyricPronunciationStreamDone struct {
	Status           string `json:"status"`
	Source           string `json:"source,omitempty"`
	Lang             string `json:"lang,omitempty"`
	CompleteUpstream bool   `json:"complete_upstream,omitempty"`
}

type lyricPronunciationService struct {
	name        string
	initOnce    sync.Once
	mu          sync.Mutex
	limiter     *llmclient.Limiter
	stream      func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content string) error) error
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
	done        func()
	hubOnce     sync.Once
	hubVal      *lyricStreamHub[dto.MusicLyricPronunciationLine, musicLyricPronunciationStreamDone]
}

var lyricPronunciations = &lyricPronunciationService{
	name:    "lyric_pronunciation",
	limiter: llmclient.DefaultLimiter,
	stream: func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(content string) error) error {
		temp := lyricPronunciationTemperature
		return chatCompletionStreamWithOptions(ctx, cfg, system, user, &temp, tools.GetAILyricPronunciationThinking(), func(content, _ string) error {
			return onChunk(content)
		})
	},
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricPronunciationTemperature, tools.GetAILyricPronunciationThinking())
	},
	concurrency: tools.GetAISummaryConcurrency,
}

type lyricPronLineKey struct {
	bg   bool
	occ  int
	norm string
}

type lyricPronunciationExtracted struct {
	Start         int64
	Text          string
	Bg            bool
	RawWords      []string // 保留词间/词内空格边界的原始逐字词元（仅逐字词源非空）
	Tokens        []string // 含字母/数字的可发音词元（仅逐字词源非空）
	OwnRoman      string
	BorrowedRoman string
}

type lyricPronunciationTask struct {
	Index      int // 1-based
	OrigText   string
	VocalText  string
	Occurrence int
	Bg         bool
	RawWords   []string
	Tokens     []string
}

type lyricPronunciationUpstreamSample struct {
	Text          string `json:"text"`
	Pronunciation string `json:"pronunciation"`
}

type lyricPronunciationInput struct {
	Track            *dto.MusicTrackDto
	Source           string
	LyricHash        string
	WordTimed        bool
	SongLang         string
	ArtistHints      [][]string
	Credits          []string
	CompleteUpstream bool
	BorrowedLines    []dto.MusicLyricPronunciationLine
	UpstreamSamples  []lyricPronunciationUpstreamSample
	Tasks            []lyricPronunciationTask
	RawWordsByKey    map[lyricPronLineKey][]string
}

type lyricPronunciationNDJSONItem struct {
	I             int      `json:"i"`
	Lang          string   `json:"lang"`
	Pronunciation string   `json:"pronunciation"`
	Tokens        []string `json:"tokens"`
}

type lyricPronunciationAIResp struct {
	lyricPronunciationNDJSONItem
	Items []lyricPronunciationNDJSONItem `json:"items"`
}

// GetLyricPronunciations 获取指定词源的 AI 歌词读音；缺失且尚未生成时触发后台任务并返回 pending
func (s *MusicService) GetLyricPronunciations(ctx context.Context, id int64, source string) (*dto.MusicLyricPronunciationsDto, *errs.ServiceError) {
	track, resolvedSource, pendingDto, svcerr := s.preparePronunciationAccess(ctx, id, source)
	if svcerr != nil {
		return nil, svcerr
	}
	if pendingDto != nil {
		return pendingDto, nil
	}
	input, svcerr := s.extractLyricPronunciationInput(ctx, track, resolvedSource)
	if svcerr != nil {
		return nil, svcerr
	}
	if input.CompleteUpstream && len(input.BorrowedLines) == 0 {
		return &dto.MusicLyricPronunciationsDto{
			Status:           lyricTranslationStatusReady,
			CompleteUpstream: true,
			Source:           input.Source,
			Lang:             input.SongLang,
			Lines:            []dto.MusicLyricPronunciationLine{},
		}, nil
	}
	if len(input.Tasks) == 0 {
		lines := input.BorrowedLines
		if lines == nil {
			lines = []dto.MusicLyricPronunciationLine{}
		}
		return &dto.MusicLyricPronunciationsDto{
			Status: lyricTranslationStatusReady,
			Source: input.Source,
			Lang:   input.SongLang,
			Lines:  lines,
		}, nil
	}
	return lyricPronunciations.getOrStart(input)
}

// StreamLyricPronunciations 以 SSE 推送指定词源的 AI 歌词读音：
// 已就绪/完全自带读音时立即发送回放与 done；生成中时先回放 sharedstate 中的历史行再无缝接入单生产者实时广播流。
func (s *MusicService) StreamLyricPronunciations(
	ctx context.Context,
	id int64,
	source string,
	onReady func(),
	send func(event string, data any) error,
) *errs.ServiceError {
	track, resolvedSource, svcerr := s.resolvePronunciationTrackAndSource(ctx, id, source, 10*time.Second)
	if svcerr != nil {
		return svcerr
	}
	input, svcerr := s.extractLyricPronunciationInput(ctx, track, resolvedSource)
	if svcerr != nil {
		return svcerr
	}
	if input.CompleteUpstream && len(input.BorrowedLines) == 0 {
		onReady()
		_ = send("done", musicLyricPronunciationStreamDone{
			Status:           lyricTranslationStatusReady,
			Source:           input.Source,
			Lang:             input.SongLang,
			CompleteUpstream: true,
		})
		return nil
	}
	if len(input.Tasks) == 0 {
		onReady()
		if len(input.BorrowedLines) > 0 {
			if err := send("replay", input.BorrowedLines); err != nil {
				return nil
			}
		}
		_ = send("done", musicLyricPronunciationStreamDone{
			Status: lyricTranslationStatusReady,
			Source: input.Source,
			Lang:   input.SongLang,
		})
		return nil
	}
	return lyricPronunciations.streamWithReplay(ctx, input, onReady, send)
}

// RefreshLyricPronunciations 管理员手动重新生成指定词源的 AI 歌词读音
func (s *MusicService) RefreshLyricPronunciations(ctx context.Context, id int64, source string) (*dto.MusicLyricPronunciationsDto, *errs.ServiceError) {
	track, resolvedSource, pendingDto, svcerr := s.preparePronunciationAccess(ctx, id, source)
	if svcerr != nil {
		return nil, svcerr
	}
	if pendingDto != nil {
		return pendingDto, nil
	}
	input, svcerr := s.extractLyricPronunciationInput(ctx, track, resolvedSource)
	if svcerr != nil {
		return nil, svcerr
	}
	if len(input.Tasks) == 0 {
		lines := input.BorrowedLines
		if lines == nil {
			lines = []dto.MusicLyricPronunciationLine{}
		}
		return &dto.MusicLyricPronunciationsDto{
			Status:           lyricTranslationStatusReady,
			CompleteUpstream: input.CompleteUpstream && len(lines) == 0,
			Source:           input.Source,
			Lang:             input.SongLang,
			Lines:            lines,
		}, nil
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	return lyricPronunciations.refresh(input, cfg), nil
}

func (s *MusicService) preparePronunciationAccess(ctx context.Context, id int64, source string) (*dto.MusicTrackDto, string, *dto.MusicLyricPronunciationsDto, *errs.ServiceError) {
	track, resolvedSource, svcerr := s.resolvePronunciationTrackAndSource(ctx, id, source, lyricVersionPollWait)
	if svcerr == errLyricVersionPending {
		return nil, "", &dto.MusicLyricPronunciationsDto{
			Status: lyricTranslationStatusPending,
			Lines:  []dto.MusicLyricPronunciationLine{},
		}, nil
	}
	if svcerr != nil {
		return nil, "", nil, svcerr
	}
	return track, resolvedSource, nil, nil
}

func (s *MusicService) resolvePronunciationTrackAndSource(ctx context.Context, id int64, source string, versionWait time.Duration) (*dto.MusicTrackDto, string, *errs.ServiceError) {
	if id <= 0 || (source != "" && !lyricSettingSources[source]) {
		return nil, "", errs.NewBadRequest("invalid_request_parameters")
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
		return nil, "", errs.NewNotFound("lyric_translations_unavailable")
	}
	if source != "" {
		return track, source, nil
	}
	version, svcerr := s.siteLyricVersion(withLyricVersionWait(ctx, versionWait), id)
	if svcerr != nil {
		return nil, "", svcerr
	}
	if version == nil || version.Lines == nil {
		return nil, "", errs.NewNotFound("lyric_not_found")
	}
	return track, version.Lines.Source, nil
}

func (s *MusicService) extractLyricPronunciationInput(ctx context.Context, track *dto.MusicTrackDto, resolvedSource string) (*lyricPronunciationInput, *errs.ServiceError) {
	snapshot := s.snapshotForKind(ctx, track.ID, resolvedSource)
	extracted, credits, wordTimed, svcerr := s.extractPronunciationSourceLines(ctx, track, resolvedSource, snapshot)
	if svcerr != nil {
		return nil, svcerr
	}
	s.fillBorrowedRomanizations(ctx, track.ID, resolvedSource, extracted, snapshot)

	type occKey struct {
		bg   bool
		norm string
	}
	occCounts := make(map[occKey]int, len(extracted))
	vocalTexts := make([]string, 0, len(extracted))
	upstreamSamples := make([]lyricPronunciationUpstreamSample, 0, 3)

	var hashBuilder strings.Builder
	hashBuilder.WriteString("v3:")
	hashBuilder.WriteString(resolvedSource)
	if wordTimed {
		hashBuilder.WriteString("|wt")
	}

	type indexedCandidate struct {
		extracted lyricPronunciationExtracted
		occ       int
		vocal     string
		skip      bool
	}
	candidates := make([]indexedCandidate, len(extracted))

	for i, line := range extracted {
		key := occKey{bg: line.Bg, norm: normalizeLyricMatch(line.Text)}
		occ := occCounts[key]
		occCounts[key] = occ + 1

		hashBuilder.WriteByte('\n')
		if line.Bg {
			hashBuilder.WriteString("bg:")
		}
		hashBuilder.WriteString(line.Text)
		if wordTimed && len(line.Tokens) > 0 {
			hashBuilder.WriteByte('|')
			hashBuilder.WriteString(strings.Join(line.Tokens, "\x1f"))
		}

		vocalText, skip := classifyLyricVocalLine(line.Text)
		if !skip {
			vocalText = collapseLyricSpace(vocalText)
			if !hasPronounceableRune(vocalText) {
				skip = true
			}
		}
		if !skip {
			vocalTexts = append(vocalTexts, vocalText)
		}
		existingRoman := line.OwnRoman
		if existingRoman == "" {
			existingRoman = line.BorrowedRoman
		}
		if !skip && existingRoman != "" && len(upstreamSamples) < 3 {
			upstreamSamples = append(upstreamSamples, lyricPronunciationUpstreamSample{
				Text:          vocalText,
				Pronunciation: existingRoman,
			})
		}
		candidates[i] = indexedCandidate{
			extracted: line,
			occ:       occ,
			vocal:     vocalText,
			skip:      skip,
		}
	}

	hints := loadSongHints(track.ID)
	songLang := detectPronunciationSongLang(vocalTexts, upstreamSamples)
	var (
		tasks         []lyricPronunciationTask
		borrowedLines []dto.MusicLyricPronunciationLine
		ownRomanCount int
		rawWordsByKey map[lyricPronLineKey][]string
	)
	if wordTimed {
		rawWordsByKey = make(map[lyricPronLineKey][]string, len(candidates))
	}

	for _, c := range candidates {
		if wordTimed && len(c.extracted.RawWords) > 0 {
			lk := lyricPronLineKey{bg: c.extracted.Bg, occ: c.occ, norm: normalizeLyricMatch(c.extracted.Text)}
			rawWordsByKey[lk] = c.extracted.RawWords
		}
		if c.skip {
			continue
		}
		if c.extracted.OwnRoman != "" {
			ownRomanCount++
			continue
		}
		if c.extracted.BorrowedRoman != "" {
			lineLang := detectPronunciationLineLang(c.vocal, c.extracted.BorrowedRoman, songLang)
			var borrowedTokens []string
			if wordTimed && len(c.extracted.Tokens) > 0 {
				borrowedTokens = alignPronunciationToRawWords(
					c.extracted.RawWords,
					c.extracted.Tokens,
					nil,
					c.extracted.BorrowedRoman,
					c.vocal,
					lineLang,
				)
			}
			borrowedLines = append(borrowedLines, dto.MusicLyricPronunciationLine{
				Text:          c.extracted.Text,
				Occurrence:    c.occ,
				Bg:            c.extracted.Bg,
				Lang:          lineLang,
				Pronunciation: c.extracted.BorrowedRoman,
				Tokens:        borrowedTokens,
			})
			continue
		}
		var tokens, rawWords []string
		if wordTimed {
			tokens = c.extracted.Tokens
			rawWords = c.extracted.RawWords
		}
		tasks = append(tasks, lyricPronunciationTask{
			Index:      len(tasks) + 1,
			OrigText:   c.extracted.Text,
			VocalText:  c.vocal,
			Occurrence: c.occ,
			Bg:         c.extracted.Bg,
			RawWords:   rawWords,
			Tokens:     tokens,
		})
		if len(tasks) >= lyricPronunciationMaxLines {
			break
		}
	}

	sum := sha256.Sum256([]byte(hashBuilder.String()))
	lyricHash := hex.EncodeToString(sum[:])

	completeUpstream := len(tasks) == 0 && len(borrowedLines) == 0 && ownRomanCount > 0
	return &lyricPronunciationInput{
		Track:            track,
		Source:           resolvedSource,
		LyricHash:        lyricHash,
		WordTimed:        wordTimed,
		SongLang:         songLang,
		ArtistHints:      hints.ArtistHints,
		Credits:          credits,
		CompleteUpstream: completeUpstream,
		BorrowedLines:    borrowedLines,
		UpstreamSamples:  upstreamSamples,
		Tasks:            tasks,
		RawWordsByKey:    rawWordsByKey,
	}, nil
}

func appendPronunciationCredit(credits []string, seen map[string]bool, raw string) []string {
	if len(credits) >= 12 {
		return credits
	}
	trimmed := collapseLyricSpace(raw)
	if trimmed == "" || trimmed == "//" || len([]rune(trimmed)) > 120 || seen[trimmed] {
		return credits
	}
	seen[trimmed] = true
	return append(credits, trimmed)
}

func collectPlatformCreditLines(texts []string, track *dto.MusicTrackDto) []string {
	if len(texts) == 0 {
		return nil
	}
	head, tail := lyricCreditRange(texts, track.Name, track.Artists)
	seen := map[string]bool{}
	var credits []string
	for _, line := range texts[:head] {
		credits = appendPronunciationCredit(credits, seen, line)
	}
	for _, line := range texts[tail:] {
		credits = appendPronunciationCredit(credits, seen, line)
	}
	return credits
}

func (s *MusicService) cachedNCMCreditLines(track *dto.MusicTrackDto, snapshot *dto.MusicLyricCacheDto) []string {
	var ncm *dto.MusicLyricDto
	if snapshot != nil && snapshot.Ncm != nil {
		ncm = snapshot.Ncm
	} else if cached, ok := loadMusicLyricCacheEntry(track.ID); ok && !cached.miss() {
		ncm = &cached.Lyric
	}
	if ncm == nil {
		return nil
	}
	var raw string
	if ncm.Lrc != nil && strings.TrimSpace(ncm.Lrc.Lyric) != "" {
		raw = ncm.Lrc.Lyric
	} else if ncm.Yrc != nil && strings.TrimSpace(ncm.Yrc.Lyric) != "" {
		raw = ncm.Yrc.Lyric
	}
	if raw == "" {
		return nil
	}
	var texts []string
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
		texts = append(texts, text)
	}
	return collectPlatformCreditLines(texts, track)
}

func (s *MusicService) extractPronunciationSourceLines(
	ctx context.Context,
	track *dto.MusicTrackDto,
	source string,
	snapshot *dto.MusicLyricCacheDto,
) ([]lyricPronunciationExtracted, []string, bool, *errs.ServiceError) {
	switch source {
	case "ttml-amll", "ttml-custom":
		rawTTML := s.resolveRawTTMLForSource(ctx, track.ID, source, snapshot)
		if rawTTML == "" {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		lines, credits, wordTimed := parseTTMLPronunciationLines(rawTTML)
		if len(lines) == 0 {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		if len(credits) == 0 {
			credits = s.cachedNCMCreditLines(track, snapshot)
		}
		return lines, credits, wordTimed, nil
	case "ncm-yrc", "ncm-lrc":
		ncm := s.resolveNCMLyric(ctx, track.ID, snapshot)
		if ncm == nil {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		var raw, roma string
		wordTimed := source == "ncm-yrc"
		if wordTimed {
			if ncm.Yrc == nil || strings.TrimSpace(ncm.Yrc.Lyric) == "" {
				return nil, nil, false, errs.NewNotFound("lyric_not_found")
			}
			raw = ncm.Yrc.Lyric
			roma = firstLyricPart(ncm.Yromalrc, ncm.Romalrc)
		} else {
			if ncm.Lrc == nil || strings.TrimSpace(ncm.Lrc.Lyric) == "" {
				return nil, nil, false, errs.NewNotFound("lyric_not_found")
			}
			raw = ncm.Lrc.Lyric
			if ncm.Romalrc != nil {
				roma = ncm.Romalrc.Lyric
			}
		}
		lines, credits := parsePlatformPronunciationLines(raw, roma, "yrc", wordTimed, track)
		if len(lines) == 0 {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		return lines, credits, wordTimed, nil
	case "qq-qrc", "qq-lrc":
		qq := s.resolveQQLyric(ctx, track.ID, snapshot)
		if qq == nil || strings.TrimSpace(qq.Lyric) == "" {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		wordTimed := source == "qq-qrc"
		if wordTimed != (qq.Format == "qrc") {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		lines, credits := parsePlatformPronunciationLines(qq.Lyric, qq.Romanization, "qrc", wordTimed, track)
		if len(lines) == 0 || allPronunciationLinesInstrumental(lines) {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		return lines, credits, wordTimed, nil
	case "kugou-krc", "kugou-lrc":
		kugou := s.resolveKugouLyric(ctx, track.ID, snapshot)
		if kugou == nil || strings.TrimSpace(kugou.Lyric) == "" {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		wordTimed := source == "kugou-krc"
		if wordTimed != (kugou.Format == "qrc") {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		lines, credits := parsePlatformPronunciationLines(kugou.Lyric, kugou.Romanization, "qrc", wordTimed, track)
		if len(lines) == 0 || allPronunciationLinesInstrumental(lines) {
			return nil, nil, false, errs.NewNotFound("lyric_not_found")
		}
		return lines, credits, wordTimed, nil
	default:
		return nil, nil, false, errs.NewBadRequest("invalid_request_parameters")
	}
}

func allPronunciationLinesInstrumental(lines []lyricPronunciationExtracted) bool {
	for _, line := range lines {
		if !lyricInstrumentalRe.MatchString(line.Text) {
			return false
		}
	}
	return true
}

// fillBorrowedRomanizations 从同曲缓存快照或其他平台读取现成的音译行（不触发新的外部请求），补齐本词源缺失的局部音译
func (s *MusicService) fillBorrowedRomanizations(
	ctx context.Context,
	id int64,
	source string,
	lines []lyricPronunciationExtracted,
	snapshot *dto.MusicLyricCacheDto,
) {
	missingCount := 0
	for i := range lines {
		if lines[i].OwnRoman == "" {
			missingCount++
		}
	}
	if missingCount == 0 {
		return
	}

	var candidatesRaw []string
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
		if r := firstLyricPart(ncm.Yromalrc, ncm.Romalrc); r != "" {
			candidatesRaw = append(candidatesRaw, r)
		}
	}

	var qq *dto.MusicQQLyricDto
	if snapshot != nil && snapshot.QQ != nil {
		qq = snapshot.QQ
	} else if cached, ok := loadQQCacheEntry(id); ok && cached.Lyric.Romanization != "" {
		qq = &cached.Lyric
	}
	if qq != nil && strings.TrimSpace(qq.Romanization) != "" {
		candidatesRaw = append(candidatesRaw, qq.Romanization)
	}

	var kugou *dto.MusicKugouLyricDto
	if snapshot != nil && snapshot.Kugou != nil {
		kugou = snapshot.Kugou
	} else if cached, ok := loadKugouCacheEntry(id); ok && cached.Lyric.Romanization != "" {
		kugou = &cached.Lyric
	}
	if kugou != nil && strings.TrimSpace(kugou.Romanization) != "" {
		candidatesRaw = append(candidatesRaw, kugou.Romanization)
	}

	if len(candidatesRaw) == 0 {
		return
	}

	timed := make([]lyricTimedLine, len(lines))
	for i, line := range lines {
		timed[i] = lyricTimedLine{Start: line.Start, Text: line.Text}
	}
	for _, raw := range candidatesRaw {
		aligned := alignExpandedTranslations(timed, raw)
		for i, rom := range aligned {
			if lines[i].OwnRoman == "" && lines[i].BorrowedRoman == "" && isValidNativeRomanText(lines[i].Text, rom) {
				lines[i].BorrowedRoman = rom
			}
		}
	}
}

func isValidNativeRomanText(orig, rom string) bool {
	rom = collapseLyricSpace(rom)
	if rom == "" || rom == "//" || normalizeLyricMatch(rom) == normalizeLyricMatch(orig) {
		return false
	}
	if lyricCJKRe.MatchString(rom) {
		return false
	}
	return lyricLatinRe.MatchString(rom) || hasBopomofo(rom)
}

func (a *lyricPronunciationService) prefix() string {
	a.initOnce.Do(func() {
		if a.name == "" {
			a.name = "lyric_pronunciation_" + utils.Strings.GenerateRandomString(8)
		}
	})
	return a.name
}

func (a *lyricPronunciationService) hub() *lyricStreamHub[dto.MusicLyricPronunciationLine, musicLyricPronunciationStreamDone] {
	a.hubOnce.Do(func() {
		a.hubVal = newLyricStreamHub[dto.MusicLyricPronunciationLine, musicLyricPronunciationStreamDone](a.prefix())
	})
	return a.hubVal
}

func (a *lyricPronunciationService) stateKey(input *lyricPronunciationInput) string {
	return strconv.FormatInt(input.Track.ID, 10) + ":" + input.Source + ":" + input.LyricHash
}

func (a *lyricPronunciationService) stateKeys(key string) (job, failed string) {
	return a.prefix() + ":job:" + key, a.prefix() + ":failed:" + key
}

func (a *lyricPronunciationService) jobState(key string) (running, coolingDown bool) {
	jobKey, failedKey := a.stateKeys(key)
	values, err := sharedstate.Current().GetMany(jobKey, failedKey)
	if err != nil {
		return false, false
	}
	_, running = values[jobKey]
	_, coolingDown = values[failedKey]
	return running, coolingDown
}

func (a *lyricPronunciationService) ensureProducer(key string, input *lyricPronunciationInput) (
	replay []dto.MusicLyricPronunciationLine,
	doneMeta *musicLyricPronunciationStreamDone,
	alreadyDone bool,
	svcerr *errs.ServiceError,
) {
	a.mu.Lock()
	defer a.mu.Unlock()

	running, coolingDown := a.jobState(key)
	var record model.LyricPronunciation
	err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, false, errs.Internal("failed_to_get_target", err)
	}
	if err == nil && !running {
		lines := enrichCachedPronunciationLines(parseLyricPronunciationLines(record.Data), input)
		if lines == nil {
			lines = []dto.MusicLyricPronunciationLine{}
		}
		meta := &musicLyricPronunciationStreamDone{
			Status: lyricTranslationStatusReady,
			Source: input.Source,
			Lang:   record.Lang,
		}
		return lines, meta, true, nil
	}

	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, nil, false, errs.NewNotFound("lyric_translations_unavailable")
	}
	if running {
		return nil, nil, false, nil
	}
	if coolingDown {
		return nil, nil, false, errs.NewNotFound("lyric_translations_failed")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, nil, false, svcerr
	}
	a.startLocked(key, input, cfg)
	return nil, nil, false, nil
}

func (a *lyricPronunciationService) streamWithReplay(
	ctx context.Context,
	input *lyricPronunciationInput,
	onReady func(),
	send func(event string, data any) error,
) *errs.ServiceError {
	key := a.stateKey(input)
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

	consumeLyricStream(ctx, hub, key, sub, send, func() ([]dto.MusicLyricPronunciationLine, *musicLyricPronunciationStreamDone, bool, string) {
		running, coolingDown := a.jobState(key)
		var record model.LyricPronunciation
		err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error
		if err == nil && !running {
			lines := enrichCachedPronunciationLines(parseLyricPronunciationLines(record.Data), input)
			return lines, &musicLyricPronunciationStreamDone{
				Status: lyricTranslationStatusReady,
				Source: input.Source,
				Lang:   record.Lang,
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

func (a *lyricPronunciationService) getOrStart(input *lyricPronunciationInput) (*dto.MusicLyricPronunciationsDto, *errs.ServiceError) {
	key := a.stateKey(input)
	a.mu.Lock()
	defer a.mu.Unlock()

	running, coolingDown := a.jobState(key)
	var record model.LyricPronunciation
	err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if err == nil {
		lines := enrichCachedPronunciationLines(parseLyricPronunciationLines(record.Data), input)
		if lines == nil {
			lines = []dto.MusicLyricPronunciationLine{}
		}
		return &dto.MusicLyricPronunciationsDto{
			Status: lyricTranslationStatusReady,
			Stale:  running,
			Source: input.Source,
			Lang:   record.Lang,
			Lines:  lines,
		}, nil
	}

	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	if running {
		var lines []dto.MusicLyricPronunciationLine
		if snap := a.hub().loadSnapshot(key); snap != nil {
			lines = snap.Lines
		}
		hasPartial := len(lines) > 0
		if lines == nil {
			lines = []dto.MusicLyricPronunciationLine{}
		}
		return &dto.MusicLyricPronunciationsDto{
			Status:  lyricTranslationStatusPending,
			Partial: hasPartial,
			Source:  input.Source,
			Lang:    input.SongLang,
			Lines:   lines,
		}, nil
	}
	if coolingDown {
		return nil, errs.NewNotFound("lyric_translations_failed")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	a.startLocked(key, input, cfg)
	return &dto.MusicLyricPronunciationsDto{
		Status: lyricTranslationStatusPending,
		Source: input.Source,
		Lang:   input.SongLang,
		Lines:  []dto.MusicLyricPronunciationLine{},
	}, nil
}

func (a *lyricPronunciationService) refresh(input *lyricPronunciationInput, cfg tools.AIConfig) *dto.MusicLyricPronunciationsDto {
	key := a.stateKey(input)
	a.mu.Lock()
	defer a.mu.Unlock()

	if running, _ := a.jobState(key); !running {
		a.startLocked(key, input, cfg)
	}
	var record model.LyricPronunciation
	if err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error; err == nil {
		lines := enrichCachedPronunciationLines(parseLyricPronunciationLines(record.Data), input)
		if lines == nil {
			lines = []dto.MusicLyricPronunciationLine{}
		}
		return &dto.MusicLyricPronunciationsDto{
			Status: lyricTranslationStatusReady,
			Stale:  true,
			Source: input.Source,
			Lang:   record.Lang,
			Lines:  lines,
		}
	}
	return &dto.MusicLyricPronunciationsDto{
		Status: lyricTranslationStatusPending,
		Source: input.Source,
		Lang:   input.SongLang,
		Lines:  []dto.MusicLyricPronunciationLine{},
	}
}

func (a *lyricPronunciationService) startLocked(key string, input *lyricPronunciationInput, cfg tools.AIConfig) {
	jobKey, failedKey := a.stateKeys(key)
	lease, err := sharedstate.AcquireLease(jobKey, lyricPronunciationJobTTL)
	if err != nil || lease == nil {
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	// 先用借用的原生音译行初始化进度快照，确保回放与流式增量行共享同一单调序号
	writer := a.hub().initSnapshot(key, input.BorrowedLines, lyricPronunciationTimeout+2*time.Minute)
	go a.run(lease, key, writer, input, cfg)
}

func (a *lyricPronunciationService) run(
	lease *sharedstate.Lease,
	key string,
	writer *lyricStreamWriter[dto.MusicLyricPronunciationLine, musicLyricPronunciationStreamDone],
	input *lyricPronunciationInput,
	cfg tools.AIConfig,
) {
	a.execute(lease, key, writer, input, cfg)
}

func (a *lyricPronunciationService) execute(
	lease *sharedstate.Lease,
	key string,
	writer *lyricStreamWriter[dto.MusicLyricPronunciationLine, musicLyricPronunciationStreamDone],
	input *lyricPronunciationInput,
	cfg tools.AIConfig,
) {
	var jobErr error
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("lyric pronunciation panic for song %d (%s): %v", input.Track.ID, input.Source, r)
			jobErr = fmt.Errorf("panic: %v", r)
		}
		if jobErr != nil {
			_, failedKey := a.stateKeys(key)
			_ = sharedstate.Current().Set(failedKey, "1", lyricPronunciationRetryAfter)
			if writer != nil {
				writer.Fail(jobErr.Error())
			}
		}
		lease.Release()
		if a.done != nil {
			a.done()
		}
	}()

	lines, err := a.generateStream(cfg, input, writer)
	if err != nil {
		logrus.Warnf("lyric pronunciation failed for song %d (%s): %v", input.Track.ID, input.Source, err)
		jobErr = err
		return
	}
	combined := append([]dto.MusicLyricPronunciationLine(nil), input.BorrowedLines...)
	combined = append(combined, lines...)
	resolvedLang := resolvePronunciationRecordLang(combined, input.SongLang)
	encoded, _ := json.Marshal(combined)
	record := &model.LyricPronunciation{
		SongID:    input.Track.ID,
		Source:    input.Source,
		LyricHash: input.LyricHash,
		Lang:      resolvedLang,
		Data:      string(encoded),
		Model:     cfg.Model,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "source"}, {Name: "lyric_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"lang", "data", "model", "updated_at"}),
	}
	if dbErr := repo.GetDB().Clauses(upsert).Create(record).Error; dbErr != nil {
		logrus.Errorf("save lyric pronunciation failed for song %d (%s): %v", input.Track.ID, input.Source, dbErr)
		jobErr = dbErr
		return
	}
	if writer != nil {
		writer.Finish(musicLyricPronunciationStreamDone{
			Status: lyricTranslationStatusReady,
			Source: input.Source,
			Lang:   resolvedLang,
		})
	}
}

func (a *lyricPronunciationService) callStream(
	ctx context.Context,
	cfg tools.AIConfig,
	system, user string,
	onChunk func(content string) error,
) error {
	_ = a.limiter.AcquireTier(ctx, a.concurrency, llmclient.TierFirstScreen, nil)
	defer a.limiter.Release()
	callCtx, cancel := context.WithTimeout(withLLMPurpose(ctx, constant.LLMPurposeTranslation, 0), lyricPronunciationTimeout)
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
	return errors.New("lyric pronunciation provider not configured")
}

func buildPronunciationLine(
	task lyricPronunciationTask,
	item lyricPronunciationNDJSONItem,
	wordTimed bool,
	defaultLang string,
) (lineOut dto.MusicLyricPronunciationLine, valid bool, wrongScript bool) {
	lang := normalizePronunciationLang(item.Lang, defaultLang)
	pron := collapseLyricSpace(item.Pronunciation)
	if pron == "" && len(item.Tokens) > 0 {
		var nonEmpty []string
		for _, tok := range item.Tokens {
			if c := collapseLyricSpace(tok); c != "" {
				nonEmpty = append(nonEmpty, c)
			}
		}
		pron = strings.Join(nonEmpty, " ")
	}
	if pron == "" {
		return lineOut, false, false
	}
	if !isValidPronunciationText(pron, task.VocalText, lang) {
		return lineOut, false, true
	}
	lineOut = dto.MusicLyricPronunciationLine{
		Text:          task.OrigText,
		Occurrence:    task.Occurrence,
		Bg:            task.Bg,
		Lang:          lang,
		Pronunciation: pron,
	}
	if wordTimed && len(task.Tokens) > 0 {
		if len(item.Tokens) == len(task.Tokens) {
			validTokens := make([]string, len(item.Tokens))
			tokensOk := true
			for idx, tok := range item.Tokens {
				cleaned := collapseLyricSpace(tok)
				if cleaned != "" && !isValidPronunciationText(cleaned, task.VocalText, lang) {
					tokensOk = false
					break
				}
				validTokens[idx] = cleaned
			}
			if tokensOk {
				lineOut.Tokens = validTokens
			}
		} else if fields := strings.Fields(pron); len(fields) == len(task.Tokens) {
			lineOut.Tokens = fields
		}
		if len(lineOut.Tokens) == 0 {
			lineOut.Tokens = alignPronunciationToRawWords(task.RawWords, task.Tokens, item.Tokens, pron, task.VocalText, lang)
		}
	}
	return lineOut, true, false
}

// generateStream 整篇单流生成整首歌音译/读音：整曲任务一次性输入大模型以保证注音体系与地区变体前后一致，
// 每产出合法的一行 NDJSON 立即经 writer 广播给订阅客户端；若部分逐字行音节 tokens 长度失配且无法规则对齐，自动针对失配行发起局部重试补齐。
func (a *lyricPronunciationService) generateStream(
	cfg tools.AIConfig,
	input *lyricPronunciationInput,
	writer *lyricStreamWriter[dto.MusicLyricPronunciationLine, musicLyricPronunciationStreamDone],
) ([]dto.MusicLyricPronunciationLine, error) {
	if len(input.Tasks) == 0 {
		return []dto.MusicLyricPronunciationLine{}, nil
	}
	system := buildPronunciationSystemPrompt(input.WordTimed, input.SongLang)
	baseUser := buildPronunciationUserPrompt(input, input.Tasks)
	posByIndex := make(map[int]int, len(input.Tasks))
	for pos, task := range input.Tasks {
		posByIndex[task.Index] = pos
	}

	results := make([]dto.MusicLyricPronunciationLine, len(input.Tasks))
	decidedPos := make([]bool, len(input.Tasks))
	emittedTotal := 0

	var lastErr error
	user := baseUser
	for attempt := 0; attempt <= lyricPronunciationMaxRetries; attempt++ {
		if attempt > 0 && lyricTranslationRetryDelay > 0 {
			time.Sleep(lyricTranslationRetryDelay)
		}

		parsedAttempt := 0
		validAttempt := 0
		wrongAttempt := 0
		var scanner ndjsonLineScanner

		handleItem := func(it lyricPronunciationNDJSONItem) {
			pos, ok := posByIndex[it.I]
			if !ok {
				return
			}
			parsedAttempt++
			task := input.Tasks[pos]
			lineOut, valid, wrong := buildPronunciationLine(task, it, input.WordTimed, input.SongLang)
			if wrong {
				wrongAttempt++
				return
			}
			if !valid {
				return
			}
			if decidedPos[pos] {
				// 局部音节纠偏重试：仅当此前该行缺失逐音节 Tokens 且本轮补齐了等长 Tokens 时原地升级并重新广播
				if input.WordTimed && len(task.Tokens) > 0 && len(results[pos].Tokens) == 0 && len(lineOut.Tokens) == len(task.Tokens) {
					results[pos] = lineOut
					validAttempt++
					if writer != nil {
						writer.EmitLine(lineOut)
					}
				}
				return
			}
			decidedPos[pos] = true
			results[pos] = lineOut
			emittedTotal++
			validAttempt++
			if writer != nil {
				writer.EmitLine(lineOut)
			}
		}

		handleObj := func(objJSON string) {
			var parsed lyricPronunciationAIResp
			if err := json.Unmarshal([]byte(objJSON), &parsed); err != nil {
				return
			}
			if len(parsed.Items) > 0 {
				for _, it := range parsed.Items {
					handleItem(it)
				}
				return
			}
			if parsed.I > 0 {
				handleItem(parsed.lyricPronunciationNDJSONItem)
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
		if parsedAttempt == 0 {
			lastErr = errors.New("lyric pronunciation returned no matching indices")
			continue
		}

		needsScriptRetry := (emittedTotal == 0 && wrongAttempt > 0) || (len(input.Tasks) >= 4 && wrongAttempt*2 >= len(input.Tasks))
		var tokenRetryTasks []lyricPronunciationTask
		if input.WordTimed {
			for pos, task := range input.Tasks {
				if decidedPos[pos] && len(task.Tokens) > 0 && len(results[pos].Tokens) == 0 {
					tokenRetryTasks = append(tokenRetryTasks, task)
				}
			}
		}

		if attempt < lyricPronunciationMaxRetries && (needsScriptRetry || len(tokenRetryTasks) > 0) {
			if needsScriptRetry {
				var pendingIndices []int
				for pos, task := range input.Tasks {
					if !decidedPos[pos] || (input.WordTimed && len(task.Tokens) > 0 && len(results[pos].Tokens) == 0) {
						pendingIndices = append(pendingIndices, task.Index)
					}
				}
				notice := "\nCRITICAL RETRY NOTICE: Your previous output copied source characters (Hanzi/Kana/Hangul) instead of phonetic notation, omitted Bopomofo for zh-tw, or failed syllable token_count alignment. Every line MUST use pure phonetic notation according to the rules. For Taiwan Mandarin songs/artists, Mandarin lines MUST use Bopomofo (注音符號) with lang \"zh-tw\" (never Hanyu Pinyin); for Taiwanese Hokkien/Minnan lines, use Tâi-lô Latin romanization with lang \"other\"."
				if input.WordTimed {
					notice += " Every word-timed line MUST include \"tokens\" with EXACT length == token_count (one phonetic syllable string per input token slot, never merged into whole words)."
				}
				if emittedTotal > 0 && len(pendingIndices) > 0 && len(pendingIndices) < len(input.Tasks) {
					pendingJSON, _ := json.Marshal(pendingIndices)
					notice += fmt.Sprintf(" Emit NDJSON lines ONLY for remaining indices %s.", string(pendingJSON))
				}
				user = baseUser + notice
				lastErr = errors.New("lyric pronunciation returned wrong script")
				continue
			}

			// 仅部分逐字行的音节 tokens 长度不匹配：只将失配行发回大模型按精确 token_count 重新拆音节，开销极低
			retryPrompt := buildPronunciationUserPrompt(input, tokenRetryTasks)
			notice := "\nCRITICAL SYLLABLE ALIGNMENT RETRY: In your previous output, `tokens.length` did NOT equal `token_count` for the lines above (you merged sub-word syllables into whole words or joined liaisons). Re-emit NDJSON lines ONLY for the `lines` above, ensuring `tokens` has the EXACT SAME length as `token_count` in strict 1-to-1 syllable order matching each input token slot!"
			user = retryPrompt + notice
			continue
		}
		lastErr = nil
		break
	}

	if lastErr != nil && emittedTotal == 0 {
		// 若已有部分合法结构只是错语种行被全部过滤且重试已耗尽，容错保存为空而非挂起错误
		if lastErr.Error() != "lyric pronunciation returned wrong script" {
			return nil, lastErr
		}
	}

	out := make([]dto.MusicLyricPronunciationLine, 0, len(input.Tasks))
	for pos := range input.Tasks {
		if decidedPos[pos] {
			out = append(out, results[pos])
		}
	}
	return out, nil
}

func buildPronunciationSystemPrompt(wordTimed bool, songLang string) string {
	var b strings.Builder
	b.WriteString("You generate accurate phonetic pronunciation transcriptions for full-song lyrics, keeping the chosen phonetic system and regional variety 100% consistent across the whole song.\n\n")
	b.WriteString(fmt.Sprintf("Detected primary song script/language hint: %s.\n\n", songLang))
	b.WriteString("REGIONAL VARIETY & SCRIPT JUDGMENT (YOUR RESPONSIBILITY):\n")
	b.WriteString("- Inspect `title`, `artists`, `album`, `aliases`, `artist_hints`, `credits`, and the lyrics themselves to determine each line's exact spoken/sung language variety:\n")
	b.WriteString("  * Taiwan Mandarin (台灣國語) vs Mainland Mandarin (普通话) vs Hong Kong/Macau Cantonese (粵語) vs Taiwanese Hokkien/Minnan (閩南語/台語).\n")
	b.WriteString("  * Even when input lyrics are written in Simplified Chinese, if the song, performing artist/band, or songwriter/lyricist/composer/record label is from Taiwan (e.g., 周杰伦, 田馥甄《小幸运》, 潘安邦/叶佳修《外婆的澎湖湾》, 《孤儿乐园》, etc.) AND the line is sung in **Mandarin (國語)**, you MUST judge it as Taiwan Mandarin (`\"lang\": \"zh-tw\"`) and output **Bopomofo (注音符號)** — NEVER Hanyu Pinyin!\n")
	b.WriteString("  * **STRICT HOKKIEN / MINNAN (閩南語 / 台語) EXCLUSION**: NEVER use Bopomofo or Mandarin Pinyin for Hokkien / Minnan songs or Hokkien lines mixed into a Taiwan song (e.g., 《愛拚才會贏》, 《浪子回頭》). Tag Hokkien lines `\"lang\": \"other\"` and output standard **Tâi-lô Romanization (台灣閩南語羅馬字拼音方案)**.\n\n")
	b.WriteString("STANDARD PHONETIC SYSTEMS BY LINE LANGUAGE (`lang`):\n")
	b.WriteString("- `zh` (Mainland Mandarin / 普通话): Standard Hanyu Pinyin with tone marks (e.g. `wǒ ài nǐ`), lowercase, space-separated per syllable — use ONLY for non-Taiwan Mandarin.\n")
	b.WriteString("- `zh-hk` (Cantonese): LSHK Jyutping with tone numbers 1–6 (e.g. `ngo5 oi3 nei5`), lowercase, space-separated per syllable.\n")
	b.WriteString("- `zh-tw` (Taiwan Mandarin / 台灣國語): Standard Bopomofo / Zhuyin (注音符號, e.g. `ㄒㄧㄠˇ ㄒㄧㄥˋ ㄩㄣˋ`, `ㄨㄢˇ ㄈㄥ ㄑㄧㄥ ㄈㄨˊ ㄆㄥˊ ㄏㄨˊ ㄨㄢ`, neutral tone `˙`), space-separated per syllable, following authentic Taiwan Guoyu standard readings.\n")
	b.WriteString("- `ja` (Japanese): Standard Hepburn Romaji, lowercase, space-separated per word/phrase.\n")
	b.WriteString("- `ko` (Korean): Revised Romanization of Korean, lowercase.\n")
	b.WriteString("- `en` (English): Standard General American IPA WITHOUT surrounding slashes `/` (e.g. `həˈloʊ wɜːrld`).\n")
	b.WriteString("- `other` (Hokkien Tâi-lô, Russian, French, Thai, Arabic, etc.): Standard international Latin romanization (ISO / BGN-PCGN / RTGS / Tâi-lô) or IPA for Latin-script foreign words.\n\n")
	b.WriteString("RULES:\n")
	b.WriteString("1. NEVER copy source Hanzi, Kana, or Hangul characters into `pronunciation` or `tokens`!\n")
	b.WriteString("2. INLINE SINGER / PART CUE PREFIXES (e.g. `汪：`, `BY2：`, `合：`, `男：`, `周杰伦：`, `[可莉]`): Recognizable singer/part cue labels before a colon or in brackets are NOT sung — omit the cue prefix completely from `pronunciation`, and output `\"\"` for word-timed `tokens` belonging only to the cue prefix (conversely, if a colon introduces genuine sung speech inside a lyric, pronounce the whole sung line).\n")
	b.WriteString("3. Follow the style of `upstream_samples` if provided (e.g. Jyutping format on partially romanized songs).\n")
	if wordTimed {
		b.WriteString("4. STRICT SYLLABLE-SPAN ALIGNMENT (`tokens.length == token_count`): Each line's `tokens` array comes directly from the timed syllable spans of the lyric source (TTML / YRC / QRC) — they are often **sub-word syllables** rather than whole words! If `syllable_map` is present, `·` marks intra-word syllable splits and `[...]` marks a span crossing a word space. You MUST output `tokens` BEFORE `pronunciation` with the **EXACT SAME length (`token_count`)** and strict 1-to-1 order:\n")
		b.WriteString("   - **Polysyllabic words split across spans**: Split the word's phonetic transcription across those exact syllable slots — NEVER merge them into one whole-word token! E.g. `[\"be\",\"nea\",\"th\"]` -> `[\"bɪ\",\"ˈni\",\"θ\"]`; `[\"su\",\"ffit\"]` -> `[\"sy\",\"fi\"]`; `[\"se\",\"rai\",\"t-il\"]` -> `[\"sə\",\"ʁɛ\",\"til\"]`.\n")
		b.WriteString("   - **Liaison / sandhi across words (e.g. French `grand amour`, `monde et`)**: NEVER merge two input tokens into a single `‿`-joined slot! Keep each input token in its own slot (e.g. `[\"g\",\"rand\",\"amo\",\"ur\"]` -> `[\"ɡ\",\"ʁɑ̃t\",\"a\",\"muʁ\"]`).\n")
		b.WriteString("   - **Cross-word glued spans**: If one input span contains the tail of one word plus the next word (e.g. `[\"whi\",\"s\",\"per\",\"s and\"]` or `[\"chase\",\"d our\"]`), put all sounds sung in that span into that single slot (`[\"ˈwɪ\",\"s\",\"pər\",\"z ænd\"]`, `[\"tʃeɪs\",\"t aʊər\"]`).\n")
		b.WriteString("   - **Silent trailing letter in its own span**: If a trailing span is a silent letter with no sound of its own (e.g. French `[\"dou\",\"x\"]` or `[\"vie\",\"s.\"]`), output `\"\"` for that silent slot (`[\"du\",\"\"]`) WITHOUT shifting subsequent tokens; use `\"\"` likewise for non-sung cue prefixes.\n")
		b.WriteString("   - **Multi-character CJK spans**: If one input span has multiple Hanzi/Kana/Hangul characters (e.g. `[\"五陵\",\"年\",\"少\"]`), put all syllables of that span space-separated inside that single slot (`[\"wǔ líng\",\"nián\",\"shào\"]`).\n")
		b.WriteString("5. STRICT NDJSON STREAMING OUTPUT: Emit ONE compact JSON object per line (`tokens` first, then `pronunciation`) followed immediately by a newline in ascending order of i:\n{\"i\":1,\"lang\":\"en\",\"tokens\":[\"ðə\",\"ˈwɪ\",\"s\",\"pər\",\"z ænd\",\"ˈsi\",\"krɪts\"],\"pronunciation\":\"ðə ˈwɪspərz ænd ˈsikrɪts\"}\nNEVER wrap output in {\"items\":[...]}, NEVER output a JSON array [...], and NEVER output markdown fences (```) or conversational prose.\n")
	} else {
		b.WriteString("4. STRICT NDJSON STREAMING OUTPUT: Emit ONE compact JSON object per line followed immediately by a newline in ascending order of i:\n{\"i\":1,\"lang\":\"zh\",\"pronunciation\":\"wǒ ài nǐ\"}\nNEVER wrap output in {\"items\":[...]}, NEVER output a JSON array [...], and NEVER output markdown fences (```) or conversational prose.\n")
	}
	return b.String()
}

func buildPronunciationUserPrompt(input *lyricPronunciationInput, tasks []lyricPronunciationTask) string {
	type promptLine struct {
		I           int      `json:"i"`
		Text        string   `json:"text"`
		Tokens      []string `json:"tokens,omitempty"`
		TokenCount  int      `json:"token_count,omitempty"`
		SyllableMap string   `json:"syllable_map,omitempty"`
	}
	lines := make([]promptLine, len(tasks))
	for i, t := range tasks {
		var tokCopy []string
		count := 0
		syllableMap := ""
		if input.WordTimed && len(t.Tokens) > 0 {
			tokCopy = t.Tokens
			count = len(t.Tokens)
			syllableMap = formatSyllableMapHint(t.RawWords)
		}
		lines[i] = promptLine{
			I:           t.Index,
			Text:        t.VocalText,
			Tokens:      tokCopy,
			TokenCount:  count,
			SyllableMap: syllableMap,
		}
	}
	payload := struct {
		Title           string                             `json:"title"`
		Artists         []string                           `json:"artists,omitempty"`
		Album           string                             `json:"album,omitempty"`
		Aliases         []string                           `json:"aliases,omitempty"`
		ArtistHints     [][]string                         `json:"artist_hints,omitempty"`
		Credits         []string                           `json:"credits,omitempty"`
		PrimaryLangHint string                             `json:"primary_lang_hint"`
		UpstreamSamples []lyricPronunciationUpstreamSample `json:"upstream_samples,omitempty"`
		Lines           []promptLine                       `json:"lines"`
	}{
		Title:           input.Track.Name,
		Artists:         input.Track.Artists,
		Album:           input.Track.Album,
		Aliases:         input.Track.Aliases,
		ArtistHints:     input.ArtistHints,
		Credits:         input.Credits,
		PrimaryLangHint: input.SongLang,
		UpstreamSamples: input.UpstreamSamples,
		Lines:           lines,
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func isBopomofoRune(r rune) bool {
	return (r >= 0x3105 && r <= 0x312F) ||
		(r >= 0x31A0 && r <= 0x31BF) ||
		r == '˙' || r == 'ˊ' || r == 'ˇ' || r == 'ˋ'
}

func hasBopomofo(text string) bool {
	for _, r := range text {
		if (r >= 0x3105 && r <= 0x312F) || (r >= 0x31A0 && r <= 0x31BF) {
			return true
		}
	}
	return false
}

func isValidPronunciationText(pron, origVocal, lineLang string) bool {
	if pron == "" {
		return false
	}
	for _, r := range pron {
		if isBopomofoRune(r) {
			continue
		}
		if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) {
			return false
		}
	}
	if lineLang == "zh-tw" {
		stats, _ := countLyricScripts([]string{origVocal})
		if stats.han > 0 && stats.latin == 0 && !hasBopomofo(pron) {
			return false
		}
	}
	return true
}

func normalizePronunciationLang(raw, fallback string) string {
	trimmed := strings.TrimSpace(raw)
	if strings.EqualFold(trimmed, "other") {
		return "other"
	}
	switch lang := normalizeLyricLangTag(trimmed); lang {
	case "zh", "zh-tw", "zh-hk", "ja", "ko", "en":
		return lang
	default:
		if fallback != "" {
			return fallback
		}
		return "other"
	}
}

// resolvePronunciationRecordLang 根据最终各行读音语种汇总整首读音记录的归属语言
func resolvePronunciationRecordLang(lines []dto.MusicLyricPronunciationLine, fallback string) string {
	counts := make(map[string]int, 4)
	bestLang := ""
	bestCount := 0
	for _, line := range lines {
		lang := strings.TrimSpace(line.Lang)
		if lang == "" {
			continue
		}
		counts[lang]++
		if counts[lang] > bestCount {
			bestCount = counts[lang]
			bestLang = lang
		}
	}
	if bestLang != "" && (fallback == "" || counts[bestLang] > counts[fallback]) {
		return bestLang
	}
	if fallback != "" {
		return fallback
	}
	return "other"
}

func detectPronunciationSongLang(vocalTexts []string, samples []lyricPronunciationUpstreamSample) string {
	for _, s := range samples {
		if lyricJyutpingRe.MatchString(strings.ToLower(s.Pronunciation)) {
			return "zh-hk"
		}
		if hasBopomofo(s.Pronunciation) {
			return "zh-tw"
		}
	}
	lang := detectLyricTextLang(vocalTexts, "")
	if lang == "" {
		return "other"
	}
	return lang
}

func detectPronunciationLineLang(vocalText, roman, songLang string) string {
	if hasBopomofo(roman) {
		return "zh-tw"
	}
	if lyricJyutpingRe.MatchString(strings.ToLower(roman)) {
		return "zh-hk"
	}
	if detected := detectLyricTextLang([]string{vocalText}, ""); detected != "" {
		return detected
	}
	if songLang != "" {
		return songLang
	}
	return "other"
}

func hasPronounceableRune(text string) bool {
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return true
		}
	}
	return false
}

func collapseWordSpaces(words []string) []string {
	out := make([]string, 0, len(words))
	for _, w := range words {
		normalized := whitespaceRe.ReplaceAllString(w, " ")
		if normalized != "" {
			out = append(out, normalized)
		}
	}
	first, last := 0, len(out)
	for first < last && out[first] == " " {
		first++
	}
	for last > first && out[last-1] == " " {
		last--
	}
	return out[first:last]
}

func filterPronounceableTokens(words []string) []string {
	cleaned := collapseWordSpaces(words)
	var tokens []string
	for _, w := range cleaned {
		if hasPronounceableRune(w) {
			tokens = append(tokens, strings.TrimSpace(w))
		}
	}
	return tokens
}

// parseTTMLPronunciationLines 解析 TTML 各行（与前端 parse-ttml.ts / preprocess.ts 一致的可发音词元数组与 x-roman 音译提取）
// parseTTMLPronunciationLines 解析 TTML 各行（复用 parseTTMLRichDoc，保持与前端一致的可发音词元数组与 x-roman 音译提取）
func parseTTMLPronunciationLines(raw string) ([]lyricPronunciationExtracted, []string, bool) {
	doc := parseTTMLRichDoc(raw)
	if doc == nil {
		return nil, nil, false
	}
	var credits []string
	seenCredits := map[string]bool{}
	for _, sw := range doc.Songwriters {
		credits = appendPronunciationCredit(credits, seenCredits, sw)
	}
	for _, cl := range doc.CreditLines {
		credits = appendPronunciationCredit(credits, seenCredits, cl)
	}
	out := make([]lyricPronunciationExtracted, 0, min(len(doc.Lines), lyricAnnotationMaxLines))
	for _, line := range doc.Lines {
		rawWords := collapseWordSpaces(line.Words)
		tokens := filterPronounceableTokens(line.Words)
		if len(line.Words) == 0 && line.Text != "" {
			rawWords = collapseWordSpaces([]string{line.Text})
			tokens = filterPronounceableTokens([]string{line.Text})
		}
		roman := line.OwnRoman
		if !isValidNativeRomanText(line.Text, roman) {
			roman = ""
		}
		out = append(out, lyricPronunciationExtracted{
			Start:    line.Start,
			Text:     line.Text,
			Bg:       line.Bg,
			RawWords: rawWords,
			Tokens:   tokens,
			OwnRoman: roman,
		})
		if len(out) >= lyricAnnotationMaxLines {
			break
		}
	}
	return out, credits, doc.WordTimed
}

// parsePlatformPronunciationLines 解析 YRC / QRC(KRC) / LRC，抽取出与前端 parse-platform.ts 一致的可发音词元与原生音译
func parsePlatformPronunciationLines(
	raw string,
	romanRaw string,
	wordMode string, // "yrc" | "qrc"
	wordTimed bool,
	track *dto.MusicTrackDto,
) ([]lyricPronunciationExtracted, []string) {
	type parsedRow struct {
		start    int64
		text     string
		rawWords []string
		tokens   []string
	}
	var rows []parsedRow
	for _, rawLine := range strings.Split(raw, "\n") {
		line := strings.TrimSpace(rawLine)
		head := lyricLineHeadRe.FindString(line)
		if head == "" {
			continue
		}
		body := line[len(head):]
		text := collapseLyricSpace(lyricWordTagRe.ReplaceAllString(body, ""))
		if text == "" || text == "no_lyric" || text == "pure_music_without_lyric" {
			continue
		}
		if runes := []rune(text); len(runes) > lyricTranslationMaxLineRunes {
			text = string(runes[:lyricTranslationMaxLineRunes])
		}
		var rawWords, tokens []string
		if wordTimed {
			extractedWords := extractPlatformWordTokens(body, wordMode)
			rawWords = collapseWordSpaces(extractedWords)
			tokens = filterPronounceableTokens(extractedWords)
		}
		for _, start := range extractHeadStarts(head) {
			rows = append(rows, parsedRow{start: start, text: text, rawWords: rawWords, tokens: tokens})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].start < rows[j].start })
	if len(rows) == 0 {
		return nil, nil
	}

	texts := make([]string, len(rows))
	for i, r := range rows {
		texts[i] = r.text
	}
	credits := collectPlatformCreditLines(texts, track)
	head, tail := lyricCreditRange(texts, track.Name, track.Artists)
	rows = rows[head:tail]
	if len(rows) == 0 {
		return nil, credits
	}

	timed := make([]lyricTimedLine, len(rows))
	for i, r := range rows {
		timed[i] = lyricTimedLine{Start: r.start, Text: r.text}
	}
	alignedRoman := alignExpandedTranslations(timed, romanRaw)

	out := make([]lyricPronunciationExtracted, len(rows))
	for i, r := range rows {
		ownRoman := ""
		if i < len(alignedRoman) && isValidNativeRomanText(r.text, alignedRoman[i]) {
			ownRoman = alignedRoman[i]
		}
		out[i] = lyricPronunciationExtracted{
			Start:    r.start,
			Text:     r.text,
			RawWords: r.rawWords,
			Tokens:   r.tokens,
			OwnRoman: ownRoman,
		}
	}
	return out, credits
}

func extractPlatformWordTokens(body, mode string) []string {
	var words []string
	switch mode {
	case "yrc":
		locs := lyricYrcSplitRe.FindAllStringIndex(body, -1)
		for i, loc := range locs {
			end := len(body)
			if i+1 < len(locs) {
				end = locs[i+1][0]
			}
			wordText := body[loc[1]:end]
			if wordText != "" {
				words = append(words, wordText)
			}
		}
	case "qrc":
		matches := lyricQrcWordRe.FindAllStringSubmatch(body, -1)
		for _, m := range matches {
			if m[1] != "" {
				words = append(words, m[1])
			}
		}
	}
	return words
}

func parseLyricPronunciationLines(raw string) []dto.MusicLyricPronunciationLine {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var lines []dto.MusicLyricPronunciationLine
	_ = json.Unmarshal([]byte(raw), &lines)
	return lines
}

// enrichCachedPronunciationLines 对数据库中旧缓存缺失逐音节 Tokens 的逐字歌词行按自然词组与音节规则动态补齐，免重跑 AI 立即生效
func enrichCachedPronunciationLines(
	lines []dto.MusicLyricPronunciationLine,
	input *lyricPronunciationInput,
) []dto.MusicLyricPronunciationLine {
	if len(lines) == 0 || input == nil || !input.WordTimed || len(input.RawWordsByKey) == 0 {
		return lines
	}
	for i := range lines {
		if len(lines[i].Tokens) > 0 || strings.TrimSpace(lines[i].Pronunciation) == "" {
			continue
		}
		lk := lyricPronLineKey{bg: lines[i].Bg, occ: lines[i].Occurrence, norm: normalizeLyricMatch(lines[i].Text)}
		rawWords := input.RawWordsByKey[lk]
		if len(rawWords) == 0 {
			continue
		}
		tokens := filterPronounceableTokens(rawWords)
		if len(tokens) == 0 {
			continue
		}
		if aligned := alignPronunciationToRawWords(rawWords, tokens, nil, lines[i].Pronunciation, lines[i].Text, lines[i].Lang); len(aligned) == len(tokens) {
			lines[i].Tokens = aligned
		}
	}
	return lines
}

// formatSyllableMapHint 当逐字词元存在词内拆分或跨词粘连时生成紧凑结构提示（如 "The whi·s·per·[s and] se·crets"）；无词内拆分时返回空串
func formatSyllableMapHint(rawWords []string) string {
	if len(rawWords) == 0 {
		return ""
	}
	type item struct {
		text       string
		leadSpace  bool
		trailSpace bool
		hasInSpace bool
	}
	var items []item
	pendingSpace := true
	for _, rw := range rawWords {
		if rw == "" {
			continue
		}
		trimmed := strings.TrimSpace(rw)
		if trimmed == "" {
			pendingSpace = true
			continue
		}
		var firstRune, lastRune rune
		for idx, r := range rw {
			if idx == 0 {
				firstRune = r
			}
			lastRune = r
		}
		lead := pendingSpace || unicode.IsSpace(firstRune)
		trail := unicode.IsSpace(lastRune)
		pendingSpace = false
		if !hasPronounceableRune(trimmed) {
			if trail {
				pendingSpace = true
			}
			continue
		}
		hasInner := strings.ContainsFunc(trimmed, unicode.IsSpace)
		items = append(items, item{
			text:       trimmed,
			leadSpace:  lead,
			trailSpace: trail,
			hasInSpace: hasInner,
		})
		if trail {
			pendingSpace = true
		}
	}
	if len(items) == 0 {
		return ""
	}
	hasSpecial := false
	var b strings.Builder
	for i, it := range items {
		if i > 0 {
			if !it.leadSpace && !containsPronCJK(items[i-1].text) && !containsPronCJK(it.text) {
				b.WriteRune('·')
				hasSpecial = true
			} else {
				b.WriteByte(' ')
			}
		}
		if it.hasInSpace {
			b.WriteByte('[')
			b.WriteString(it.text)
			b.WriteByte(']')
			hasSpecial = true
		} else {
			b.WriteString(it.text)
		}
	}
	if !hasSpecial {
		return ""
	}
	return b.String()
}

type pronSurfaceFragment struct {
	tokenPos int
	text     string
	letters  []rune
	weight   int
	hasVowel bool
}

type pronSurfaceWord struct {
	joinedText string
	fragments  []pronSurfaceFragment
}

func containsPronCJK(s string) bool {
	for _, r := range s {
		if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) {
			return true
		}
	}
	return false
}

func isPureHanString(s string) bool {
	has := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			continue
		}
		if !unicode.Is(unicode.Han, r) {
			return false
		}
		has = true
	}
	return has
}

func stripPronEdgePunct(s string) string {
	runes := []rune(s)
	start, end := 0, len(runes)
	isEdge := func(r rune) bool {
		if r == 0x02D9 || r == 'ˈ' || r == 'ˌ' {
			return false
		}
		return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
	}
	for start < end && isEdge(runes[start]) {
		start++
	}
	for end > start && isEdge(runes[end-1]) {
		end--
	}
	return string(runes[start:end])
}

// alignPronunciationToRawWords 将整句或按自然词输出的读音确定性映射回歌词源的逐音节 Tokens：
// 1. 纯汉字多字词元（如 ["五陵","年","少"]）按每字一音节归并
// 2. 拉丁/外语多音节拆分与跨词粘连词元（如 ["whi","s","per","s and"]、法语连诵 ‿ 与音节符 .）按自然词边界归组后再拆回各音节槽位
func alignPronunciationToRawWords(
	rawWords []string,
	expectedTokens []string,
	rawItemTokens []string,
	fallbackPron string,
	origVocal string,
	lineLang string,
) []string {
	n := len(expectedTokens)
	if n == 0 {
		return nil
	}

	validateAll := func(candidate []string) []string {
		if len(candidate) != n {
			return nil
		}
		nonEmpty := 0
		out := make([]string, n)
		for i, c := range candidate {
			cleaned := collapseLyricSpace(c)
			if cleaned != "" {
				if !isValidPronunciationText(cleaned, origVocal, lineLang) {
					return nil
				}
				nonEmpty++
			}
			out[i] = cleaned
		}
		if nonEmpty == 0 {
			return nil
		}
		return out
	}

	// 1. 纯汉字多字 span（按汉字字数归并空格分隔的拼音/粤拼/注音音节）
	allHan := true
	totalHan := 0
	hanCounts := make([]int, n)
	for i, tok := range expectedTokens {
		if !isPureHanString(tok) {
			allHan = false
			break
		}
		cnt := 0
		for _, r := range tok {
			if unicode.Is(unicode.Han, r) {
				cnt++
			}
		}
		hanCounts[i] = cnt
		totalHan += cnt
	}
	if allHan && totalHan > 0 {
		fields := strings.Fields(fallbackPron)
		if len(fields) == totalHan {
			grouped := make([]string, n)
			cursor := 0
			for i, cnt := range hanCounts {
				grouped[i] = strings.Join(fields[cursor:cursor+cnt], " ")
				cursor += cnt
			}
			if v := validateAll(grouped); v != nil {
				return v
			}
		}
	}

	// 2. 基于原始词元空格边界重建自然单词序列（支持拆解 "s and" 等含内部空格的跨词词元）
	if len(rawWords) == 0 {
		return nil
	}
	surfaceWords := buildPronSurfaceWords(rawWords)
	if len(surfaceWords) == 0 {
		return nil
	}

	pronUnits := matchPronUnitsToSurfaceWords(surfaceWords, rawItemTokens, fallbackPron)
	if len(pronUnits) != len(surfaceWords) {
		return nil
	}

	slotParts := make([][]string, n)
	for wIdx, sw := range surfaceWords {
		pieces := splitPronUnitAcrossFragments(pronUnits[wIdx], sw.fragments)
		for fIdx, frag := range sw.fragments {
			if frag.tokenPos >= 0 && frag.tokenPos < n && fIdx < len(pieces) && pieces[fIdx] != "" {
				slotParts[frag.tokenPos] = append(slotParts[frag.tokenPos], pieces[fIdx])
			}
		}
	}

	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = strings.Join(slotParts[i], " ")
	}
	return validateAll(out)
}

func buildPronSurfaceWords(rawWords []string) []pronSurfaceWord {
	var words []pronSurfaceWord
	var curFrags []pronSurfaceFragment
	var curBuilder strings.Builder
	var prevChunk string
	prevEndedSpace := true
	tokenPos := -1

	flushWord := func() {
		if len(curFrags) > 0 {
			words = append(words, pronSurfaceWord{
				joinedText: curBuilder.String(),
				fragments:  curFrags,
			})
			curFrags = nil
			curBuilder.Reset()
		}
	}

	for _, rw := range rawWords {
		if rw == "" {
			continue
		}
		if strings.TrimSpace(rw) == "" {
			prevEndedSpace = true
			continue
		}
		hasPron := hasPronounceableRune(rw)
		if hasPron {
			tokenPos++
		}
		runes := []rune(rw)
		idx := 0
		for idx < len(runes) {
			if unicode.IsSpace(runes[idx]) {
				prevEndedSpace = true
				for idx < len(runes) && unicode.IsSpace(runes[idx]) {
					idx++
				}
				continue
			}
			start := idx
			for idx < len(runes) && !unicode.IsSpace(runes[idx]) {
				idx++
			}
			chunk := string(runes[start:idx])
			chunkTrailSpace := idx < len(runes) && unicode.IsSpace(runes[idx])

			if !hasPronounceableRune(chunk) {
				if chunkTrailSpace {
					prevEndedSpace = true
				}
				continue
			}

			canContinue := !prevEndedSpace && len(curFrags) > 0 && !containsPronCJK(prevChunk) && !containsPronCJK(chunk)
			if !canContinue {
				flushWord()
			}
			var letters []rune
			hasVowel := false
			for _, r := range chunk {
				if unicode.IsLetter(r) || unicode.IsNumber(r) {
					letters = append(letters, unicode.ToLower(r))
					if isSourceVowelRune(r) {
						hasVowel = true
					}
				}
			}
			weight := len(letters)
			if weight < 1 {
				weight = 1
			}
			curBuilder.WriteString(chunk)
			curFrags = append(curFrags, pronSurfaceFragment{
				tokenPos: tokenPos,
				text:     chunk,
				letters:  letters,
				weight:   weight,
				hasVowel: hasVowel,
			})
			prevChunk = chunk
			prevEndedSpace = chunkTrailSpace
		}
	}
	flushWord()
	return words
}

func matchPronUnitsToSurfaceWords(
	surfaceWords []pronSurfaceWord,
	rawItemTokens []string,
	fallbackPron string,
) []string {
	target := len(surfaceWords)
	cleanList := func(items []string) []string {
		var out []string
		for _, it := range items {
			c := stripPronEdgePunct(it)
			if c != "" {
				out = append(out, c)
			}
		}
		return out
	}

	if len(rawItemTokens) > 0 {
		if cleaned := cleanList(rawItemTokens); len(cleaned) == target {
			return cleaned
		}
	}

	wsFields := cleanList(strings.Fields(fallbackPron))
	if len(wsFields) == target {
		return wsFields
	}

	// 法语等连诵语言常将两个独立单词用连诵弧 ‿ (\u203F / \u0361 / \u035C) 连成一项，按非连字符自然词槽位按需拆开
	if len(wsFields) > 0 && len(wsFields) < target {
		expanded := expandLiaisonUnits(wsFields, surfaceWords)
		if len(expanded) == target {
			return expanded
		}
	}
	return nil
}

func isLiaisonTieRune(r rune) bool {
	return r == '‿' || r == '\u0361' || r == '\u035c'
}

func expandLiaisonUnits(wsFields []string, surfaceWords []pronSurfaceWord) []string {
	target := len(surfaceWords)
	var out []string
	for i, field := range wsFields {
		curWordIdx := len(out)
		remainingFields := len(wsFields) - i - 1
		remainingNeeded := target - curWordIdx
		if curWordIdx < target && remainingNeeded > remainingFields+1 && strings.ContainsFunc(field, isLiaisonTieRune) && !strings.ContainsRune(surfaceWords[curWordIdx].joinedText, '-') {
			parts := strings.FieldsFunc(field, isLiaisonTieRune)
			for _, p := range parts {
				if c := stripPronEdgePunct(p); c != "" {
					out = append(out, c)
				}
			}
		} else {
			out = append(out, field)
		}
	}
	return out
}

func splitPronUnitAcrossFragments(pronUnit string, frags []pronSurfaceFragment) []string {
	k := len(frags)
	if k == 0 {
		return nil
	}
	if k == 1 {
		return []string{stripPronEdgePunct(pronUnit)}
	}

	// 1. 若 IPA / 罗马音本身含有显式音节分隔点 `.`（如 "sy.fi"、"sə.ʁɛ.t‿il"），优先按音节段对齐
	if strings.ContainsRune(pronUnit, '.') {
		rawDotParts := strings.Split(pronUnit, ".")
		var dotParts []string
		for _, p := range rawDotParts {
			if c := stripPronEdgePunct(p); c != "" {
				dotParts = append(dotParts, c)
			}
		}
		allHaveVowel := len(dotParts) > 0
		for _, dp := range dotParts {
			if !unitHasVowelSound(dp) {
				allHaveVowel = false
				break
			}
		}
		if allHaveVowel {
			if len(dotParts) == k {
				return dotParts
			}
			if len(dotParts) > k {
				return distributeUnitsAcrossFragments(dotParts, frags, ".")
			}
		}
	}

	// 2. 法语/英语静音词尾单段（如 ["dou","x"] -> "du"、["vie","s"] -> "vi"、["mon","de"] -> "mɔ̃"）
	cleanedUnit := stripPronEdgePunct(pronUnit)
	if k == 2 && frags[0].weight >= 2 && isSilentTailCandidate(string(frags[1].letters)) && endsWithVowelSound(cleanedUnit) {
		return []string{cleanedUnit, ""}
	}

	// 3. 按音素簇（重音号前附、组合变音符/长音号后附）与源音节元音核对齐切分
	clusters := splitPhonemeClusters(cleanedUnit)
	if len(clusters) == 0 {
		return make([]string, k)
	}
	if len(clusters) <= k {
		out := make([]string, k)
		for i := 0; i < len(clusters); i++ {
			out[i] = clusters[i]
		}
		return out
	}
	return distributeUnitsAcrossFragments(clusters, frags, "")
}

func distributeUnitsAcrossFragments(units []string, frags []pronSurfaceFragment, joinSep string) []string {
	n := len(units)
	k := len(frags)
	totalW := 0
	for _, f := range frags {
		totalW += f.weight
	}
	if totalW <= 0 {
		totalW = k
	}

	out := make([]string, k)
	cursor := 0
	cumW := 0
	for j := 0; j < k-1; j++ {
		cumW += frags[j].weight
		minEnd := cursor + 1
		maxEnd := n - (k - 1 - j)
		if minEnd > maxEnd {
			minEnd = maxEnd
		}
		ideal := (n*cumW + totalW/2) / totalW
		end := min(max(ideal, minEnd), maxEnd)

		if joinSep == "" {
			// 若当前源片段无元音字母（如独立辅音 span "s" / "d"）且当前音素簇也不含元音，仅取单个辅音簇
			if !frags[j].hasVowel && !unitSliceHasVowel(units[cursor:minEnd]) {
				end = minEnd
			} else {
				// 若当前源片段含元音而切分结果尚无元音、且下一簇即为元音，向后吸纳该元音核
				if frags[j].hasVowel && !unitSliceHasVowel(units[cursor:end]) && end < maxEnd && unitHasVowelSound(units[end]) {
					end++
				}
				// 若下一源片段是纯辅音尾且剩余音素簇不足以覆盖后续源字母权重（如 "whi"+"s"+"per"+"s"），避免多吞走尾部辅音
				remWeight := totalW - cumW
				if !frags[j+1].hasVowel && (n-end) < remWeight && end > minEnd && unitSliceHasVowel(units[cursor:end-1]) && !unitHasVowelSound(units[end-1]) {
					end--
				}
				// 避免紧贴重音号前簇把 ˈC 与其元音拆散
				if end > minEnd && strings.HasPrefix(units[end-1], "ˈ") && !unitHasVowelSound(units[end-1]) && end < maxEnd {
					if unitSliceHasVowel(units[cursor : end-1]) {
						end--
					} else {
						end++
					}
				}
			}
		}

		out[j] = strings.Join(units[cursor:end], joinSep)
		cursor = end
	}
	out[k-1] = strings.Join(units[cursor:], joinSep)
	return out
}

func splitPhonemeClusters(s string) []string {
	runes := []rune(s)
	var clusters []string
	var prefix strings.Builder
	i := 0
	for i < len(runes) {
		r := runes[i]
		if r == '.' || unicode.IsSpace(r) {
			i++
			continue
		}
		if r == 'ˈ' || r == 'ˌ' || r == '\'' {
			prefix.WriteRune(r)
			i++
			continue
		}
		var cluster strings.Builder
		if prefix.Len() > 0 {
			cluster.WriteString(prefix.String())
			prefix.Reset()
		}
		cluster.WriteRune(r)
		i++
		for i < len(runes) {
			nr := runes[i]
			if unicode.Is(unicode.Mn, nr) || unicode.Is(unicode.Mc, nr) || nr == 'ː' || nr == 'ˑ' || nr == '˞' || nr == 'ʰ' || nr == 'ʷ' || nr == 'ʲ' || isLiaisonTieRune(nr) {
				cluster.WriteRune(nr)
				i++
				if isLiaisonTieRune(nr) && i < len(runes) {
					cluster.WriteRune(runes[i])
					i++
				}
				continue
			}
			break
		}
		clusters = append(clusters, cluster.String())
	}
	if prefix.Len() > 0 && len(clusters) > 0 {
		clusters[len(clusters)-1] += prefix.String()
	}
	return clusters
}

func isSilentTailCandidate(lowerLetters string) bool {
	switch lowerLetters {
	case "e", "es", "s", "x", "z", "t", "d", "p", "ts", "ds":
		return true
	default:
		return false
	}
}

func isSourceVowelRune(r rune) bool {
	switch unicode.ToLower(r) {
	case 'a', 'e', 'i', 'o', 'u', 'y',
		'à', 'á', 'â', 'ã', 'ä', 'å', 'æ',
		'è', 'é', 'ê', 'ë',
		'ì', 'í', 'î', 'ï',
		'ò', 'ó', 'ô', 'õ', 'ö', 'ø', 'œ',
		'ù', 'ú', 'û', 'ü', 'ÿ':
		return true
	default:
		return false
	}
}

func isPhoneticVowelRune(r rune) bool {
	if isSourceVowelRune(r) {
		return true
	}
	switch r {
	case 'ɑ', 'ɒ', 'ɔ', 'ə', 'ɚ', 'ɛ', 'ɜ', 'ɝ', 'ɪ', 'ɨ', 'ʊ', 'ʉ', 'ʌ', 'ɯ', 'ɤ', 'ɐ', 'ɶ', 'ʏ', 'ø', 'œ':
		return true
	default:
		return false
	}
}

func unitHasVowelSound(unit string) bool {
	for _, r := range unit {
		if isPhoneticVowelRune(r) {
			return true
		}
	}
	return false
}

func unitSliceHasVowel(units []string) bool {
	for _, u := range units {
		if unitHasVowelSound(u) {
			return true
		}
	}
	return false
}

func endsWithVowelSound(s string) bool {
	var lastBase rune
	for _, r := range s {
		if unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Mc, r) || r == 'ː' || r == 'ˑ' || r == '˞' {
			continue
		}
		lastBase = r
	}
	return lastBase != 0 && isPhoneticVowelRune(lastBase)
}
