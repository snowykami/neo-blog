package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

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

// 歌词多声部 / 歌手分配独立服务（轻量 AgentLoop + 联网查证 + 严格证据门槛，宁缺毋滥）：
// - TTML 显式声明多声部且独唱均具名（含 starry:extensions:v1）时，零开销确定性生成并按需翻译歌手名
// - 含显式段落/行内提示、匿名多声部 TTML 或疑似多人/企划曲时，经受限轮次 AgentLoop（萌娘百科/网页检索）核实确切分唱证据
// - 无确定性证据（如纯独唱 + 制作团队挂名或未检索到分句标注页面）强制归为空声部并缓存，杜绝 AI 臆测与词曲/厂牌注入
// - 使用独立限流器与并发队列，不阻塞歌词翻译、读音、曲名翻译与特效歌词的进度
// - 各目标语言下的歌手译名增量缓存在 Translations JSON 中，严格遵循「官方译名优先，无公认译名时才音译」

const (
	lyricSingerTimeout             = 90 * time.Second
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
	agentChat         func(ctx context.Context, cfg tools.AIConfig, messages []singerAgentMessage, tools []singerAgentToolDef) (*singerAgentChatResult, error)
	translateComplete func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	searchMoegirl     func(ctx context.Context, query, pageTitle string) (string, string, error)
	searchWeb         func(ctx context.Context, query string) (string, error)
	fetchPage         func(ctx context.Context, rawURL string) (string, []string, error)
	moegirlAPIBase    string
	hotComments       func(ctx context.Context, id int64) []lyricAnnotationComment
	concurrency       func() int
	done              func()
}

var lyricSingers = &lyricSingerService{
	name:    "lyric_singer_annotation",
	limiter: &llmclient.Limiter{Name: "ai_lyric_singer"},
	translateComplete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, songTranslationTemperature, songTranslationReasoning)
	},
	hotComments: fetchNCMHotComments,
	concurrency: defaultLyricSingerConcurrency,
}

type lyricSingerDeclaredAgent struct {
	ID       string
	Name     string
	Type     string // "person" | "other" | "group"
	Role     string // "person" | "group"
	Position string // "" | "left" | "right" | "center"
	ColorHex string
	Members  []string
	IsGroup  bool
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
	SectionCue string // 紧邻该行之前的独立段落提示（如 "【周杰伦】" 或单独成行的 "男："）
	InlineCue  string // 该行行首的歌手/声部提示（如 "男"、"周杰伦"）
}

type lyricSingerInput struct {
	Track            *dto.MusicTrackDto
	Source           string
	LyricHash        string
	IsTTML           bool
	HasSeparatedPos  bool
	Agents           []lyricSingerDeclaredAgent
	Lines            []lyricSingerExtractedLine
	Tasks            []lyricSingerLineTask
	HasExplicitCues  bool            // 歌词正文是否包含至少 2 处且至少 2 个不同角色的显式段落/行内演唱提示
	MultiAgentSys    bool            // TTML 是否存在 >=2 独唱或群组声部
	VocalArtists     []string        // 剔除纯幕后创作者（词/曲/编/制作等）后的候选演唱者
	ExcludedCreators []string        // 从署名行识别出的非演唱幕后人员（作词/作曲/编曲/制作等）
	ObservedCueNames map[string]bool // 歌词提示中实际字面出现过的归一化名称
	ArtistHints      [][]string
}

type lyricSingerAIResp struct {
	Empty          bool   `json:"empty"`
	EvidenceSource string `json:"evidence_source,omitempty"`
	EvidenceURL    string `json:"evidence_url,omitempty"`
	Singers        []struct {
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

// RefreshLyricSingers 管理员手动重新生成指定词源的歌手分配或仅刷新目标语言下的歌手译名
func (s *MusicService) RefreshLyricSingers(ctx context.Context, id int64, source, lang string, translateOnly bool) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
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
	return lyricSingers.refresh(input, targetLang, translateOnly)
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

var lyricAttributionCueRoles = map[string]bool{
	"男": true, "女": true, "合": true, "合唱": true, "齐": true, "齊": true, "齐唱": true, "齊唱": true,
	"男声": true, "男聲": true, "女声": true, "女聲": true, "童声": true, "童聲": true,
	"男女": true, "男女合": true, "对唱": true, "對唱": true,
	"念白": true, "旁白": true, "独白": true, "獨白": true,
	"male": true, "female": true, "both": true, "together": true,
}

var (
	lyricCreditVocalDisqualifiers = []string{
		"制作", "製作", "监制", "監製", "编", "編", "混音", "缩混", "录音", "錄音", "母带", "母帶",
		"和声", "和聲", "合声", "合聲", "伴唱", "配唱", "调教", "調教",
		"engineer", "produc", "mix", "master", "edit", "record", "arrang", "direct",
	}
	lyricCreditExplicitVocalKeys = []string{
		"演唱", "主唱", "原唱", "翻唱", "女声", "女聲", "男声", "男聲", "童声", "童聲", "对唱", "對唱", "歌手",
		"vocal", "singer", "performed", "feat",
	}
	lyricCreditPrefixRoles = []struct {
		prefix string
		kind   string // "vocal" | "composer" | "nonvocal"
	}{
		{prefix: "lyrics by ", kind: "nonvocal"},
		{prefix: "written by ", kind: "nonvocal"},
		{prefix: "arranged by ", kind: "nonvocal"},
		{prefix: "produced by ", kind: "nonvocal"},
		{prefix: "mixed by ", kind: "nonvocal"},
		{prefix: "mastered by ", kind: "nonvocal"},
		{prefix: "music by ", kind: "composer"},
		{prefix: "composed by ", kind: "composer"},
		{prefix: "vocal by ", kind: "vocal"},
		{prefix: "performed by ", kind: "vocal"},
		{prefix: "sung by ", kind: "vocal"},
	}
)

func classifyCreditLineRole(line string) (kind string, peopleRaw string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || utf8.RuneCountInString(trimmed) > 120 {
		return "", ""
	}
	lower := strings.ToLower(trimmed)
	for _, notice := range lyricCreditNotices {
		if strings.Contains(lower, notice) {
			return "", ""
		}
	}
	for _, item := range lyricCreditPrefixRoles {
		if strings.HasPrefix(lower, item.prefix) {
			return item.kind, strings.TrimSpace(trimmed[len(item.prefix):])
		}
	}
	prefix, rest, ok := cutLeadingColon(trimmed, 24)
	if !ok || rest == "" {
		return "", ""
	}
	lowerKey := strings.ToLower(strings.TrimSpace(prefix))
	normKey := normalizeLyricMatch(prefix)
	if normKey == "" {
		return "", ""
	}

	isDisqualifiedVocal := false
	for _, dq := range lyricCreditVocalDisqualifiers {
		if strings.Contains(lowerKey, dq) {
			isDisqualifiedVocal = true
			break
		}
	}
	if !isDisqualifiedVocal {
		if normKey == "cv" {
			return "vocal", rest
		}
		for _, vk := range lyricCreditExplicitVocalKeys {
			if strings.Contains(lowerKey, vk) {
				return "vocal", rest
			}
		}
	}

	isNonVocalCredit := isLyricCreditText(trimmed)
	if !isNonVocalCredit {
		return "", ""
	}
	// 「词曲：…」「作词/作曲：…」同时包含填词等纯幕后职能时优先记作纯幕后，仅纯粹「作曲/曲」记为 composer
	hasPureNonVocalMark := strings.Contains(lowerKey, "词") || strings.Contains(lowerKey, "詞") ||
		strings.Contains(lowerKey, "编") || strings.Contains(lowerKey, "編") ||
		strings.Contains(lowerKey, "制作") || strings.Contains(lowerKey, "製作") ||
		strings.Contains(lowerKey, "监制") || strings.Contains(lowerKey, "監製") ||
		isDisqualifiedVocal
	if !hasPureNonVocalMark && (strings.Contains(lowerKey, "作曲") || strings.Contains(lowerKey, "compos") || normKey == "曲") {
		return "composer", rest
	}
	return "nonvocal", rest
}

// analyzeSingerCreditRoles 从平台/TTML 署名行提取纯幕后创作者（词/曲/编/制作等）并剔除候选列表中的非演唱艺人
func analyzeSingerCreditRoles(track *dto.MusicTrackDto, rawLines []string, ttmlSongwriters []string) (vocalArtists []string, excludedDisplay []string, excludedNorms map[string]bool) {
	explicitVocalists := map[string]bool{}
	composers := map[string]bool{}
	pureNonVocal := map[string]bool{}
	displayByNorm := map[string]string{}
	var seenOrder []string

	recordNames := func(dst map[string]bool, rawVal string) {
		for _, part := range lyricArtistSplitRe.Split(rawVal, -1) {
			trimmedPart := strings.TrimSpace(part)
			if trimmedPart == "" {
				continue
			}
			bare := strings.TrimSpace(lyricParensCleanupRe.ReplaceAllString(trimmedPart, ""))
			for _, cand := range []string{trimmedPart, bare} {
				cand = strings.TrimSpace(cand)
				norm := normalizeLyricMatch(cand)
				if norm == "" || utf8.RuneCountInString(norm) < 2 {
					continue
				}
				dst[norm] = true
				if _, exists := displayByNorm[norm]; !exists {
					displayByNorm[norm] = cand
					seenOrder = append(seenOrder, norm)
				}
			}
		}
	}

	for _, line := range rawLines {
		kind, peopleRaw := classifyCreditLineRole(line)
		switch kind {
		case "vocal":
			recordNames(explicitVocalists, peopleRaw)
		case "composer":
			recordNames(composers, peopleRaw)
		case "nonvocal":
			recordNames(pureNonVocal, peopleRaw)
		}
	}
	for _, sw := range ttmlSongwriters {
		recordNames(composers, sw)
	}

	if track != nil {
		for _, artist := range track.Artists {
			if isKnownNonVocalStudio(artist) {
				recordNames(pureNonVocal, artist)
			}
		}
	}

	trackArtistNorms := map[string]bool{}
	leadArtistNorms := map[string]bool{}
	if track != nil && len(track.Artists) > 0 {
		for _, tok := range collectArtistMatchTokens(track.Artists[:1]) {
			leadArtistNorms[tok] = true
		}
		for _, tok := range collectArtistMatchTokens(track.Artists) {
			trackArtistNorms[tok] = true
		}
	}

	excludedNorms = map[string]bool{}
	for _, norm := range seenOrder {
		inComposer := composers[norm]
		inPure := pureNonVocal[norm]
		if !inComposer && !inPure {
			continue
		}
		if inPure && isKnownNonVocalStudio(norm) {
			excludedNorms[norm] = true
			continue
		}
		if len(explicitVocalists) > 0 {
			if !explicitVocalists[norm] {
				excludedNorms[norm] = true
			}
			continue
		}
		if !trackArtistNorms[norm] || (inPure && !leadArtistNorms[norm]) {
			excludedNorms[norm] = true
		}
	}

	seenExcludedDisplay := map[string]bool{}
	for _, norm := range seenOrder {
		if !excludedNorms[norm] {
			continue
		}
		disp := displayByNorm[norm]
		if disp != "" && !seenExcludedDisplay[norm] {
			seenExcludedDisplay[norm] = true
			excludedDisplay = append(excludedDisplay, disp)
		}
	}

	if track != nil && len(track.Artists) > 0 {
		for _, artist := range track.Artists {
			tokens := collectArtistMatchTokens([]string{artist})
			excluded := isKnownNonVocalStudio(artist)
			for _, tok := range tokens {
				if excludedNorms[tok] {
					excluded = true
					break
				}
			}
			if !excluded {
				vocalArtists = append(vocalArtists, artist)
			}
		}
		if len(vocalArtists) == 0 && len(track.Artists) > 0 {
			leadExcluded := isKnownNonVocalStudio(track.Artists[0])
			if !leadExcluded {
				for _, tok := range collectArtistMatchTokens(track.Artists[:1]) {
					if excludedNorms[tok] {
						leadExcluded = true
						break
					}
				}
			}
			if !leadExcluded {
				vocalArtists = append(vocalArtists, track.Artists[0])
			}
		}
	}
	return vocalArtists, excludedDisplay, excludedNorms
}

func unwrapBalancedBrackets(s string) string {
	trimmed := strings.TrimSpace(s)
	pairs := [][2]string{{"[", "]"}, {"【", "】"}, {"(", ")"}, {"（", "）"}}
	for _, p := range pairs {
		if strings.HasPrefix(trimmed, p[0]) && strings.HasSuffix(trimmed, p[1]) {
			inner := strings.TrimSpace(trimmed[len(p[0]) : len(trimmed)-len(p[1])])
			if inner != "" {
				return inner
			}
		}
	}
	return trimmed
}

func splitLeadingBracket(text string) (inner, rest string, allowLetter, ok bool) {
	var closeChar rune
	switch {
	case strings.HasPrefix(text, "["):
		closeChar, allowLetter = ']', true
	case strings.HasPrefix(text, "【"):
		closeChar, allowLetter = '】', true
	case strings.HasPrefix(text, "("):
		closeChar, allowLetter = ')', false
	case strings.HasPrefix(text, "（"):
		closeChar, allowLetter = '）', false
	default:
		return "", "", false, false
	}
	_, firstSize := utf8.DecodeRuneInString(text)
	tail := text[firstSize:]
	closeIdx := strings.IndexRune(tail, closeChar)
	if closeIdx <= 0 {
		return "", "", false, false
	}
	inner = strings.TrimSpace(tail[:closeIdx])
	if inner == "" || utf8.RuneCountInString(inner) > 24 {
		return "", "", false, false
	}
	rest = strings.TrimSpace(tail[closeIdx+utf8.RuneLen(closeChar):])
	rest = strings.TrimSpace(strings.TrimLeft(rest, ":："))
	return inner, rest, allowLetter, true
}

func hasNonLatinScriptRune(s string) bool {
	for _, r := range s {
		if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) {
			return true
		}
	}
	return false
}

// extractExplicitSingerCue 仅识别明确的段落标题或行内演唱者提示（如「男：」「周杰伦：」「【王菲】」「[A] xxx」）
func extractExplicitSingerCue(trimmed string, vocalArtists []string) (cueLabel, rest, normKey string, cueParts []string, isHeader, isLetter, ok bool) {
	if trimmed == "" || isLyricCreditText(trimmed) {
		return "", "", "", nil, false, false, false
	}
	artistTokens := collectArtistMatchTokens(vocalArtists)

	matchCueLabel := func(rawLabel string, allowParenLetter bool) (cleanLabel, outNormKey string, outParts []string, letterFlag, matched bool) {
		unwrapped := unwrapBalancedBrackets(rawLabel)
		cleanLabel = strings.TrimSpace(lyricParensCleanupRe.ReplaceAllString(unwrapped, ""))
		if cleanLabel == "" || isLyricCreditText(cleanLabel+": x") {
			return "", "", nil, false, false
		}
		wholeNorm := normalizeLyricMatch(cleanLabel)
		if wholeNorm == "" || lyricSectionWords[wholeNorm] || isNonLyricCueLine("["+cleanLabel+"]") {
			return "", "", nil, false, false
		}
		if len([]rune(cleanLabel)) == 1 {
			r, _ := utf8.DecodeRuneInString(cleanLabel)
			if r >= 'A' && r <= 'D' {
				if !allowParenLetter {
					return "", "", nil, false, false
				}
				return string(r), string(r), []string{string(r)}, true, true
			}
		}

		parts := lyricArtistSplitRe.Split(cleanLabel, -1)
		var normParts []string
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			normPart := normalizeLyricMatch(part)
			if normPart == "" {
				return "", "", nil, false, false
			}
			if lyricAttributionCueRoles[normPart] || lyricAttributionCueRoles[strings.ToLower(part)] {
				normParts = append(normParts, normPart)
				continue
			}
			if (utf8.RuneCountInString(normPart) >= 2 || hasNonLatinScriptRune(normPart)) && slices.Contains(artistTokens, normPart) {
				normParts = append(normParts, normPart)
				continue
			}
			return "", "", nil, false, false
		}
		if len(normParts) == 0 {
			return "", "", nil, false, false
		}
		return cleanLabel, strings.Join(normParts, "+"), normParts, false, true
	}

	if prefix, afterColon, hasColon := cutLeadingColon(trimmed, 24); hasColon {
		cleanLabel, key, parts, letterFlag, matched := matchCueLabel(prefix, true)
		if matched {
			if afterColon == "" || isNonLyricCueLine(afterColon) {
				return cleanLabel, "", key, parts, true, letterFlag, true
			}
			return cleanLabel, afterColon, key, parts, false, letterFlag, true
		}
	}

	if inner, afterBracket, allowLetter, hasBracket := splitLeadingBracket(trimmed); hasBracket {
		cleanLabel, key, parts, letterFlag, matched := matchCueLabel(inner, allowLetter)
		if matched {
			if afterBracket == "" {
				return cleanLabel, "", key, parts, true, letterFlag, true
			}
			if !isNonLyricCueLine(afterBracket) {
				return cleanLabel, afterBracket, key, parts, false, letterFlag, true
			}
		}
	}

	return "", "", "", nil, false, false, false
}

func (s *MusicService) extractLyricSingerInput(ctx context.Context, track *dto.MusicTrackDto, resolvedSource string) (*lyricSingerInput, *errs.ServiceError) {
	snapshot := s.snapshotForKind(ctx, track.ID, resolvedSource)
	var (
		lines           []lyricSingerExtractedLine
		agents          []lyricSingerDeclaredAgent
		rawCreditLines  []string
		ttmlSongwriters []string
		isTTML          bool
		hasSeparatedPos bool
		openingHeader   string
	)
	if resolvedSource == "ttml-amll" || resolvedSource == "ttml-custom" {
		rawTTML := s.resolveRawTTMLForSource(ctx, track.ID, resolvedSource, snapshot)
		if rawTTML == "" {
			return nil, errs.NewNotFound("lyric_not_found")
		}
		lines, agents, ttmlSongwriters, rawCreditLines, hasSeparatedPos = parseTTMLSingerLines(rawTTML)
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
		rawCreditLines = texts
		head, tail := lyricCreditRange(texts, track.Name, track.Artists)
		if head > 0 {
			prev := strings.TrimSpace(texts[head-1])
			if strings.HasSuffix(prev, ":") || strings.HasSuffix(prev, "：") ||
				strings.HasPrefix(prev, "[") || strings.HasPrefix(prev, "【") ||
				strings.HasPrefix(prev, "(") || strings.HasPrefix(prev, "（") {
				openingHeader = prev
			}
		}
		extracted = extracted[head:tail]
		lines = make([]lyricSingerExtractedLine, len(extracted))
		for i, item := range extracted {
			lines[i] = lyricSingerExtractedLine{Text: item.Text, Bg: item.Bg}
		}
	}
	if len(lines) == 0 {
		return nil, errs.NewNotFound("lyric_not_found")
	}

	vocalArtists, excludedCreators, _ := analyzeSingerCreditRoles(track, rawCreditLines, ttmlSongwriters)

	type occKey struct {
		bg   bool
		norm string
	}
	occCounts := make(map[occKey]int, len(lines))
	tasks := make([]lyricSingerLineTask, 0, len(lines))
	usedSolo := map[string]bool{}
	usedGroup := false
	groupIDs := map[string]bool{}
	for _, ag := range agents {
		if ag.IsGroup {
			groupIDs[ag.ID] = true
		}
	}

	nonLetterCueLines := 0
	distinctNonLetterCues := map[string]bool{}
	letterCueLines := 0
	distinctLetterCues := map[string]bool{}
	observedCueNames := map[string]bool{}
	pendingSectionCue := ""

	recordCue := func(cueParts []string, normKey string, letterFlag bool) {
		if letterFlag {
			letterCueLines++
			distinctLetterCues[normKey] = true
			return
		}
		nonLetterCueLines++
		distinctNonLetterCues[normKey] = true
		for _, p := range cueParts {
			observedCueNames[p] = true
		}
	}

	if openingHeader != "" {
		if cueLabel, _, normKey, cueParts, isHeader, isLetter, cueOK := extractExplicitSingerCue(openingHeader, vocalArtists); cueOK && isHeader {
			recordCue(cueParts, normKey, isLetter)
			pendingSectionCue = cueLabel
		}
	}

	var hashBuilder strings.Builder
	hashBuilder.WriteString("v4:")
	hashBuilder.WriteString(resolvedSource)
	if pendingSectionCue != "" {
		hashBuilder.WriteString("\nsec:")
		hashBuilder.WriteString(pendingSectionCue)
	}
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
		cueLabel, _, normKey, cueParts, isHeader, isLetter, cueOK := extractExplicitSingerCue(trimmed, vocalArtists)
		if cueOK && isHeader {
			recordCue(cueParts, normKey, isLetter)
			pendingSectionCue = cueLabel
			line.IsNonVocal = true
			continue
		}
		if isNonLyricCueLine(trimmed) {
			line.IsNonVocal = true
			continue
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
		task := lyricSingerLineTask{
			Index:      len(tasks) + 1,
			Text:       trimmed,
			Occurrence: line.Occurrence,
			Bg:         line.Bg,
			RawAgent:   line.RawAgent,
		}
		if pendingSectionCue != "" {
			task.SectionCue = pendingSectionCue
			pendingSectionCue = ""
		}
		if cueOK && !isHeader {
			recordCue(cueParts, normKey, isLetter)
			line.HasCue = true
			task.InlineCue = cueLabel
		}
		tasks = append(tasks, task)
	}

	totalCueLines := nonLetterCueLines
	distinctTotal := make(map[string]bool, len(distinctNonLetterCues)+len(distinctLetterCues))
	for k := range distinctNonLetterCues {
		distinctTotal[k] = true
	}
	if letterCueLines >= 2 && len(distinctLetterCues) >= 2 {
		totalCueLines += letterCueLines
		for k := range distinctLetterCues {
			distinctTotal[k] = true
		}
	}
	hasExplicitCues := totalCueLines >= 2 && len(distinctTotal) >= 2

	sum := sha256.Sum256([]byte(hashBuilder.String()))
	lyricHash := hex.EncodeToString(sum[:])
	hints := loadSongHints(track.ID)
	multiAgentSys := isTTML && (len(usedSolo) >= 2 || (usedGroup && len(usedSolo) >= 1))

	return &lyricSingerInput{
		Track:            track,
		Source:           resolvedSource,
		LyricHash:        lyricHash,
		IsTTML:           isTTML,
		HasSeparatedPos:  hasSeparatedPos,
		Agents:           agents,
		Lines:            lines,
		Tasks:            tasks,
		HasExplicitCues:  hasExplicitCues,
		MultiAgentSys:    multiAgentSys,
		VocalArtists:     vocalArtists,
		ExcludedCreators: excludedCreators,
		ObservedCueNames: observedCueNames,
		ArtistHints:      hints.ArtistHints,
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

var ensembleCollabKeywords = []string{
	"hoyo-mix", "hoyomix", "原神", "genshin", "崩坏", "星穹铁道", "honkai",
	"明日方舟", "arknights", "塞壬唱片", "monster siren", "鸣潮", "wuthering",
	"少女与战车", "girls und panzer", "girls & panzer", "ガールズ&パンツァー",
	"lovelive", "love live", "ラブライブ", "idolmaster", "偶像大师", "アイドルマスター",
	"bang dream", "バンドリ", "project sekai", "プロセカ", "世界计划",
	"合唱", "对唱", "對唱", "群星", "feat.", "ft.", "duet", "chorus",
}

func hasCollaboratorOrEnsembleSignal(track *dto.MusicTrackDto) bool {
	if track == nil {
		return false
	}
	if len(track.Artists) >= 2 {
		return true
	}
	for _, artist := range track.Artists {
		if len(lyricArtistSplitRe.Split(strings.TrimSpace(artist), -1)) >= 2 {
			return true
		}
	}
	haystack := strings.ToLower(strings.TrimSpace(track.Name + " " + strings.Join(track.Artists, " ") + " " + track.Album))
	for _, kw := range ensembleCollabKeywords {
		if strings.Contains(haystack, kw) {
			return true
		}
	}
	return false
}

// shouldAttemptSingerAttribution 判断是否具备发起轻量 AgentLoop 查证分角色的价值；纯普通独唱直接零开销跳过
func shouldAttemptSingerAttribution(input *lyricSingerInput) bool {
	if input == nil || len(input.Tasks) == 0 {
		return false
	}
	if input.HasExplicitCues || input.MultiAgentSys {
		return true
	}
	if len(input.VocalArtists) >= 2 {
		return true
	}
	if input.Track != nil && len(input.Track.Artists) >= 2 && len(input.VocalArtists) >= 1 && hasCollaboratorOrEnsembleSignal(input.Track) {
		return true
	}
	return len(input.VocalArtists) == 1 && hasCollaboratorOrEnsembleSignal(input.Track)
}

func emptyReadyLyricSingersDto(source string) *dto.MusicLyricSingersDto {
	return &dto.MusicLyricSingersDto{
		Status:  lyricTranslationStatusReady,
		Source:  source,
		Singers: []dto.LyricSingerItem{},
		Lines:   []dto.LyricSingerLine{},
	}
}

func (a *lyricSingerService) getOrStart(input *lyricSingerInput, targetLang string) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
	a.mu.Lock()

	// Fast Path A: TTML 多声部且所有独唱声部均已自带 <ttm:name> -> 确定性分配色板与左右居中对齐并落库（保留已生成的多语言译名）
	if fastData, ok := buildNamedTTMLSingerData(input); ok {
		var record model.LyricSingerAnnotation
		err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error
		if err == nil {
			a.mu.Unlock()
			return a.buildReadyResponse(input, &record, fastData, targetLang, false, false)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.mu.Unlock()
			return nil, errs.Internal("failed_to_get_target", err)
		}
		rec := a.saveAndLoadData(input, fastData, "ttml:agents")
		a.mu.Unlock()
		if rec == nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
		return a.buildReadyResponse(input, rec, fastData, targetLang, false, false)
	}

	// 普通单人独唱：无多声部、无歌词提示、无合作/企划特征时直接返回空声部，零 DB/AI 开销
	if !shouldAttemptSingerAttribution(input) {
		a.mu.Unlock()
		return emptyReadyLyricSingersDto(input.Source), nil
	}

	jobKey, failedKey := a.stateKeys(input)
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

	// AI Agent Path（轻量联网查证 / 显式提示整理）
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

func (a *lyricSingerService) refresh(input *lyricSingerInput, targetLang string, translateOnly bool) (*dto.MusicLyricSingersDto, *errs.ServiceError) {
	if fastData, ok := buildNamedTTMLSingerData(input); ok {
		rec := a.saveAndLoadData(input, fastData, "ttml:agents")
		if rec == nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
		return a.buildReadyResponse(input, rec, fastData, targetLang, false, targetLang != "")
	}

	if translateOnly {
		if targetLang == "" {
			return emptyReadyLyricSingersDto(input.Source), nil
		}
		var record model.LyricSingerAnnotation
		err := repo.GetDB().Where("song_id = ? AND source = ? AND lyric_hash = ?", input.Track.ID, input.Source, input.LyricHash).First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return emptyReadyLyricSingersDto(input.Source), nil
		}
		if err != nil {
			return nil, errs.Internal("failed_to_get_target", err)
		}
		data := parseLyricSingerData(record.Data)
		if data.Empty || len(data.Singers) == 0 {
			return emptyReadyLyricSingersDto(input.Source), nil
		}
		return a.buildReadyResponse(input, &record, data, targetLang, false, true)
	}

	if !shouldAttemptSingerAttribution(input) {
		return emptyReadyLyricSingersDto(input.Source), nil
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
		if !data.Empty && len(data.Singers) > 0 {
			if targetLang != "" {
				return a.buildReadyResponse(input, &record, data, targetLang, true, true)
			}
			return toLyricSingersDto(input.Source, data, nil, true, false), nil
		}
	}
	return &dto.MusicLyricSingersDto{
		Status:  lyricTranslationStatusPending,
		Source:  input.Source,
		Singers: []dto.LyricSingerItem{},
		Lines:   []dto.LyricSingerLine{},
	}, nil
}

func buildNamedTTMLSingerData(input *lyricSingerInput) (dto.LyricSingerData, bool) {
	if !input.MultiAgentSys {
		return dto.LyricSingerData{}, false
	}
	declaredMap := make(map[string]lyricSingerDeclaredAgent, len(input.Agents))
	declaredSoloRank := make(map[string]int, len(input.Agents))
	for _, ag := range input.Agents {
		declaredMap[ag.ID] = ag
		if !ag.IsGroup {
			if _, seen := declaredSoloRank[ag.ID]; !seen {
				declaredSoloRank[ag.ID] = len(declaredSoloRank)
			}
		}
	}

	soloOrder := make([]string, 0, len(input.Agents))
	soloSeen := map[string]bool{}
	appearanceOrder := map[string]int{}
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
					appearanceOrder[id] = len(soloOrder)
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

	// 按 <head> 声明顺序（declaredSoloRank）优先排列独唱，避免念白/旁白先开口抢占主唱左侧站位
	sort.SliceStable(soloOrder, func(i, j int) bool {
		ri, okI := declaredSoloRank[soloOrder[i]]
		if !okI {
			ri = math.MaxInt
		}
		rj, okJ := declaredSoloRank[soloOrder[j]]
		if !okJ {
			rj = math.MaxInt
		}
		if ri != rj {
			return ri < rj
		}
		return appearanceOrder[soloOrder[i]] < appearanceOrder[soloOrder[j]]
	})

	defaultSolo := ""
	if len(soloOrder) > 0 {
		defaultSolo = soloOrder[0]
	}

	singers := make([]dto.LyricSingerItem, 0, len(soloOrder)+len(groupCombos)+1)
	for i, id := range soloOrder {
		decl := declaredMap[id]
		align := "left"
		switch {
		case decl.Position != "":
			align = decl.Position
		case strings.EqualFold(decl.Type, "other"):
			align = "right"
		default:
			rank, ok := declaredSoloRank[id]
			if !ok {
				rank = i
			}
			if rank > 0 {
				align = "right"
			}
		}
		singers = append(singers, dto.LyricSingerItem{
			ID:    id,
			Name:  sanitizeLyricSingerName(decl.Name),
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
		if agent == "" && !input.HasSeparatedPos {
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
	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeLyricAnnotation, 0), lyricSingerTimeout)
	defer cancel()

	return a.runAttributionAgent(ctx, cfg, input, comments)
}

func buildLyricSingerAttributionUserPrompt(input *lyricSingerInput, comments []lyricAnnotationComment) string {
	type promptLine struct {
		I          int    `json:"i"`
		Text       string `json:"text"`
		Bg         bool   `json:"bg,omitempty"`
		SectionCue string `json:"section_cue,omitempty"`
		InlineCue  string `json:"inline_cue,omitempty"`
		Agent      string `json:"ttml_agent,omitempty"`
	}
	type promptAgent struct {
		ID       string `json:"id"`
		Type     string `json:"type,omitempty"`
		Position string `json:"position,omitempty"`
		Name     string `json:"name,omitempty"`
	}
	lines := make([]promptLine, len(input.Tasks))
	for idx, task := range input.Tasks {
		lines[idx] = promptLine{
			I:          task.Index,
			Text:       task.Text,
			Bg:         task.Bg,
			SectionCue: task.SectionCue,
			InlineCue:  task.InlineCue,
			Agent:      task.RawAgent,
		}
	}
	var ttmlAgents []promptAgent
	if len(input.Agents) > 0 {
		ttmlAgents = make([]promptAgent, 0, len(input.Agents))
		for _, ag := range input.Agents {
			ttmlAgents = append(ttmlAgents, promptAgent{
				ID:       ag.ID,
				Type:     ag.Type,
				Position: ag.Position,
				Name:     ag.Name,
			})
		}
	}
	commentTexts := make([]string, 0, min(len(comments), 5))
	for i := 0; i < len(comments) && i < 5; i++ {
		if c := strings.TrimSpace(comments[i].Content); c != "" {
			commentTexts = append(commentTexts, c)
		}
	}
	payload := struct {
		Title            string        `json:"title"`
		Artists          []string      `json:"artists"`
		ExcludedCreators []string      `json:"excluded_non_vocal_creators,omitempty"`
		ArtistHints      [][]string    `json:"artist_hints,omitempty"`
		Album            string        `json:"album,omitempty"`
		TTMLAgents       []promptAgent `json:"ttml_agents,omitempty"`
		Comments         []string      `json:"hot_comments,omitempty"`
		Lines            []promptLine  `json:"lines"`
	}{
		Title:            input.Track.Name,
		Artists:          input.VocalArtists,
		ExcludedCreators: input.ExcludedCreators,
		ArtistHints:      input.ArtistHints,
		Album:            input.Track.Album,
		TTMLAgents:       ttmlAgents,
		Comments:         commentTexts,
		Lines:            lines,
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func isExcludedSingerName(name, role string, excludedSet, observedCueNames map[string]bool) bool {
	if role == "group" {
		return false
	}
	normFull := normalizeLyricMatch(name)
	if normFull == "" {
		return true
	}
	if isKnownNonVocalStudio(name) && !observedCueNames[normFull] {
		return true
	}
	if len(excludedSet) == 0 {
		return false
	}
	if excludedSet[normFull] && !observedCueNames[normFull] {
		return true
	}
	parts := lyricArtistSplitRe.Split(name, -1)
	if len(parts) > 1 {
		for _, p := range parts {
			pn := normalizeLyricMatch(p)
			if pn != "" && (excludedSet[pn] || isKnownNonVocalStudio(p)) && !observedCueNames[pn] {
				return true
			}
		}
	}
	return false
}

func parseAndSanitizeLyricSingerAIResp(raw string, input *lyricSingerInput) (dto.LyricSingerData, error) {
	obj, err := extractJSONObject(raw)
	if err != nil {
		return dto.LyricSingerData{}, err
	}
	var parsed lyricSingerAIResp
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return dto.LyricSingerData{}, err
	}
	return sanitizeLyricSingerRespStruct(&parsed, input)
}

func sanitizeLyricSingerRespStruct(parsed *lyricSingerAIResp, input *lyricSingerInput) (dto.LyricSingerData, error) {
	if parsed == nil || parsed.Empty {
		return dto.LyricSingerData{Empty: true}, nil
	}

	tasks := input.Tasks
	taskMap := make(map[int]lyricSingerLineTask, len(tasks))
	for _, t := range tasks {
		taskMap[t.Index] = t
	}
	excludedSet := make(map[string]bool, len(input.ExcludedCreators))
	for _, c := range input.ExcludedCreators {
		if norm := normalizeLyricMatch(c); norm != "" {
			excludedSet[norm] = true
		}
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
		if isExcludedSingerName(name, role, excludedSet, input.ObservedCueNames) {
			continue
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
	if len(validSingers) < 2 {
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
	usedAgents := map[string]bool{}
	for _, item := range parsed.Lines {
		if lineSeen[item.Index] {
			continue
		}
		agentID := strings.TrimSpace(item.Agent)
		task, ok := taskMap[item.Index]
		if !ok || !singerSeen[agentID] {
			continue
		}
		lineSeen[item.Index] = true
		usedAgents[agentID] = true
		keptLines = append(keptLines, dto.LyricSingerLine{
			Text:       task.Text,
			Occurrence: task.Occurrence,
			Bg:         task.Bg,
			Agent:      agentID,
		})
	}
	if len(keptLines) == 0 || len(usedAgents) < 2 {
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

type ttmlStarryExtLine struct {
	AgentAttr   string
	HasAgent    bool
	BgAgentAttr string
	HasBgAgent  bool
}

type ttmlStarryExtensions struct {
	Agents     []lyricSingerDeclaredAgent
	LinesByKey map[string]ttmlStarryExtLine
}

func parseTTMLDeclaredPosition(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "primary", "left":
		return "left"
	case "secondary", "right":
		return "right"
	case "duet", "center":
		return "center"
	default:
		return ""
	}
}

func hasNativeTTMLStarryExtensions(root *ttmlNode) bool {
	found := false
	walkTTML(root, func(node *ttmlNode) bool {
		if found {
			return false
		}
		if node.name == "tt" {
			for _, attr := range node.attrs {
				if (attr.Name.Space == "xmlns" || attr.Name.Local == "xmlns") && strings.HasPrefix(attr.Value, "urn:ttml:extensions:") {
					found = true
					return false
				}
			}
		}
		for _, attrName := range []string{"position", "agents", "color", "members", "rubyGroup"} {
			if ttmlHasAttr(node, attrName) {
				found = true
				return false
			}
		}
		return true
	})
	return found
}

func parseStarryExtColorRaw(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return strings.TrimSpace(s)
	}
	var obj struct {
		Hex   string  `json:"hex"`
		Red   float64 `json:"red"`
		Green float64 `json:"green"`
		Blue  float64 `json:"blue"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil {
		if hexStr := strings.TrimSpace(obj.Hex); hexStr != "" {
			return hexStr
		}
		if strings.Contains(string(raw), `"red"`) {
			clamp := func(v float64) int {
				n := int(math.Round(v))
				if n < 0 {
					return 0
				}
				if n > 255 {
					return 255
				}
				return n
			}
			return fmt.Sprintf("#%02x%02x%02x", clamp(obj.Red), clamp(obj.Green), clamp(obj.Blue))
		}
	}
	return ""
}

func readTTMLStarryExtensions(root *ttmlNode) *ttmlStarryExtensions {
	if hasNativeTTMLStarryExtensions(root) {
		return nil
	}
	encoded := ""
	walkTTML(root, func(node *ttmlNode) bool {
		if node.name == "meta" && ttmlAttr(node, "key") == "starry:extensions:v1" {
			encoded = strings.TrimSpace(ttmlAttr(node, "value"))
			return false
		}
		return true
	})
	if encoded == "" {
		return nil
	}
	rawBytes, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		rawBytes, err = base64.RawStdEncoding.DecodeString(encoded)
		if err != nil {
			return nil
		}
	}
	var payload struct {
		Version int `json:"version"`
		Agents  []struct {
			ID    string `json:"id"`
			Kind  string `json:"kind"`
			Names []struct {
				Text string `json:"text"`
				Kind string `json:"kind"`
			} `json:"names"`
			Color     json.RawMessage `json:"color"`
			MemberIDs []string        `json:"memberIDs"`
		} `json:"agents"`
		Lines []struct {
			Key        string    `json:"key"`
			AgentIDs   *[]string `json:"agentIDs"`
			Background *struct {
				AgentIDs *[]string `json:"agentIDs"`
			} `json:"background"`
		} `json:"lines"`
	}
	if err := json.Unmarshal(rawBytes, &payload); err != nil || payload.Version != 1 {
		return nil
	}
	ext := &ttmlStarryExtensions{
		Agents:     make([]lyricSingerDeclaredAgent, 0, len(payload.Agents)),
		LinesByKey: make(map[string]ttmlStarryExtLine, len(payload.Lines)),
	}
	for _, entry := range payload.Agents {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			continue
		}
		name := ""
		for _, n := range entry.Names {
			if strings.TrimSpace(n.Text) != "" {
				if n.Kind == "full" || name == "" {
					name = strings.TrimSpace(n.Text)
				}
				if n.Kind == "full" {
					break
				}
			}
		}
		kind := strings.TrimSpace(entry.Kind)
		if kind == "" {
			kind = "person"
		}
		isGroup := strings.EqualFold(kind, "group") || isConventionalTTMLGroupID(id)
		var members []string
		if isGroup {
			for _, m := range entry.MemberIDs {
				if trimmed := strings.TrimSpace(m); trimmed != "" {
					members = append(members, trimmed)
				}
			}
		}
		role := "person"
		if isGroup {
			role = "group"
		}
		ext.Agents = append(ext.Agents, lyricSingerDeclaredAgent{
			ID:       id,
			Name:     name,
			Type:     kind,
			Role:     role,
			ColorHex: parseStarryExtColorRaw(entry.Color),
			Members:  members,
			IsGroup:  isGroup,
		})
	}
	joinPtrIDs := func(ids *[]string) (string, bool) {
		if ids == nil {
			return "", false
		}
		cleaned := make([]string, 0, len(*ids))
		for _, s := range *ids {
			if trimmed := strings.TrimSpace(s); trimmed != "" {
				cleaned = append(cleaned, trimmed)
			}
		}
		return strings.Join(cleaned, " "), true
	}
	for _, line := range payload.Lines {
		key := strings.TrimSpace(line.Key)
		if key == "" {
			continue
		}
		if _, exists := ext.LinesByKey[key]; exists {
			continue
		}
		agentAttr, hasAgent := joinPtrIDs(line.AgentIDs)
		var bgAgentAttr string
		var hasBgAgent bool
		if line.Background != nil {
			bgAgentAttr, hasBgAgent = joinPtrIDs(line.Background.AgentIDs)
		}
		ext.LinesByKey[key] = ttmlStarryExtLine{
			AgentAttr:   agentAttr,
			HasAgent:    hasAgent,
			BgAgentAttr: bgAgentAttr,
			HasBgAgent:  hasBgAgent,
		}
	}
	return ext
}

func readTTMLBgAgentAttr(p *ttmlNode) (string, bool) {
	var found bool
	var out string
	var visit func(node *ttmlNode)
	visit = func(node *ttmlNode) {
		if found {
			return
		}
		for _, ch := range node.children {
			if ch.name == "" {
				continue
			}
			if ch.name == "span" && ttmlAttr(ch, "role") == "x-bg" {
				found = true
				if ttmlHasAttr(ch, "agents") {
					out = strings.TrimSpace(ttmlAttr(ch, "agents"))
				} else {
					out = strings.TrimSpace(ttmlAttr(ch, "agent"))
				}
				return
			}
			visit(ch)
			if found {
				return
			}
		}
	}
	visit(p)
	return out, found && (out != "" || ttmlHasAttrPrefixBg(p))
}

func ttmlHasAttrPrefixBg(p *ttmlNode) bool {
	has := false
	walkTTML(p, func(node *ttmlNode) bool {
		if has {
			return false
		}
		if node.name == "span" && ttmlAttr(node, "role") == "x-bg" {
			has = ttmlHasAttr(node, "agents")
			return false
		}
		return true
	})
	return has
}

func filterTTMLCarrierAgents(rawAgent string, carrierIDs map[string]bool) string {
	fields := strings.Fields(rawAgent)
	if len(fields) == 0 {
		return ""
	}
	kept := make([]string, 0, len(fields))
	seen := map[string]bool{}
	for _, id := range fields {
		if carrierIDs[id] || seen[id] {
			continue
		}
		seen[id] = true
		kept = append(kept, id)
	}
	return strings.Join(kept, " ")
}

// parseTTMLSingerLines 解析 TTML 中的声部声明、创作者署名与歌词主行/x-bg 背景行（按与前端 parse-ttml.ts 一致的排序、carrier 过滤与 starry:extensions 支持）
func parseTTMLSingerLines(raw string) ([]lyricSingerExtractedLine, []lyricSingerDeclaredAgent, []string, []string, bool) {
	root := parseTTMLTree(raw)
	if root == nil {
		return nil, nil, nil, nil, false
	}

	starryExt := readTTMLStarryExtensions(root)

	var xmlDeclared []lyricSingerDeclaredAgent
	xmlSeen := map[string]bool{}
	var songwriters []string
	walkTTML(root, func(node *ttmlNode) bool {
		if node.name == "songwriter" {
			if name := collapseLyricSpace(ttmlTextContent(node)); name != "" {
				songwriters = append(songwriters, name)
			}
			return false
		}
		if node.name != "agent" {
			return true
		}
		id := strings.TrimSpace(ttmlAttr(node, "id"))
		if id == "" || xmlSeen[id] {
			return false
		}
		xmlSeen[id] = true
		agType := strings.TrimSpace(ttmlAttr(node, "type"))
		if agType == "" {
			agType = "person"
		}
		isGroup := strings.EqualFold(agType, "group") || isConventionalTTMLGroupID(id)
		role := "person"
		if isGroup {
			role = "group"
		}
		xmlDeclared = append(xmlDeclared, lyricSingerDeclaredAgent{
			ID:       id,
			Name:     readTTMLAgentName(node),
			Type:     agType,
			Role:     role,
			Position: parseTTMLDeclaredPosition(ttmlAttr(node, "position")),
			ColorHex: strings.TrimSpace(ttmlAttr(node, "color")),
			Members:  strings.Fields(ttmlAttr(node, "members")),
			IsGroup:  isGroup,
		})
		return false
	})

	declaredList := make([]lyricSingerDeclaredAgent, 0, len(xmlDeclared))
	declaredSeen := map[string]bool{}
	if starryExt != nil && len(starryExt.Agents) > 0 {
		for _, ag := range starryExt.Agents {
			if !declaredSeen[ag.ID] {
				declaredSeen[ag.ID] = true
				declaredList = append(declaredList, ag)
			}
		}
	}
	for _, ag := range xmlDeclared {
		if !declaredSeen[ag.ID] {
			declaredSeen[ag.ID] = true
			declaredList = append(declaredList, ag)
		}
	}

	hasPerformerDecl := false
	for _, ag := range declaredList {
		if ag.Position == "" || ag.Name != "" || ag.ColorHex != "" || len(ag.Members) > 0 {
			hasPerformerDecl = true
			break
		}
	}
	carrierIDs := map[string]bool{}
	agents := make([]lyricSingerDeclaredAgent, 0, len(declaredList))
	hasDeclaredPos := false
	for _, ag := range declaredList {
		if ag.Position != "" {
			hasDeclaredPos = true
		}
		if hasPerformerDecl && ag.Position != "" && ag.Name == "" && ag.ColorHex == "" && len(ag.Members) == 0 {
			carrierIDs[ag.ID] = true
			continue
		}
		agents = append(agents, ag)
	}

	hasSeparatedPos := starryExt != nil || hasDeclaredPos
	type item struct {
		start int64
		line  lyricSingerExtractedLine
	}
	var items []item
	var creditLines []string
	walkTTMLWithAgent(root, "", "", func(p *ttmlNode, inheritedAgent string) bool {
		if p.name != "p" {
			return true
		}
		if ttmlHasAttr(p, "agents") || ttmlHasAttr(p, "position") {
			hasSeparatedPos = true
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

		mainRaw := inheritedAgent
		key := strings.TrimSpace(ttmlAttr(p, "key"))
		var extLine ttmlStarryExtLine
		var hasExtLine bool
		if starryExt != nil && key != "" {
			extLine, hasExtLine = starryExt.LinesByKey[key]
			if hasExtLine && extLine.HasAgent {
				mainRaw = extLine.AgentAttr
			}
		}
		mainRaw = filterTTMLCarrierAgents(mainRaw, carrierIDs)

		bgRaw := mainRaw
		if hasBg {
			if hasExtLine && extLine.HasBgAgent {
				bgRaw = filterTTMLCarrierAgents(extLine.BgAgentAttr, carrierIDs)
			} else if ownBg, ok := readTTMLBgAgentAttr(p); ok {
				bgRaw = filterTTMLCarrierAgents(ownBg, carrierIDs)
			}
		}

		if !hasMain && hasBg {
			if isLyricCreditText(rich.bg.text) {
				creditLines = append(creditLines, rich.bg.text)
			}
			bgStart := pBegin
			if rich.bg.hasTiming && rich.bg.start < math.MaxInt64 {
				bgStart = rich.bg.start
			}
			items = append(items, item{
				start: bgStart,
				line:  lyricSingerExtractedLine{Text: rich.bg.text, Bg: false, RawAgent: bgRaw},
			})
			return false
		}
		if isLyricCreditText(rich.text) {
			creditLines = append(creditLines, rich.text)
		}
		mainItem := item{
			start: mainStart,
			line:  lyricSingerExtractedLine{Text: rich.text, Bg: false, RawAgent: mainRaw},
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
			line:  lyricSingerExtractedLine{Text: rich.bg.text, Bg: true, RawAgent: bgRaw},
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
	return out, agents, songwriters, creditLines, hasSeparatedPos
}
