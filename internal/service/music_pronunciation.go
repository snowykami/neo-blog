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
	lyricPronunciationMaxLines        = 320
	lyricPronunciationFirstChunkLines = 25
	lyricPronunciationChunkLines      = 25
	lyricPronunciationMaxChunks       = 14
	lyricPronunciationMaxBgWorkers    = 3
	lyricPronunciationMaxRetries      = 1
	lyricPronunciationTimeout         = 2 * time.Minute
	lyricPronunciationJobTTL          = 5 * time.Minute
	lyricPronunciationRetryAfter      = 5 * time.Minute
	lyricPronunciationTemperature     = 0.15
	lyricPronunciationReasoning       = "none"
	lyricPronunciationWriteLockTTL    = 20 * time.Second
)

var (
	lyricJyutpingRe    = regexp.MustCompile(`\b[a-z]{1,6}[1-6]\b`)
	lyricYrcSplitRe    = regexp.MustCompile(`\(\d+,\d+,\d+\)`)
	lyricQrcWordRe     = regexp.MustCompile(`([\s\S]*?)\((\d+),(\d+)\)`)
	cantoneseParticles = runeSetFromString("嘅咗喺冇係唔啲嚟咁乜咩仲畀揾搵睇佢哋")
	hokkienChars       = runeSetFromString("袂毋𨑨迌佇囥")
	hokkienSubstrings  = []string{"啥物", "歹势", "歹勢", "仝款", "按怎", "家己", "毋知", "袂晓", "袂曉", "佗位", "叨位"}
	taiwanOriginHints  = []string{
		"周杰伦", "周杰倫", "jay chou", "方文山", "田馥甄", "hebe tien", "s.h.e", "陈嘉桦", "陳嘉樺", "任家萱",
		"潘安邦", "叶佳修", "葉佳修", "罗大佑", "羅大祐", "李宗盛", "陈昇", "陳昇", "陈升", "伍佰",
		"张惠妹", "張惠妹", "a-mei", "五月天", "mayday", "陈信宏", "陳信宏", "蔡依林", "jolin tsai",
		"苏打绿", "蘇打綠", "鱼丁糸", "魚丁糸", "吴青峰", "吳青峰", "陈绮贞", "陳綺貞", "张雨生", "張雨生",
		"张信哲", "張信哲", "张韶涵", "張韶涵", "王心凌", "萧敬腾", "蕭敬騰", "林宥嘉", "卢广仲", "盧廣仲",
		"告五人", "草东没有派对", "草東沒有派對", "茄子蛋", "陶喆", "david tao", "齐秦", "齊秦", "蔡琴",
		"费玉清", "費玉清", "邓丽君", "鄧麗君", "刘若英", "劉若英", "徐佳莹", "徐佳瑩", "韦礼安", "韋禮安",
		"杨丞琳", "楊丞琳", "范玮琪", "范瑋琪", "郭静", "郭靜", "周华健", "周華健", "任贤齐", "任賢齊",
		"张震岳", "張震嶽", "mc hotdog", "热狗", "熱狗", "顽童mj116", "頑童mj116", "周兴哲", "周興哲",
		"动力火车", "動力火車", "飞儿乐团", "飛兒樂團", "f.i.r.", "信乐团", "信樂團", "八三夭",
		"落日飞车", "落日飛車", "甜约翰", "甜約翰", "脆乐团", "脆樂團", "魏如萱", "艾怡良",
		"万芳", "萬芳", "辛晓琪", "辛曉琪", "许茹芸", "許茹芸", "林志炫", "庾澄庆", "庾澄慶",
		"黄丽玲", "黃麗玲", "a-lin", "徐世珍", "姚若龙", "姚若龍", "施人诚", "施人誠", "葛大为", "葛大為",
		"陈小霞", "陳小霞", "吴辉福", "吳輝福", "jerryc",
		"杰威尔", "杰威爾", "jvr music", "华研国际", "華研國際", "滚石国际", "滾石國際", "rock records",
		"相信音乐", "相信音樂", "添翼创越", "添翼創越", "亚神音乐", "亞神音樂", "福茂唱片", "丰华唱片", "豐華唱片", "飞碟唱片", "飛碟唱片",
		"小幸运", "小幸運", "外婆的澎湖湾", "外婆的澎湖灣", "孤儿乐园", "孤兒樂園", "澎湖湾", "澎湖灣", "忠孝东路", "忠孝東路", "鹿港小镇", "鹿港小鎮",
	}
)

type lyricPronunciationService struct {
	name        string
	initOnce    sync.Once
	mu          sync.Mutex
	limiter     *llmclient.Limiter
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
	done        func()
}

var lyricPronunciations = &lyricPronunciationService{
	name:    "lyric_pronunciation",
	limiter: llmclient.DefaultLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricPronunciationTemperature, lyricPronunciationReasoning)
	},
	concurrency: tools.GetAISummaryConcurrency,
}

type lyricPronunciationExtracted struct {
	Start         int64
	Text          string
	Bg            bool
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
	TaiwanOrigin     bool
	ArtistHints      [][]string
	Credits          []string
	CompleteUpstream bool
	BorrowedLines    []dto.MusicLyricPronunciationLine
	UpstreamSamples  []lyricPronunciationUpstreamSample
	Tasks            []lyricPronunciationTask
}

type lyricPronunciationAIResp struct {
	Items []struct {
		I             int      `json:"i"`
		Lang          string   `json:"lang"`
		Pronunciation string   `json:"pronunciation"`
		Tokens        []string `json:"tokens"`
	} `json:"items"`
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
	if id <= 0 || (source != "" && !lyricSettingSources[source]) {
		return nil, "", nil, errs.NewBadRequest("invalid_request_parameters")
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
		return nil, "", nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	if source != "" {
		return track, source, nil, nil
	}
	version, svcerr := s.siteLyricVersion(withLyricVersionWait(ctx, lyricVersionPollWait), id)
	if svcerr != nil {
		if svcerr == errLyricVersionPending {
			return nil, "", &dto.MusicLyricPronunciationsDto{
				Status: lyricTranslationStatusPending,
				Lines:  []dto.MusicLyricPronunciationLine{},
			}, nil
		}
		return nil, "", nil, svcerr
	}
	if version == nil || version.Lines == nil {
		return nil, "", nil, errs.NewNotFound("lyric_not_found")
	}
	return track, version.Lines.Source, nil, nil
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
	hashBuilder.WriteString("v2:")
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

		vocalText, skip := classifyLyricVocalLine(line.Text, track.Artists)
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
	taiwanOrigin := hasTaiwanOriginHint(track, hints.ArtistHints, credits)
	songLang := detectPronunciationSongLang(vocalTexts, upstreamSamples, taiwanOrigin)
	var (
		tasks         []lyricPronunciationTask
		borrowedLines []dto.MusicLyricPronunciationLine
		ownRomanCount int
	)

	for _, c := range candidates {
		if c.skip {
			continue
		}
		if c.extracted.OwnRoman != "" {
			ownRomanCount++
			continue
		}
		if c.extracted.BorrowedRoman != "" {
			lineLang := detectPronunciationLineLang(c.vocal, c.extracted.BorrowedRoman, songLang)
			borrowedLines = append(borrowedLines, dto.MusicLyricPronunciationLine{
				Text:          c.extracted.Text,
				Occurrence:    c.occ,
				Bg:            c.extracted.Bg,
				Lang:          lineLang,
				Pronunciation: c.extracted.BorrowedRoman,
			})
			continue
		}
		var tokens []string
		if wordTimed {
			tokens = c.extracted.Tokens
		}
		tasks = append(tasks, lyricPronunciationTask{
			Index:      len(tasks) + 1,
			OrigText:   c.extracted.Text,
			VocalText:  c.vocal,
			Occurrence: c.occ,
			Bg:         c.extracted.Bg,
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
		TaiwanOrigin:     taiwanOrigin,
		ArtistHints:      hints.ArtistHints,
		Credits:          credits,
		CompleteUpstream: completeUpstream,
		BorrowedLines:    borrowedLines,
		UpstreamSamples:  upstreamSamples,
		Tasks:            tasks,
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

func (a *lyricPronunciationService) stateKey(input *lyricPronunciationInput) string {
	return strconv.FormatInt(input.Track.ID, 10) + ":" + input.Source + ":" + input.LyricHash
}

func (a *lyricPronunciationService) stateKeys(key string) (job, failed string) {
	return a.prefix() + ":job:" + key, a.prefix() + ":failed:" + key
}

func (a *lyricPronunciationService) partialKey(key string) string {
	return a.prefix() + ":partial:" + key
}

func (a *lyricPronunciationService) savePartial(key string, lines []dto.MusicLyricPronunciationLine) {
	if key == "" || len(lines) == 0 {
		return
	}
	if err := sharedstate.SetJSON(a.partialKey(key), lines, lyricPronunciationTimeout+time.Minute); err != nil {
		logrus.Warnf("save partial lyric pronunciation %s: %v", key, err)
	}
}

func (a *lyricPronunciationService) loadPartial(key string) []dto.MusicLyricPronunciationLine {
	if key == "" {
		return nil
	}
	var lines []dto.MusicLyricPronunciationLine
	found, err := sharedstate.GetJSON(a.partialKey(key), &lines)
	if err != nil || !found {
		return nil
	}
	return lines
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
		lines := parseLyricPronunciationLines(record.Data)
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
		lines := a.loadPartial(key)
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
		lines := parseLyricPronunciationLines(record.Data)
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
	go a.execute(lease, key, input, cfg)
}

func (a *lyricPronunciationService) execute(lease *sharedstate.Lease, key string, input *lyricPronunciationInput, cfg tools.AIConfig) {
	var jobErr error
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("lyric pronunciation panic for song %d (%s): %v", input.Track.ID, input.Source, r)
			jobErr = fmt.Errorf("panic: %v", r)
		}
		if jobErr != nil {
			_, failedKey := a.stateKeys(key)
			_ = sharedstate.Current().Set(failedKey, "1", lyricPronunciationRetryAfter)
		}
		_ = sharedstate.Current().Delete(a.partialKey(key))
		lease.Release()
		if a.done != nil {
			a.done()
		}
	}()

	lines, err := a.generateWithPartial(key, cfg, input)
	if err != nil {
		logrus.Warnf("lyric pronunciation failed for song %d (%s): %v", input.Track.ID, input.Source, err)
		jobErr = err
		return
	}
	combined := append([]dto.MusicLyricPronunciationLine(nil), input.BorrowedLines...)
	combined = append(combined, lines...)
	encoded, _ := json.Marshal(combined)
	record := &model.LyricPronunciation{
		SongID:    input.Track.ID,
		Source:    input.Source,
		LyricHash: input.LyricHash,
		Lang:      resolvePronunciationRecordLang(combined, input.SongLang),
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
	}
}

func (a *lyricPronunciationService) callTier(cfg tools.AIConfig, tier llmclient.PriorityTier, system, user string) (string, error) {
	_ = a.limiter.AcquireTier(context.Background(), a.concurrency, tier, nil)
	defer a.limiter.Release()
	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeTranslation, 0), lyricPronunciationTimeout)
	defer cancel()
	return a.complete(ctx, cfg, system, user)
}

func (a *lyricPronunciationService) generateWithPartial(key string, cfg tools.AIConfig, input *lyricPronunciationInput) ([]dto.MusicLyricPronunciationLine, error) {
	chunks := splitPronunciationChunks(input.Tasks)
	if len(chunks) == 0 {
		return []dto.MusicLyricPronunciationLine{}, nil
	}
	system := buildPronunciationSystemPrompt(input.WordTimed, input.SongLang, input.TaiwanOrigin)

	chunkResults := make([][]dto.MusicLyricPronunciationLine, len(chunks))
	chunk0, err := a.generateChunk(cfg, llmclient.TierFirstScreen, system, input, chunks[0])
	if err != nil {
		return nil, err
	}
	chunkResults[0] = chunk0
	if len(chunks) > 1 {
		partial := append([]dto.MusicLyricPronunciationLine(nil), input.BorrowedLines...)
		partial = append(partial, chunk0...)
		a.savePartial(key, partial)
	}

	if len(chunks) > 1 {
		errsCh := make(chan error, len(chunks)-1)
		sem := make(chan struct{}, lyricPronunciationMaxBgWorkers)
		var wg sync.WaitGroup
		for cIdx := 1; cIdx < len(chunks); cIdx++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				res, chunkErr := a.generateChunk(cfg, llmclient.TierBackground, system, input, chunks[idx])
				if chunkErr != nil {
					errsCh <- chunkErr
					return
				}
				chunkResults[idx] = res
			}(cIdx)
		}
		wg.Wait()
		close(errsCh)
		if firstErr := <-errsCh; firstErr != nil {
			return nil, firstErr
		}
	}

	out := make([]dto.MusicLyricPronunciationLine, 0, len(input.Tasks))
	for _, part := range chunkResults {
		out = append(out, part...)
	}
	return out, nil
}

func (a *lyricPronunciationService) generateChunk(
	cfg tools.AIConfig,
	tier llmclient.PriorityTier,
	system string,
	input *lyricPronunciationInput,
	tasks []lyricPronunciationTask,
) ([]dto.MusicLyricPronunciationLine, error) {
	baseUser := buildPronunciationUserPrompt(input, tasks)
	user := baseUser
	var lastErr error

	for attempt := 0; attempt <= lyricPronunciationMaxRetries; attempt++ {
		raw, err := a.callTier(cfg, tier, system, user)
		if err == nil {
			lines, wrongScript, parseErr := parseAndValidatePronunciationResp(raw, tasks, input.WordTimed, input.SongLang, input.TaiwanOrigin)
			if parseErr == nil {
				if !wrongScript || attempt >= lyricPronunciationMaxRetries {
					return lines, nil
				}
				user = baseUser + "\nCRITICAL RETRY NOTICE: Your previous output copied source characters (Hanzi/Kana/Hangul) instead of phonetic notation, or omitted Bopomofo for zh-tw. Every line MUST use pure phonetic notation according to the rules. For Taiwan Mandarin songs/artists, Mandarin lines MUST use Bopomofo (注音符號) with lang \"zh-tw\" (never Hanyu Pinyin); for Taiwanese Hokkien/Minnan lines, use Tâi-lô Latin romanization with lang \"other\"."
				continue
			}
			err = parseErr
		}
		lastErr = err
		if attempt < lyricPronunciationMaxRetries {
			time.Sleep(lyricTranslationRetryDelay)
		}
	}
	return nil, lastErr
}

func splitPronunciationChunks(tasks []lyricPronunciationTask) [][]lyricPronunciationTask {
	if len(tasks) == 0 {
		return nil
	}
	var chunks [][]lyricPronunciationTask
	firstSize := min(lyricPronunciationFirstChunkLines, len(tasks))
	chunks = append(chunks, tasks[:firstSize])
	for start := firstSize; start < len(tasks) && len(chunks) < lyricPronunciationMaxChunks; start += lyricPronunciationChunkLines {
		end := min(start+lyricPronunciationChunkLines, len(tasks))
		chunks = append(chunks, tasks[start:end])
	}
	return chunks
}

func buildPronunciationSystemPrompt(wordTimed bool, songLang string, taiwanOrigin bool) string {
	var b strings.Builder
	b.WriteString("You generate accurate phonetic pronunciation transcriptions for song lyrics.\n\n")
	b.WriteString(fmt.Sprintf("Detected primary song language hint: %s", songLang))
	if taiwanOrigin {
		b.WriteString(" (taiwan_origin_hint: true)")
	}
	b.WriteString(".\n\n")
	b.WriteString("STANDARD PHONETIC SYSTEMS BY LINE LANGUAGE (`lang`):\n")
	b.WriteString("- `zh` (Mainland Mandarin / 普通话): Standard Hanyu Pinyin with tone marks (e.g. `wǒ ài nǐ`), lowercase, space-separated per syllable — use ONLY for non-Taiwan Mandarin songs/lines.\n")
	b.WriteString("- `zh-hk` (Hong Kong Cantonese): LSHK Jyutping with tone numbers 1–6 (e.g. `ngo5 oi3 nei5`), lowercase, space-separated per syllable. For bilingual Mandarin+Cantonese songs, accurately tag Cantonese lines `zh-hk` (Jyutping) and Mandarin lines `zh` (or `zh-tw` if sung in Taiwan Mandarin).\n")
	b.WriteString("- `zh-tw` (Taiwan Mandarin / 台灣國語): Standard Bopomofo / Zhuyin (注音符號, e.g. `ㄒㄧㄠˇ ㄒㄧㄥˋ ㄩㄣˋ`, `ㄨㄢˇ ㄈㄥ ㄑㄧㄥ ㄈㄨˊ ㄆㄥˊ ㄏㄨˊ ㄨㄢ`, neutral tone `˙`), space-separated per syllable, following authentic Taiwan Guoyu standard readings (教育部國語一字多音 / local Taiwan Mandarin usage). **TAIWAN ORIGIN PRIORITY**: Even if the input lyrics are in Simplified Chinese, whenever the song, performing artist/band, or songwriter/lyricist/composer (check `title`, `artists`, `album`, `aliases`, `artist_hints`, `credits`, or `taiwan_origin_hint: true` — e.g. 周杰伦, 田馥甄《小幸运》, 潘安邦/叶佳修《外婆的澎湖湾》, 《孤儿乐园》, or any Taiwanese creator) is from Taiwan AND the line is sung in **Mandarin (國語)**, you MUST tag `\"lang\": \"zh-tw\"` and output **Bopomofo (注音符號)**, NEVER Hanyu Pinyin!\n")
	b.WriteString("- **STRICT HOKKIEN / MINNAN (閩南語 / 台語) EXCLUSION**: NEVER use Bopomofo (注音符號) or Mandarin Pinyin for Taiwanese Hokkien / Minnan (閩南語 / 台語) songs or lines (e.g. 《愛拚才會贏》, 《浪子回頭》, or Hokkien lines mixed into a Taiwan song)! Bopomofo is strictly for Taiwan Mandarin (國語). For Hokkien / Minnan lines, tag `\"lang\": \"other\"` and output standard **Taiwanese Hokkien Romanization (Tâi-lô 台灣閩南語羅馬字拼音方案)** in lowercase Latin with tone marks, space-separated per syllable (e.g. `ài piahn tsiah ē iânn`).\n")
	b.WriteString("- `ja` (Japanese): Standard Hepburn Romaji, lowercase, space-separated per word/phrase.\n")
	b.WriteString("- `ko` (Korean): Revised Romanization of Korean, lowercase.\n")
	b.WriteString("- `en` (English): Standard General American IPA WITHOUT surrounding slashes `/` (e.g. `həˈloʊ wɜːrld`).\n")
	b.WriteString("- `other` (Russian, French, Thai, Arabic, Hokkien Tâi-lô, etc.): Standard international Latin romanization (ISO / BGN-PCGN / RTGS / Tâi-lô) or IPA for Latin-script foreign words.\n\n")
	b.WriteString("RULES:\n")
	b.WriteString("1. NEVER copy source Hanzi, Kana, or Hangul characters into `pronunciation` or `tokens`!\n")
	b.WriteString("2. Inline singer cue prefixes before a colon (e.g. `男：`, `周杰伦：`) are NOT sung: omit the cue prefix from `pronunciation`, and for word-timed tokens representing ONLY the cue prefix, output `\"\"`.\n")
	b.WriteString("3. Follow the style of `upstream_samples` if provided (e.g. Jyutping format on partially romanized songs).\n")
	if wordTimed {
		b.WriteString("4. WORD-TIMED ALIGNMENT: Every line provides a `tokens` array of pronounceable words (`token_count`). You MUST output a `tokens` array of strings with the EXACT SAME length and 1-to-1 order matching each input token's pronunciation (use `\"\"` only for non-sung cue prefixes).\n")
		b.WriteString("5. Output strictly ONE JSON object: {\"items\":[{\"i\":1,\"lang\":\"zh\",\"pronunciation\":\"wǒ ài nǐ\",\"tokens\":[\"wǒ\",\"ài\",\"nǐ\"]}]}. No markdown fences.\n")
	} else {
		b.WriteString("4. Output strictly ONE JSON object: {\"items\":[{\"i\":1,\"lang\":\"zh\",\"pronunciation\":\"wǒ ài nǐ\"}]}. No markdown fences.\n")
	}
	return b.String()
}

func buildPronunciationUserPrompt(input *lyricPronunciationInput, tasks []lyricPronunciationTask) string {
	type promptLine struct {
		I          int      `json:"i"`
		Text       string   `json:"text"`
		Tokens     []string `json:"tokens,omitempty"`
		TokenCount int      `json:"token_count,omitempty"`
	}
	lines := make([]promptLine, len(tasks))
	for i, t := range tasks {
		var tokCopy []string
		count := 0
		if input.WordTimed && len(t.Tokens) > 0 {
			tokCopy = t.Tokens
			count = len(t.Tokens)
		}
		lines[i] = promptLine{
			I:          t.Index,
			Text:       t.VocalText,
			Tokens:     tokCopy,
			TokenCount: count,
		}
	}
	payload := struct {
		Title            string                             `json:"title"`
		Artists          []string                           `json:"artists,omitempty"`
		Album            string                             `json:"album,omitempty"`
		Aliases          []string                           `json:"aliases,omitempty"`
		ArtistHints      [][]string                         `json:"artist_hints,omitempty"`
		Credits          []string                           `json:"credits,omitempty"`
		TaiwanOriginHint bool                               `json:"taiwan_origin_hint,omitempty"`
		PrimaryLangHint  string                             `json:"primary_lang_hint"`
		UpstreamSamples  []lyricPronunciationUpstreamSample `json:"upstream_samples,omitempty"`
		Lines            []promptLine                       `json:"lines"`
	}{
		Title:            input.Track.Name,
		Artists:          input.Track.Artists,
		Album:            input.Track.Album,
		Aliases:          input.Track.Aliases,
		ArtistHints:      input.ArtistHints,
		Credits:          input.Credits,
		TaiwanOriginHint: input.TaiwanOrigin,
		PrimaryLangHint:  input.SongLang,
		UpstreamSamples:  input.UpstreamSamples,
		Lines:            lines,
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func parseAndValidatePronunciationResp(
	raw string,
	tasks []lyricPronunciationTask,
	wordTimed bool,
	defaultLang string,
	taiwanOrigin bool,
) ([]dto.MusicLyricPronunciationLine, bool, error) {
	obj, err := extractJSONObject(raw)
	if err != nil {
		return nil, false, err
	}
	var parsed lyricPronunciationAIResp
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return nil, false, err
	}

	byIndex := make(map[int]struct {
		lang   string
		pron   string
		tokens []string
	}, len(parsed.Items))
	for _, it := range parsed.Items {
		byIndex[it.I] = struct {
			lang   string
			pron   string
			tokens []string
		}{
			lang:   normalizePronunciationLang(it.Lang, defaultLang),
			pron:   collapseLyricSpace(it.Pronunciation),
			tokens: it.Tokens,
		}
	}

	wrongCount := 0
	out := make([]dto.MusicLyricPronunciationLine, 0, len(tasks))
	for _, task := range tasks {
		entry, ok := byIndex[task.Index]
		if !ok || entry.pron == "" {
			continue
		}
		if !isValidPronunciationText(entry.pron, task.VocalText, entry.lang) {
			wrongCount++
			continue
		}
		if taiwanOrigin && entry.lang == "zh" {
			stats, _ := countLyricScripts([]string{task.VocalText})
			if stats.han > 0 && stats.latin == 0 && !hasCantoneseMarkers([]string{task.VocalText}) && !hasHokkienMarkers([]string{task.VocalText}) {
				wrongCount++
				continue
			}
		}

		lineOut := dto.MusicLyricPronunciationLine{
			Text:          task.OrigText,
			Occurrence:    task.Occurrence,
			Bg:            task.Bg,
			Lang:          entry.lang,
			Pronunciation: entry.pron,
		}
		if wordTimed && len(task.Tokens) > 0 {
			if len(entry.tokens) == len(task.Tokens) {
				validTokens := make([]string, len(entry.tokens))
				tokensOk := true
				for idx, tok := range entry.tokens {
					cleaned := collapseLyricSpace(tok)
					if cleaned != "" && !isValidPronunciationText(cleaned, task.VocalText, entry.lang) {
						tokensOk = false
						break
					}
					validTokens[idx] = cleaned
				}
				if tokensOk {
					lineOut.Tokens = validTokens
				}
			} else if fields := strings.Fields(entry.pron); len(fields) == len(task.Tokens) {
				lineOut.Tokens = fields
			}
		}
		out = append(out, lineOut)
	}

	if len(out) == 0 && len(tasks) > 0 && wrongCount > 0 {
		return nil, true, nil
	}
	if len(tasks) >= 4 && wrongCount*2 >= len(tasks) {
		return out, true, nil
	}
	return out, false, nil
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
	switch normalizeLyricLangTag(raw) {
	case "zh", "zh-tw", "zh-hk", "ja", "ko", "en", "other":
		return normalizeLyricLangTag(raw)
	default:
		if fallback != "" {
			return fallback
		}
		return "other"
	}
}

func hasCantoneseMarkers(texts []string) bool {
	for _, t := range texts {
		for _, r := range t {
			if cantoneseParticles[r] {
				return true
			}
		}
	}
	return false
}

func hasHokkienMarkers(texts []string) bool {
	for _, t := range texts {
		for _, r := range t {
			if hokkienChars[r] {
				return true
			}
		}
		for _, sub := range hokkienSubstrings {
			if strings.Contains(t, sub) {
				return true
			}
		}
	}
	return false
}

func hasTaiwanOriginHint(track *dto.MusicTrackDto, artistHints [][]string, credits []string) bool {
	var candidates []string
	if track != nil {
		candidates = append(candidates, track.Name, track.Album)
		candidates = append(candidates, track.Artists...)
		candidates = append(candidates, track.Aliases...)
	}
	for _, group := range artistHints {
		candidates = append(candidates, group...)
	}
	candidates = append(candidates, credits...)
	for _, raw := range candidates {
		lower := strings.ToLower(strings.TrimSpace(raw))
		if lower == "" {
			continue
		}
		for _, hint := range taiwanOriginHints {
			if strings.Contains(lower, hint) {
				return true
			}
		}
	}
	return false
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

func detectPronunciationSongLang(vocalTexts []string, samples []lyricPronunciationUpstreamSample, taiwanOrigin bool) string {
	for _, s := range samples {
		if lyricJyutpingRe.MatchString(strings.ToLower(s.Pronunciation)) {
			return "zh-hk"
		}
		if hasBopomofo(s.Pronunciation) {
			return "zh-tw"
		}
	}
	lang := detectLyricTextLang(vocalTexts, "")
	if lang == "zh" || lang == "zh-tw" || lang == "zh-hk" {
		if hasCantoneseMarkers(vocalTexts) {
			return "zh-hk"
		}
		if hasHokkienMarkers(vocalTexts) {
			return "other"
		}
		if taiwanOrigin {
			return "zh-tw"
		}
	}
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
	if hasCantoneseMarkers([]string{vocalText}) {
		return "zh-hk"
	}
	if hasHokkienMarkers([]string{vocalText}) {
		return "other"
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
func parseTTMLPronunciationLines(raw string) ([]lyricPronunciationExtracted, []string, bool) {
	root := parseTTMLTree(raw)
	if root == nil {
		return nil, nil, false
	}
	headRomans := ttmlHeadRomanizations(root)
	var out []lyricPronunciationExtracted
	var credits []string
	seenCredits := map[string]bool{}
	songWordTimed := false

	walkTTML(root, func(p *ttmlNode) bool {
		if p.name == "songwriter" {
			credits = appendPronunciationCredit(credits, seenCredits, ttmlTextContent(p))
			return false
		}
		if p.name != "p" {
			return true
		}
		pBegin, pBeginOK := parseTTMLTime(ttmlAttr(p, "begin"))
		_, pEndOK := parseTTMLTime(ttmlAttr(p, "end"))
		rich := readTTMLPronunciationLine(p)
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
		mainRoman := rich.roman
		bgRoman := ""
		if rich.bg != nil {
			bgRoman = rich.bg.roman
		}
		if key != "" {
			if pair, ok := headRomans[key]; ok {
				if mainRoman == "" && pair.main != "" {
					mainRoman = pair.main
				}
				if bgRoman == "" && pair.bg != "" {
					bgRoman = pair.bg
				}
			}
		}

		mainTokens := filterPronounceableTokens(rich.words)
		if len(rich.words) == 0 && rich.text != "" {
			mainTokens = filterPronounceableTokens([]string{rich.text})
		}
		songWordTimed = songWordTimed || rich.wordTimed

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
			bgTokens := filterPronounceableTokens(rich.bg.words)
			if len(rich.bg.words) == 0 && rich.bg.text != "" {
				bgTokens = filterPronounceableTokens([]string{rich.bg.text})
			}
			songWordTimed = songWordTimed || rich.bg.wordTimed
			if !isValidNativeRomanText(rich.bg.text, bgRoman) {
				bgRoman = ""
			}
			if isLyricCreditText(rich.bg.text) {
				credits = appendPronunciationCredit(credits, seenCredits, rich.bg.text)
			}
			out = append(out, lyricPronunciationExtracted{
				Start:    bgStart,
				Text:     rich.bg.text,
				Bg:       false,
				Tokens:   bgTokens,
				OwnRoman: bgRoman,
			})
			return false
		}

		if isLyricCreditText(rich.text) {
			credits = appendPronunciationCredit(credits, seenCredits, rich.text)
		}
		if !isValidNativeRomanText(rich.text, mainRoman) {
			mainRoman = ""
		}
		mainItem := lyricPronunciationExtracted{
			Start:    mainStart,
			Text:     rich.text,
			Bg:       false,
			Tokens:   mainTokens,
			OwnRoman: mainRoman,
		}
		if !hasBg {
			out = append(out, mainItem)
			return false
		}
		bgStart := pBegin
		if rich.bg.hasTiming && rich.bg.start < math.MaxInt64 {
			bgStart = rich.bg.start
		}
		bgTokens := filterPronounceableTokens(rich.bg.words)
		if len(rich.bg.words) == 0 && rich.bg.text != "" {
			bgTokens = filterPronounceableTokens([]string{rich.bg.text})
		}
		songWordTimed = songWordTimed || rich.bg.wordTimed
		if !isValidNativeRomanText(rich.bg.text, bgRoman) {
			bgRoman = ""
		}
		bgItem := lyricPronunciationExtracted{
			Start:    bgStart,
			Text:     rich.bg.text,
			Bg:       true,
			Tokens:   bgTokens,
			OwnRoman: bgRoman,
		}
		if rich.bgFirst && bgStart <= mainStart {
			out = append(out, bgItem, mainItem)
		} else {
			out = append(out, mainItem, bgItem)
		}
		return false
	})

	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	if len(out) > lyricAnnotationMaxLines {
		out = out[:lyricAnnotationMaxLines]
	}
	return out, credits, songWordTimed
}

type ttmlPronunciationRichLine struct {
	text       string
	words      []string
	roman      string
	start, end int64
	hasTiming  bool
	wordTimed  bool
	bg         *ttmlPronunciationRichLine
	bgFirst    bool
}

func readTTMLPronunciationLine(p *ttmlNode) ttmlPronunciationRichLine {
	var res ttmlPronunciationRichLine
	res.start, res.end = int64(math.MaxInt64), -1
	pendingSpace := false
	hasMainContent := false
	bgSeen := false

	flushSpace := func() {
		if !pendingSpace {
			return
		}
		pendingSpace = false
		if len(res.words) > 0 {
			res.words[len(res.words)-1] += " "
		}
	}
	appendText := func(text string) {
		if text == "" {
			return
		}
		flushSpace()
		if len(res.words) > 0 {
			res.words[len(res.words)-1] += text
		}
	}

	for _, ch := range p.children {
		if ch.name == "" {
			if ch.text != "" && strings.TrimSpace(ch.text) == "" {
				pendingSpace = len(res.words) > 0
			} else {
				appendText(ch.text)
				if strings.TrimSpace(ch.text) != "" {
					hasMainContent = true
				}
			}
			continue
		}
		if ch.name != "span" {
			continue
		}
		ruby := ttmlAttr(ch, "ruby")
		if ruby == "delimiter" || ruby == "text" || ruby == "textContainer" {
			continue
		}
		switch ttmlAttr(ch, "role") {
		case "x-translation":
			continue
		case "x-roman":
			if res.roman == "" {
				res.roman = collapseLyricSpace(ttmlTextWithoutRuby(ch))
			}
			continue
		case "x-bg":
			if res.bg == nil {
				if !hasMainContent && !bgSeen {
					res.bgFirst = true
				}
				bgSeen = true
				parsedBg := readTTMLPronunciationLine(ch)
				if len(parsedBg.words) == 0 {
					if pt := collapseLyricSpace(ttmlTextWithoutRuby(ch)); pt != "" {
						parsedBg.text = pt
						parsedBg.words = []string{pt}
					}
				}
				res.bg = &parsedBg
			}
			continue
		}

		txt := ttmlTextWithoutRuby(ch)
		st, stOK := parseTTMLTime(ttmlAttr(ch, "begin"))
		ed, edOK := parseTTMLTime(ttmlAttr(ch, "end"))
		if !stOK || !edOK {
			appendText(txt)
			if strings.TrimSpace(txt) != "" {
				hasMainContent = true
			}
			continue
		}
		if !(st == 0 && ed == 0) {
			res.hasTiming = true
			res.start = min(res.start, st)
			res.end = max(res.end, max(st, ed))
		}
		if txt != "" {
			flushSpace()
		}
		res.words = append(res.words, txt)
		if strings.TrimSpace(txt) != "" {
			hasMainContent = true
		}
	}

	var b strings.Builder
	for _, w := range res.words {
		b.WriteString(w)
	}
	res.text = collapseLyricSpace(b.String())
	if res.text == "" {
		if plain := collapseLyricSpace(ttmlUntimedText(p)); plain != "" {
			res.text = plain
		}
	}
	if runes := []rune(res.text); len(runes) > lyricTranslationMaxLineRunes {
		res.text = string(runes[:lyricTranslationMaxLineRunes])
	}
	res.wordTimed = len(res.words) > 1
	return res
}

func ttmlHeadRomanizations(root *ttmlNode) map[string]ttmlKeyedLangPair {
	out := map[string]ttmlKeyedLangPair{}
	walkTTML(root, func(block *ttmlNode) bool {
		if block.name != "transliteration" {
			return true
		}
		walkTTML(block, func(textNode *ttmlNode) bool {
			if textNode.name != "text" {
				return true
			}
			key := ttmlAttr(textNode, "for")
			if key == "" {
				return false
			}
			if _, exists := out[key]; exists {
				return false
			}
			var mainB strings.Builder
			var bgText string
			for _, ch := range textNode.children {
				if ch.name == "" {
					mainB.WriteString(ch.text)
					continue
				}
				if ch.name == "span" && ttmlAttr(ch, "role") == "x-bg" {
					if bgText == "" {
						bgText = collapseLyricSpace(ttmlTextWithoutRuby(ch))
					}
					continue
				}
				mainB.WriteString(ttmlTextWithoutRuby(ch))
			}
			mainText := collapseLyricSpace(mainB.String())
			if mainText != "" || bgText != "" {
				out[key] = ttmlKeyedLangPair{main: mainText, bg: bgText}
			}
			return false
		})
		return false
	})
	return out
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
		start  int64
		text   string
		tokens []string
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
		var tokens []string
		if wordTimed {
			rawWords := extractPlatformWordTokens(body, wordMode)
			tokens = filterPronounceableTokens(rawWords)
		}
		for _, start := range extractHeadStarts(head) {
			rows = append(rows, parsedRow{start: start, text: text, tokens: tokens})
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
