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
Analyze the song's genre, emotional vibe, narrative perspective, and hidden cultural idioms/metonyms/slang across the full lyrics.
Output strictly a single valid JSON object matching the following schema:
{
  "genre": "A specific, accurate genre tag. You are NOT restricted to standard categories—freely synthesize compound or niche genres as appropriate (e.g., 'classical_poetry', 'anime_denpa', 'cyberpunk_synthwave', 'traditional_opera_fusion', 'lofi_chill_rnb', 'emo_rap', 'gothic_rock', 'kpop_dance')",
  "mood": "dominant emotion in 2-3 expressive adjectives (e.g., bittersweet nostalgia, manic euphoria, desolate solitude)",
  "cultural_notes": [
    {
      "term": "original term / phrase in lyrics",
      "metonymy_meaning": "actual contextual meaning, e.g. 五陵年少 = wealthy noble youth of the capital, NOT tombs; 青丝 = youth or jet-black hair, NOT green thread; 阿姨 = brothel madam in Tang context, NOT aunt"
    }
  ],
  "custom_style_skills": [
    "Specific craft rule #1 for this exact song (e.g. For this melancholic jazz ballad, use smoky conversational phrasing with subtle enjambment)",
    "Specific craft rule #2 for this exact song (e.g. For this cyberpunk track, translate tech metaphors sharply, using industrial, metallic imagery)"
  ],
  "translation_directive": "concise overall directive on rhythm, tone, lyrical voice, and rhyme preference",
  "visual_theme": "suggested visual color palette and dynamic particle effects (e.g., neon violet raindrops on wet asphalt, floating amber lotus petals)"
}`

type lyricCulturalNote struct {
	Term            string `json:"term"`
	MetonymyMeaning string `json:"metonymy_meaning"`
}

type lyricDirectorAnalysis struct {
	Genre                string              `json:"genre"`
	Mood                 string              `json:"mood"`
	CulturalNotes        []lyricCulturalNote `json:"cultural_notes,omitempty"`
	CustomStyleSkills    []string            `json:"custom_style_skills,omitempty"`
	TranslationDirective string              `json:"translation_directive"`
	VisualTheme          string              `json:"visual_theme"`
}

func (d *lyricDirectorAnalysis) isEmpty() bool {
	if d == nil {
		return true
	}
	return d.Genre == "" && d.Mood == "" && len(d.CulturalNotes) == 0 && len(d.CustomStyleSkills) == 0 && d.TranslationDirective == "" && d.VisualTheme == ""
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
	days := tools.GetLyricAnnotationTTLDays()
	if days <= 0 {
		days = lyricDirectorTTLDefaultDays
	}
	return time.Duration(days) * 24 * time.Hour
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
	sum := sha256.Sum256([]byte(strings.Join(normalized, "\n")))
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

// CleanupLyricDirectors 删除超过两倍 TTL 的过期歌词导演分析缓存。
func CleanupLyricDirectors(now time.Time) (int64, error) {
	db := repo.GetDB()
	if db == nil {
		return 0, nil
	}
	days := max(lyricDirectorTTLDefaultDays, tools.GetLyricAnnotationTTLDays())
	retention := time.Duration(days*2) * 24 * time.Hour
	result := db.Where("created_at < ?", now.Add(-retention)).Delete(&model.LyricDirector{})
	return result.RowsAffected, result.Error
}
