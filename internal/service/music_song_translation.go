package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
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

// 歌曲标题与歌手名的多语言 AI 翻译服务：
// 按「歌曲 ID + 目标语言」保存；严格遵循「仅使用公认官方译名，无公认译名时才音译到目标语言，禁止臆造意译」。

const (
	songTranslationTimeout     = 45 * time.Second
	songTranslationJobTTL      = time.Minute
	songTranslationRetryAfter  = 5 * time.Minute
	songTranslationTemperature = 0.1
	songTranslationReasoning   = "none"
)

type songTranslationService struct {
	name        string
	initOnce    sync.Once
	mu          sync.Mutex
	limiter     *llmclient.Limiter
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
	done        func()
}

var songTranslations = &songTranslationService{
	name:    "music_song_translation",
	limiter: llmclient.DefaultLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, songTranslationTemperature, songTranslationReasoning)
	},
	concurrency: tools.GetAISummaryConcurrency,
}

type songTranslationInput struct {
	Track       *dto.MusicTrackDto
	TargetLang  string
	MetaHash    string
	ArtistHints [][]string
}

type songTranslationModelResp struct {
	Title   string   `json:"title"`
	Artists []string `json:"artists"`
}

// GetSongTranslationMeta 获取歌曲名与歌手名的 AI 翻译；尚未生成时开启后台任务并返回 pending
func (s *MusicService) GetSongTranslationMeta(ctx context.Context, id int64, lang string) (*dto.MusicSongTranslationDto, *errs.ServiceError) {
	input, sameLang, svcerr := s.prepareSongTranslation(ctx, id, lang)
	if svcerr != nil {
		return nil, svcerr
	}
	if sameLang {
		return &dto.MusicSongTranslationDto{
			Status:       lyricTranslationStatusReady,
			TargetLang:   input.TargetLang,
			SameLanguage: true,
			Artists:      make([]string, len(input.Track.Artists)),
		}, nil
	}
	return songTranslations.getOrStart(input)
}

// RefreshSongTranslationMeta 管理员手动重新生成指定语言的歌名与歌手翻译
func (s *MusicService) RefreshSongTranslationMeta(ctx context.Context, id int64, lang string) (*dto.MusicSongTranslationDto, *errs.ServiceError) {
	input, sameLang, svcerr := s.prepareSongTranslation(ctx, id, lang)
	if svcerr != nil {
		return nil, svcerr
	}
	if sameLang {
		return &dto.MusicSongTranslationDto{
			Status:       lyricTranslationStatusReady,
			TargetLang:   input.TargetLang,
			SameLanguage: true,
			Artists:      make([]string, len(input.Track.Artists)),
		}, nil
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	return songTranslations.refresh(input, cfg), nil
}

func (s *MusicService) prepareSongTranslation(ctx context.Context, id int64, rawLang string) (*songTranslationInput, bool, *errs.ServiceError) {
	targetLang := normalizeLyricLangTag(rawLang)
	if id <= 0 || lyricTranslateLanguages[targetLang] == "" {
		return nil, false, errs.NewBadRequest("invalid_request_parameters")
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
		return nil, false, errs.NewNotFound("lyric_translations_unavailable")
	}
	hints := loadSongHints(id)
	copied := *track
	if len(copied.Aliases) == 0 && len(hints.TrackAliases) > 0 {
		copied.Aliases = hints.TrackAliases
	}
	input := &songTranslationInput{
		Track:       &copied,
		TargetLang:  targetLang,
		MetaHash:    computeSongMetaHash(copied.Name, copied.Artists),
		ArtistHints: hints.ArtistHints,
	}
	sameLang := songMetaAlreadyInTargetLang(copied.Name, copied.Artists, targetLang)
	return input, sameLang, nil
}

func computeSongMetaHash(title string, artists []string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(title) + "\n" + strings.Join(artists, "\x1f")))
	return hex.EncodeToString(sum[:])
}

// songMetaAlreadyInTargetLang 判断歌名与全部歌手名是否已完全处于目标语言（避免无意义的模型调用）
func songMetaAlreadyInTargetLang(title string, artists []string, targetLang string) bool {
	texts := make([]string, 0, 1+len(artists))
	if t := strings.TrimSpace(title); t != "" {
		texts = append(texts, t)
	}
	for _, a := range artists {
		if t := strings.TrimSpace(a); t != "" {
			texts = append(texts, t)
		}
	}
	if len(texts) == 0 {
		return true
	}
	stats, _ := countLyricScripts(texts)
	total := stats.han + stats.kana + stats.hang + stats.latin + stats.other
	if total == 0 {
		return true
	}
	switch targetLang {
	case "zh":
		return stats.han > 0 && stats.trad == 0 && stats.kana == 0 && stats.hang == 0 && stats.latin == 0 && stats.other == 0
	case "zh-tw", "zh-hk":
		return stats.trad >= 2 && stats.simp == 0 && stats.kana == 0 && stats.hang == 0 && stats.latin == 0 && stats.other == 0
	case "en":
		return stats.latin > 0 && stats.han == 0 && stats.kana == 0 && stats.hang == 0 && stats.other == 0
	case "ja":
		return stats.kana > 0 && stats.han == 0 && stats.hang == 0 && stats.latin == 0 && stats.other == 0
	case "ko":
		return stats.hang > 0 && stats.han == 0 && stats.kana == 0 && stats.latin == 0 && stats.other == 0
	default:
		return false
	}
}

func (a *songTranslationService) prefix() string {
	a.initOnce.Do(func() {
		if a.name == "" {
			a.name = "music_song_tr_" + utils.Strings.GenerateRandomString(8)
		}
	})
	return a.name
}

func (a *songTranslationService) stateKeys(songID int64, targetLang string) (job, failed string) {
	suffix := fmt.Sprintf("%d:%s", songID, targetLang)
	return a.prefix() + ":job:" + suffix, a.prefix() + ":failed:" + suffix
}

func (a *songTranslationService) jobState(songID int64, targetLang string) (running, coolingDown bool) {
	jobKey, failedKey := a.stateKeys(songID, targetLang)
	values, err := sharedstate.Current().GetMany(jobKey, failedKey)
	if err != nil {
		return false, false
	}
	_, running = values[jobKey]
	_, coolingDown = values[failedKey]
	return running, coolingDown
}

func (a *songTranslationService) getOrStart(input *songTranslationInput) (*dto.MusicSongTranslationDto, *errs.ServiceError) {
	a.mu.Lock()
	defer a.mu.Unlock()

	running, coolingDown := a.jobState(input.Track.ID, input.TargetLang)
	var record model.MusicSongTranslation
	err := repo.GetDB().Where("song_id = ? AND target_lang = ?", input.Track.ID, input.TargetLang).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	if err == nil && record.MetaHash == input.MetaHash {
		artists := parseSongTranslatedArtists(record.Artists, len(input.Track.Artists))
		return &dto.MusicSongTranslationDto{
			Status:     lyricTranslationStatusReady,
			Stale:      running,
			TargetLang: input.TargetLang,
			Title:      record.Title,
			Artists:    artists,
		}, nil
	}

	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("lyric_translations_unavailable")
	}
	if running {
		if err == nil {
			// 元信息变更重译期间先返回旧结果（marked stale）
			return &dto.MusicSongTranslationDto{
				Status:     lyricTranslationStatusReady,
				Stale:      true,
				TargetLang: input.TargetLang,
				Title:      record.Title,
				Artists:    parseSongTranslatedArtists(record.Artists, len(input.Track.Artists)),
			}, nil
		}
		return &dto.MusicSongTranslationDto{
			Status:     lyricTranslationStatusPending,
			TargetLang: input.TargetLang,
			Artists:    make([]string, len(input.Track.Artists)),
		}, nil
	}
	if coolingDown {
		return nil, errs.NewNotFound("lyric_translations_failed")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	a.startLocked(input, cfg)
	return &dto.MusicSongTranslationDto{
		Status:     lyricTranslationStatusPending,
		TargetLang: input.TargetLang,
		Artists:    make([]string, len(input.Track.Artists)),
	}, nil
}

func (a *songTranslationService) refresh(input *songTranslationInput, cfg tools.AIConfig) *dto.MusicSongTranslationDto {
	a.mu.Lock()
	defer a.mu.Unlock()
	if running, _ := a.jobState(input.Track.ID, input.TargetLang); !running {
		a.startLocked(input, cfg)
	}
	var record model.MusicSongTranslation
	if err := repo.GetDB().Where("song_id = ? AND target_lang = ?", input.Track.ID, input.TargetLang).First(&record).Error; err == nil {
		return &dto.MusicSongTranslationDto{
			Status:     lyricTranslationStatusReady,
			Stale:      true,
			TargetLang: input.TargetLang,
			Title:      record.Title,
			Artists:    parseSongTranslatedArtists(record.Artists, len(input.Track.Artists)),
		}
	}
	return &dto.MusicSongTranslationDto{
		Status:     lyricTranslationStatusPending,
		TargetLang: input.TargetLang,
		Artists:    make([]string, len(input.Track.Artists)),
	}
}

func (a *songTranslationService) startLocked(input *songTranslationInput, cfg tools.AIConfig) {
	jobKey, failedKey := a.stateKeys(input.Track.ID, input.TargetLang)
	lease, err := sharedstate.AcquireLease(jobKey, songTranslationJobTTL)
	if err != nil || lease == nil {
		return
	}
	_ = sharedstate.Current().Delete(failedKey)
	go a.execute(lease, input, cfg)
}

func (a *songTranslationService) execute(lease *sharedstate.Lease, input *songTranslationInput, cfg tools.AIConfig) {
	var jobErr error
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("song translation panic for song %d (%s): %v", input.Track.ID, input.TargetLang, r)
			jobErr = fmt.Errorf("panic: %v", r)
		}
		if jobErr != nil {
			_, failedKey := a.stateKeys(input.Track.ID, input.TargetLang)
			_ = sharedstate.Current().Set(failedKey, "1", songTranslationRetryAfter)
		}
		lease.Release()
		if a.done != nil {
			a.done()
		}
	}()

	title, artists, err := a.generate(cfg, input)
	if err != nil {
		logrus.Warnf("song translation failed for song %d (%s): %v", input.Track.ID, input.TargetLang, err)
		jobErr = err
		return
	}
	artistsJSON, _ := json.Marshal(artists)
	record := &model.MusicSongTranslation{
		SongID:     input.Track.ID,
		TargetLang: input.TargetLang,
		MetaHash:   input.MetaHash,
		Title:      title,
		Artists:    string(artistsJSON),
		Model:      cfg.Model,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "target_lang"}},
		DoUpdates: clause.AssignmentColumns([]string{"meta_hash", "title", "artists", "model", "updated_at"}),
	}
	if dbErr := repo.GetDB().Clauses(upsert).Create(record).Error; dbErr != nil {
		logrus.Errorf("save song translation for song %d (%s) failed: %v", input.Track.ID, input.TargetLang, dbErr)
		jobErr = dbErr
	}
}

func (a *songTranslationService) generate(cfg tools.AIConfig, input *songTranslationInput) (string, []string, error) {
	_ = a.limiter.AcquireTier(context.Background(), a.concurrency, llmclient.TierFirstScreen, nil)
	defer a.limiter.Release()

	ctx, cancel := context.WithTimeout(withLLMPurpose(context.Background(), constant.LLMPurposeTranslation, 0), songTranslationTimeout)
	defer cancel()

	system := buildSongTranslationSystemPrompt(input.TargetLang)
	user := buildSongTranslationUserPrompt(input)
	raw, err := a.complete(ctx, cfg, system, user)
	if err != nil {
		return "", nil, err
	}
	return parseSongTranslationResponse(raw, input.Track.Name, input.Track.Artists, input.TargetLang)
}

func buildSongTranslationSystemPrompt(targetLang string) string {
	targetDesc := lyricTranslateLanguages[targetLang]
	var b strings.Builder
	b.WriteString("You localize song titles and artist names strictly according to established naming conventions.\n")
	b.WriteString(fmt.Sprintf("Target language: %s (code: %s).\n\n", targetDesc, targetLang))
	b.WriteString("STRICT NAMING PRINCIPLE (MUST OBEY):\n")
	b.WriteString("1. NEVER invent or fabricate literal/semantic translations for a song title or an artist name!\n")
	b.WriteString("2. First priority — established / publicly recognized localized name:\n")
	b.WriteString("   - If there is an officially released or widely established localized name in the target language/region (e.g. from track aliases/artist_hints or well-known official discography titles), use that exact established name.\n")
	b.WriteString("   - Respect regional Traditional Chinese artist/song conventions when targetLang is zh-tw vs zh-hk (e.g. Taylor Swift -> zh: 泰勒·斯威夫特, zh-tw: 泰勒絲; Adele -> zh: 阿黛尔, zh-tw: 愛黛兒; 周杰伦 -> zh-tw/zh-hk: 周杰倫, en: Jay Chou, ja: ジェイ・チョウ, ko: 주걸륜).\n")
	b.WriteString("   - If an artist/song in target_lang is canonically referred to by its original name (e.g. YOASOBI, RADWIMPS, Aimer, or an English song title officially kept as-is), return \"\" (empty string) for that item.\n")
	b.WriteString("3. Second priority — phonetic transliteration ONLY when no recognized translation exists:\n")
	b.WriteString("   - Only when an item is in a foreign script not readable directly in target_lang AND has no established translation, transliterate it phonetically into target_lang's writing system (Katakana for ja, Hangul for ko, Latin romanization for en, standard phonetic Hanzi for zh/zh-tw/zh-hk — do NOT translate proper names word-for-word semantically).\n")
	b.WriteString("   - For CJK -> zh-tw/zh-hk or Traditional -> zh, perform accurate regional orthography conversion if characters differ (e.g. 周杰伦 -> 周杰倫), returning \"\" if already identical in target_lang.\n")
	b.WriteString("4. Output constraints:\n")
	b.WriteString("   - Never return an identical copy of the input string; return \"\" instead.\n")
	b.WriteString("   - Keep parenthetical subtitle/feat info concise or omit redundant decorations.\n")
	b.WriteString("   - Output \"artists\" array with EXACTLY the same length and order as input \"artists\".\n")
	b.WriteString("   - Output strictly one valid JSON object: {\"title\":\"<string>\",\"artists\":[\"<string>\",...]}. No markdown fences.\n")
	return b.String()
}

func buildSongTranslationUserPrompt(input *songTranslationInput) string {
	payload := struct {
		TargetLang  string     `json:"target_lang"`
		Title       string     `json:"title"`
		Aliases     []string   `json:"aliases,omitempty"`
		Artists     []string   `json:"artists"`
		ArtistHints [][]string `json:"artist_hints,omitempty"`
		Album       string     `json:"album,omitempty"`
	}{
		TargetLang:  fmt.Sprintf("%s (%s)", input.TargetLang, lyricTranslateLanguages[input.TargetLang]),
		Title:       input.Track.Name,
		Aliases:     input.Track.Aliases,
		Artists:     input.Track.Artists,
		ArtistHints: input.ArtistHints,
		Album:       input.Track.Album,
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func parseSongTranslationResponse(raw, origTitle string, origArtists []string, targetLang string) (string, []string, error) {
	obj, err := extractJSONObject(raw)
	if err != nil {
		return "", nil, err
	}
	var parsed songTranslationModelResp
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return "", nil, err
	}
	title := sanitizeSongMetaItem(origTitle, parsed.Title, targetLang, 120)
	artists := make([]string, len(origArtists))
	for i, origArtist := range origArtists {
		if i < len(parsed.Artists) {
			artists[i] = sanitizeSongMetaItem(origArtist, parsed.Artists[i], targetLang, 80)
		}
	}
	return title, artists, nil
}

func sanitizeSongMetaItem(orig, translated, targetLang string, maxRunes int) string {
	tr := collapseLyricSpace(translated)
	if tr == "" {
		return ""
	}
	if runes := []rune(tr); len(runes) > maxRunes {
		tr = string(runes[:maxRunes])
	}
	if strings.EqualFold(tr, collapseLyricSpace(orig)) || (normalizeLyricMatch(tr) != "" && normalizeLyricMatch(tr) == normalizeLyricMatch(orig)) {
		return ""
	}
	// 对歌曲名/歌手名只拦明确输出错语种字符的情况（保留国际英文艺名、日韩平假名/片假名等合理字符）
	if !isValidSongMetaScript(orig, tr, targetLang) {
		return ""
	}
	return tr
}

func isValidSongMetaScript(orig, tr, targetLang string) bool {
	origStats, _ := countLyricScripts([]string{orig})
	trStats, _ := countLyricScripts([]string{tr})
	if trStats.han+trStats.kana+trStats.hang+trStats.latin+trStats.other == 0 {
		return false
	}
	switch targetLang {
	case "ja":
		if trStats.hang > 0 && origStats.hang == 0 {
			return false
		}
		if trStats.kana == 0 && trStats.latin == 0 && trStats.simp > 0 {
			return false
		}
		return true
	case "ko":
		return !(trStats.han > 0 && trStats.hang == 0)
	case "en":
		if (trStats.han > 0 && origStats.han == 0) || (trStats.kana > 0 && origStats.kana == 0) || (trStats.hang > 0 && origStats.hang == 0) {
			return false
		}
		if trStats.latin == 0 && (trStats.han+trStats.kana+trStats.hang) > 0 {
			return false
		}
		return true
	case "zh", "zh-tw", "zh-hk":
		// 中文目标保留英文或中文名，不接受突然多出的非中文谚文/假名
		if (trStats.kana > 0 && origStats.kana == 0) || (trStats.hang > 0 && origStats.hang == 0) {
			return false
		}
		return true
	default:
		_ = utf8.RuneCountInString(tr)
		return true
	}
}

func parseSongTranslatedArtists(raw string, count int) []string {
	var parsed []string
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &parsed)
	}
	out := make([]string, count)
	for i := 0; i < count && i < len(parsed); i++ {
		out[i] = parsed[i]
	}
	return out
}
