package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 歌词双阶段翻译 Stage 1（Router 侦测策划 Agent）：
// 使用低/零思考模式（"none"）快速分析整首歌的开放式曲风、情感基调、文化借代词表与定制翻译技巧（Skills），
// 按「歌曲 ID + 歌词文本哈希」缓存落库并跨所有目标语言复用；同时输出 visual_theme 供歌词特效标注参考。

const (
	lyricDirectorTimeout        = 30 * time.Second
	lyricDirectorJobTTL         = 45 * time.Second
	lyricDirectorWaitTimeout    = 15 * time.Second
	lyricDirectorTemperature    = 0.2
	lyricDirectorMaxRetries     = 1
	lyricDirectorMaxLyricLines  = 200
	lyricDirectorMaxNotes       = 20
	lyricDirectorMaxSkills      = 5
	lyricDirectorMaxFieldRunes  = 400
	lyricDirectorTTLDefaultDays = 7
)

var (
	lyricDirectorRetryDelay = 500 * time.Millisecond
	lyricDirectorWaitPoll   = 80 * time.Millisecond
)

const lyricDirectorSystemPrompt = `You are a master music director and literary lyric analyst.
Analyze the song's primary sung language, genre, emotional vibe, narrative perspective, hidden cultural idioms/metonyms/slang, and whether the original lyrics require a reference translation to decode opaque content across the full lyrics.
Output strictly a single valid JSON object matching the following schema:
{
  "song_lang": "lowercase standard BCP-47 tag of the primary sung language/variety (e.g., 'zh-cn', 'zh-tw', 'yue', 'nan', 'wuu', 'hak', 'lzh', 'ja', 'en', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'la', 'ar', 'th', 'vi', 'id', 'ms', 'hi', 'tr', 'nl', 'pl', 'sv', 'uk', 'el', 'he', 'art', 'mul')",
  "genre": "A specific, accurate genre tag. You are NOT restricted to standard categories—freely synthesize compound or niche genres as appropriate (e.g., 'classical_poetry', 'anime_denpa', 'cyberpunk_synthwave', 'traditional_opera_fusion', 'lofi_chill_rnb', 'emo_rap', 'gothic_rock', 'kpop_dance')",
  "mood": "dominant emotion in 2-3 expressive adjectives (e.g., bittersweet nostalgia, manic euphoria, desolate solitude)",
  "needs_reference_translation": false,
  "cultural_notes": [
    {
      "term": "original term / phrase in lyrics",
      "metonymy_meaning": "literal surface origin (if any) + actual contextual meaning for glossing, e.g. 五陵 / 五陵年少 = Han imperial mausoleum towns turned Chang'an's wealthy noble quarter -> wealthy noble youth of the capital (bare 'Five Tombs' misleads English readers into literal graves without a gloss); 青衫 = humble Tang official's blue-green robe symbolizing low rank/exile; 青丝 = youth or jet-black hair, NOT green thread; 阿姨 = foster madam of the music quarters in Tang context, NOT biological aunt"
    }
  ],
  "custom_style_skills": [
    "Specific craft rule #1 for this exact song (e.g. For this melancholic jazz ballad, use smoky conversational phrasing with subtle enjambment)",
    "Specific craft rule #2 for this exact song (e.g. For Classical Chinese poetry, preserve poetic/literal imagery or romanized names, and add concise 2-5 word first-occurrence parenthetical glosses in English/Western languages for opaque Tang/Han allusions while keeping Sinosphere languages like Japanese concise)"
  ],
  "translation_directive": "concise overall directive on rhythm, tone, lyrical voice, and rhyme preference",
  "visual_theme": "suggested visual color palette and dynamic particle effects (e.g., neon violet raindrops on wet asphalt, floating amber lotus petals)"
}
Rules for "song_lang":
- Output a lowercase standard BCP-47 / ISO 639 tag for the primary sung language.
- Distinguish Sinitic varieties accurately using lyric register, vocabulary, and artist origin: Classical/Literary Chinese poetry or predominantly wenyan lyrics (e.g. Tang/Song poems like《琵琶行》《将进酒》set to music, even when sung in modern Mandarin pronunciation) -> 'lzh', Mainland/Singapore/Malaysia Mandarin -> 'zh-cn', Taiwan Mandarin -> 'zh-tw', Cantonese -> 'yue', Hokkien/Taiwanese Minnan -> 'nan', Wu/Shanghainese -> 'wuu', Hakka -> 'hak'.
- Use 'art' for constructed/fictional/invented languages (e.g., Hymmnos, Chaos language, Kajiurago) or cipher/Morse lyrics; use 'mul' ONLY when two or more languages share major verse/chorus weight (do NOT use 'mul' just for occasional short English loanwords or hooks inside a Japanese/Korean/Chinese pop song).
Rules for "cultural_notes" & "custom_style_skills":
- Scan the full lyrics for Classical Chinese allusions, metonymic historical place names, official titles/ranks, attire/color symbols, and subcultural idioms whose literal translation is misleading or opaque to non-Sinosphere (especially native English) listeners.
- Record each key allusion in "cultural_notes" with its true historical/contextual meaning so translators can supply accurate parenthetical glosses instead of bare misleading literal calques.
- When Classical Chinese verse or dense historical allusions are present, include an audience-aware allusion-glossing skill in "custom_style_skills" (retaining classical flavor with concise first-occurrence parenthetical glosses for English/Western readers, while keeping Japanese/Chinese glosses minimal where Kanji already conveys the meaning).
Rules for "needs_reference_translation":
- Default to false for all normal natural-language lyrics (Japanese, English, Korean, Classical/Modern Chinese, French, German, Russian, multilingual lyrics, idioms, allusions, or slang) where a translator can directly understand and translate the original text independently without anchoring on a built-in translation.
- Set true ONLY when the lyrics contain opaque, abstract, or encoded content whose semantic meaning cannot be reliably deciphered from the raw surface text alone without consulting an official/upstream reference translation — such as constructed/fictional/invented languages (conlangs like LaVI-Bavellabion, Hymmnos, Chaos language, lore-specific Kajiurago), Morse code (... --- ..., .- / -...), binary/hex/numeric ciphers, or cryptic symbol lyrics.`

type lyricCulturalNote struct {
	Term            string `json:"term"`
	MetonymyMeaning string `json:"metonymy_meaning"`
}

type lyricDirectorAnalysis struct {
	SongLang                  string              `json:"song_lang,omitempty"`
	Genre                     string              `json:"genre"`
	Mood                      string              `json:"mood"`
	NeedsReferenceTranslation bool                `json:"needs_reference_translation,omitempty"`
	CulturalNotes             []lyricCulturalNote `json:"cultural_notes,omitempty"`
	CustomStyleSkills         []string            `json:"custom_style_skills,omitempty"`
	TranslationDirective      string              `json:"translation_directive"`
	VisualTheme               string              `json:"visual_theme"`
}

func (d *lyricDirectorAnalysis) isEmpty() bool {
	if d == nil {
		return true
	}
	return d.SongLang == "" && d.Genre == "" && d.Mood == "" && len(d.CulturalNotes) == 0 && len(d.CustomStyleSkills) == 0 && d.TranslationDirective == "" && d.VisualTheme == ""
}

func (d *lyricDirectorAnalysis) formatCulturalNotes() string {
	if d == nil || len(d.CulturalNotes) == 0 {
		return "(none identified)"
	}
	var b strings.Builder
	for i, note := range d.CulturalNotes {
		if i > 0 {
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "- %s: %s", note.Term, note.MetonymyMeaning)
	}
	return b.String()
}

func (d *lyricDirectorAnalysis) formatCustomSkills() string {
	if d == nil || len(d.CustomStyleSkills) == 0 {
		return "(apply standard genre adaptation)"
	}
	var b strings.Builder
	for i, skill := range d.CustomStyleSkills {
		if i > 0 {
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "- %s", skill)
	}
	return b.String()
}

type lyricDirectorService struct {
	name        string
	initOnce    sync.Once
	limiter     *llmclient.Limiter
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
}

var lyricDirectors = &lyricDirectorService{
	name:    "lyric_director",
	limiter: llmclient.DefaultLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricDirectorTemperature, "none")
	},
	concurrency: tools.GetAISummaryConcurrency,
}

func (a *lyricDirectorService) prefix() string {
	a.initOnce.Do(func() {
		if a.name == "" {
			a.name = "lyric_director"
		}
	})
	return a.name
}

func (a *lyricDirectorService) jobKey(stateKey string) string {
	return a.prefix() + ":job:" + stateKey
}

func (a *lyricDirectorService) dataKey(stateKey string) string {
	return a.prefix() + ":data:" + stateKey
}

func lyricDirectorCacheTTL() time.Duration {
	return time.Duration(lyricDirectorTTLDefaultDays) * 24 * time.Hour
}

// computeLyricDirectorHash 对演唱歌词行计算与来源/目标语言无关的文本哈希，便于跨语种复用导演分析与对齐视觉主题。
func computeLyricDirectorHash(lines []string) string {
	var normalized []string
	for _, line := range lines {
		if cleaned := collapseLyricSpace(line); cleaned != "" {
			normalized = append(normalized, cleaned)
		}
	}
	if len(normalized) == 0 {
		return ""
	}
	payload := strings.Join(normalized, "\n")
	if songHasClassicalChinese(normalized) {
		payload = "classical-v2\n" + payload
	}
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func buildLyricDirectorUserPrompt(track *dto.MusicTrackDto, lines []string) string {
	clipped := make([]string, 0, min(len(lines), lyricDirectorMaxLyricLines))
	for _, line := range lines {
		if cleaned := collapseLyricSpace(line); cleaned != "" {
			clipped = append(clipped, cleaned)
			if len(clipped) >= lyricDirectorMaxLyricLines {
				break
			}
		}
	}
	payload := struct {
		Title   string   `json:"title,omitempty"`
		Artists []string `json:"artists,omitempty"`
		Album   string   `json:"album,omitempty"`
		Aliases []string `json:"aliases,omitempty"`
		Lyrics  []string `json:"lyrics"`
	}{
		Title:   track.Name,
		Artists: track.Artists,
		Album:   track.Album,
		Aliases: track.Aliases,
		Lyrics:  clipped,
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func trimFieldRunes(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if maxRunes <= 0 || utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	return string([]rune(s)[:maxRunes])
}

func parseLyricDirectorAnalysis(raw string) (lyricDirectorAnalysis, error) {
	obj, err := extractJSONObject(raw)
	if err != nil {
		return lyricDirectorAnalysis{}, err
	}
	var parsed lyricDirectorAnalysis
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return lyricDirectorAnalysis{}, err
	}
	parsed.SongLang = normalizeStandardSongLangTag(trimFieldRunes(parsed.SongLang, 32))
	parsed.Genre = trimFieldRunes(parsed.Genre, 120)
	parsed.Mood = trimFieldRunes(parsed.Mood, 160)
	parsed.TranslationDirective = trimFieldRunes(parsed.TranslationDirective, lyricDirectorMaxFieldRunes)
	parsed.VisualTheme = trimFieldRunes(parsed.VisualTheme, lyricDirectorMaxFieldRunes)

	notes := make([]lyricCulturalNote, 0, min(len(parsed.CulturalNotes), lyricDirectorMaxNotes))
	for _, item := range parsed.CulturalNotes {
		term := trimFieldRunes(item.Term, 120)
		meaning := trimFieldRunes(item.MetonymyMeaning, 260)
		if term == "" || meaning == "" {
			continue
		}
		notes = append(notes, lyricCulturalNote{Term: term, MetonymyMeaning: meaning})
		if len(notes) >= lyricDirectorMaxNotes {
			break
		}
	}
	parsed.CulturalNotes = notes

	skills := make([]string, 0, min(len(parsed.CustomStyleSkills), lyricDirectorMaxSkills))
	for _, item := range parsed.CustomStyleSkills {
		if skill := trimFieldRunes(item, 280); skill != "" {
			skills = append(skills, skill)
			if len(skills) >= lyricDirectorMaxSkills {
				break
			}
		}
	}
	parsed.CustomStyleSkills = skills

	if parsed.isEmpty() {
		return lyricDirectorAnalysis{}, errors.New("empty lyric director analysis")
	}
	return parsed, nil
}

func (a *lyricDirectorService) callFirstScreen(cfg tools.AIConfig, system, user string) (string, error) {
	limiter := a.limiter
	if limiter == nil {
		limiter = llmclient.DefaultLimiter
	}
	concurrency := a.concurrency
	if concurrency == nil {
		concurrency = tools.GetAISummaryConcurrency
	}
	_ = limiter.AcquireTier(context.Background(), concurrency, llmclient.TierFirstScreen, nil)
	defer limiter.Release()

	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeTranslation, 0), lyricDirectorTimeout)
	defer cancel()
	return a.complete(ctx, cfg, system, user)
}

func (a *lyricDirectorService) loadCached(songID int64, hash, stateKey string, ttl time.Duration) (*lyricDirectorAnalysis, bool) {
	var cached lyricDirectorAnalysis
	if found, err := sharedstate.GetJSON(a.dataKey(stateKey), &cached); err == nil && found && !cached.isEmpty() {
		return &cached, true
	}
	db := repo.GetDB()
	if db == nil {
		return nil, false
	}
	var record model.LyricDirector
	if err := db.Where("song_id = ? AND lyric_hash = ?", songID, hash).First(&record).Error; err != nil {
		return nil, false
	}
	if time.Since(record.CreatedAt) > ttl {
		return nil, false
	}
	var parsed lyricDirectorAnalysis
	if err := json.Unmarshal([]byte(record.Data), &parsed); err != nil || parsed.isEmpty() {
		return nil, false
	}
	remaining := time.Until(record.CreatedAt.Add(ttl))
	if remaining < time.Minute {
		remaining = time.Minute
	}
	_ = sharedstate.SetJSON(a.dataKey(stateKey), parsed, remaining)
	return &parsed, true
}

func (a *lyricDirectorService) loadStaleFallback(songID int64, hash string) *lyricDirectorAnalysis {
	db := repo.GetDB()
	if db == nil {
		return nil
	}
	var record model.LyricDirector
	if err := db.Where("song_id = ? AND lyric_hash = ?", songID, hash).First(&record).Error; err != nil {
		return nil
	}
	var parsed lyricDirectorAnalysis
	if err := json.Unmarshal([]byte(record.Data), &parsed); err != nil || parsed.isEmpty() {
		return nil
	}
	return &parsed
}

func (a *lyricDirectorService) save(songID int64, hash, stateKey, modelName string, analysis lyricDirectorAnalysis, ttl time.Duration) {
	if db := repo.GetDB(); db != nil {
		raw, _ := json.Marshal(analysis)
		record := &model.LyricDirector{
			SongID:    songID,
			LyricHash: hash,
			Data:      string(raw),
			Model:     modelName,
			CreatedAt: time.Now(),
		}
		upsert := clause.OnConflict{
			Columns: []clause.Column{
				{Name: "song_id"},
				{Name: "lyric_hash"},
			},
			DoUpdates: clause.AssignmentColumns([]string{"data", "model", "created_at"}),
		}
		if err := db.Clauses(upsert).Create(record).Error; err != nil {
			logrus.Warnf("save lyric director analysis for song %d failed: %v", songID, err)
		}
	}
	if err := sharedstate.SetJSON(a.dataKey(stateKey), analysis, ttl); err != nil {
		logrus.Warnf("save lyric director sharedstate %s failed: %v", stateKey, err)
	}
}

func (a *lyricDirectorService) analyzeSong(cfg tools.AIConfig, track *dto.MusicTrackDto, lines []string) (*lyricDirectorAnalysis, error) {
	user := buildLyricDirectorUserPrompt(track, lines)
	var lastCallErr, lastParseErr error
	for attempt := 0; attempt <= lyricDirectorMaxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(lyricDirectorRetryDelay)
		}
		raw, callErr := a.callFirstScreen(cfg, lyricDirectorSystemPrompt, user)
		if callErr != nil {
			lastCallErr = callErr
			continue
		}
		lastCallErr = nil
		parsed, parseErr := parseLyricDirectorAnalysis(raw)
		if parseErr != nil {
			lastParseErr = parseErr
			continue
		}
		parsed.SongLang = validateSongLangWithTexts(parsed.SongLang, lines)
		return &parsed, nil
	}
	if lastCallErr != nil {
		return nil, lastCallErr
	}
	logrus.Warnf("lyric director parse failed for song %d, degrading cleanly without blueprint: %v", track.ID, lastParseErr)
	return nil, nil
}

// getOrAnalyze 执行或复用 Stage 1（Router 侦测策划 Agent）的全曲导演分析。
// 非强制刷新时优先读取 sharedstate / DB 缓存，并使用跨实例租约防止多目标语言并发重复分析。
func (a *lyricDirectorService) getOrAnalyze(cfg tools.AIConfig, track *dto.MusicTrackDto, lines []string, forceRefresh bool) (*lyricDirectorAnalysis, error) {
	if a == nil || a.complete == nil || track == nil || len(lines) == 0 {
		return nil, nil
	}
	hash := computeLyricDirectorHash(lines)
	if hash == "" {
		return nil, nil
	}
	stateKey := strconv.FormatInt(track.ID, 10) + ":" + hash
	ttl := lyricDirectorCacheTTL()

	if !forceRefresh {
		if cached, ok := a.loadCached(track.ID, hash, stateKey, ttl); ok {
			return cached, nil
		}
	}

	jobKey := a.jobKey(stateKey)
	lease, err := sharedstate.AcquireLease(jobKey, lyricDirectorJobTTL)
	if err != nil {
		logrus.Warnf("acquire lyric director lease %s failed: %v", stateKey, err)
	}
	if err == nil && lease == nil && !forceRefresh {
		deadline := time.Now().Add(lyricDirectorWaitTimeout)
		for time.Now().Before(deadline) {
			if cached, ok := a.loadCached(track.ID, hash, stateKey, ttl); ok {
				return cached, nil
			}
			_, exists, existsErr := sharedstate.Current().Get(jobKey)
			if existsErr == nil && !exists {
				if cached, ok := a.loadCached(track.ID, hash, stateKey, ttl); ok {
					return cached, nil
				}
				break
			}
			time.Sleep(lyricDirectorWaitPoll)
		}
		if cached, ok := a.loadCached(track.ID, hash, stateKey, ttl); ok {
			return cached, nil
		}
		// 若并发持有者刚退出或超时，再尝试接手一次租约
		lease, _ = sharedstate.AcquireLease(jobKey, lyricDirectorJobTTL)
	}
	if lease != nil {
		defer lease.Release()
	}

	if !forceRefresh {
		if cached, ok := a.loadCached(track.ID, hash, stateKey, ttl); ok {
			return cached, nil
		}
	}

	analysis, genErr := a.analyzeSong(cfg, track, lines)
	if genErr != nil {
		if !forceRefresh {
			if fallback := a.loadStaleFallback(track.ID, hash); fallback != nil {
				return fallback, nil
			}
		}
		return nil, genErr
	}
	if analysis != nil && !analysis.isEmpty() {
		a.save(track.ID, hash, stateKey, cfg.Model, *analysis, ttl)
	}
	return analysis, nil
}

// lookupLyricDirectorVisualTheme 查询 Stage 1 产出的视觉色彩与动态粒子建议，供歌词特效标注阶段统一视觉基调。
func lookupLyricDirectorVisualTheme(songID int64, lines []string) string {
	if songID <= 0 {
		return ""
	}
	ttl := lyricDirectorCacheTTL()
	hash := computeLyricDirectorHash(lines)
	if hash != "" {
		stateKey := strconv.FormatInt(songID, 10) + ":" + hash
		if cached, ok := lyricDirectors.loadCached(songID, hash, stateKey, ttl); ok && cached.VisualTheme != "" {
			return cached.VisualTheme
		}
	}
	db := repo.GetDB()
	if db == nil {
		return ""
	}
	var record model.LyricDirector
	err := db.Where("song_id = ? AND created_at >= ?", songID, time.Now().Add(-ttl)).
		Order("created_at DESC").
		First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return ""
	}
	if err != nil {
		return ""
	}
	var parsed lyricDirectorAnalysis
	if json.Unmarshal([]byte(record.Data), &parsed) != nil {
		return ""
	}
	return parsed.VisualTheme
}

// lookupLyricDirectorSongLang 只读查询 Stage 1 导演分析缓存中的标准歌曲语言标签（不触发 AI 调用）。
func lookupLyricDirectorSongLang(songID int64, lines []string) string {
	if songID <= 0 {
		return ""
	}
	ttl := lyricDirectorCacheTTL()
	hash := computeLyricDirectorHash(lines)
	if hash != "" {
		stateKey := strconv.FormatInt(songID, 10) + ":" + hash
		if cached, ok := lyricDirectors.loadCached(songID, hash, stateKey, ttl); ok {
			if lang := validateSongLangWithTexts(cached.SongLang, lines); lang != "" {
				return lang
			}
		}
	}
	db := repo.GetDB()
	if db == nil {
		return ""
	}
	var record model.LyricDirector
	err := db.Where("song_id = ? AND created_at >= ?", songID, time.Now().Add(-ttl)).
		Order("created_at DESC").
		First(&record).Error
	if err != nil {
		return ""
	}
	var parsed lyricDirectorAnalysis
	if json.Unmarshal([]byte(record.Data), &parsed) != nil {
		return ""
	}
	return validateSongLangWithTexts(parsed.SongLang, lines)
}

// CleanupLyricDirectors 删除超过两倍默认保留期的过期歌词导演分析缓存。
func CleanupLyricDirectors(now time.Time) (int64, error) {
	db := repo.GetDB()
	if db == nil {
		return 0, nil
	}
	retention := time.Duration(lyricDirectorTTLDefaultDays*2) * 24 * time.Hour
	result := db.Where("created_at < ?", now.Add(-retention)).Delete(&model.LyricDirector{})
	return result.RowsAffected, result.Error
}
