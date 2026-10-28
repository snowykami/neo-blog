package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 歌词标注（见 docs/music-player-spec.md 7.2b）：读者第一次播放某首歌时，用站点配置的大模型对歌词文本做一次标注——
// 哪些词句值得强调、用什么特效、每行的情绪基调、哪些是副歌——按「歌曲 id + 歌词文本哈希」永久保存，之后直接读取。
// - 标注只引用歌词原文（行号与行内的连续片段），不含也不改变任何时间；后端逐条校验，引用不到原文的标注一律丢弃
// - 只为博客歌单内的歌曲生成（避免公开接口被拿来消耗模型额度），与 AI 摘要共用全局并发限制
// - 生成是后台任务：接口立即返回 pending，前端稍后再取；失败后 30 分钟内不重试
// - 有效期可在后台配置（默认 7 天）：过期后先返回旧结果（stale），同时在后台重新生成；管理员可手动刷新单首歌

const (
	lyricAnnotationStatusReady   = "ready"
	lyricAnnotationStatusPending = "pending"

	lyricAnnotationTimeout       = 2 * time.Minute
	lyricAnnotationRetryAfter    = 30 * time.Minute
	lyricAnnotationMaxLines      = 150
	lyricAnnotationMaxLineRunes  = 120
	lyricAnnotationMaxPhraseRune = 12
	lyricAnnotationMaxPerLine    = 3
	lyricAnnotationMaxScenes     = 6
	// 导语最长字数（提示词要求 40 字以内，留些余量）
	lyricAnnotationMaxIntroRunes = 60
	// 关键节点「时刻」的数量上限
	lyricAnnotationMaxMoments = 5
	// 换字体的短语上限：太多会显得杂乱
	lyricAnnotationMaxPhraseFonts = 10
	// 消散、流光、心跳每种的上限
	lyricAnnotationMaxSpecialEffect = 3
	// 标注的温度：调高让演出设计更大胆
	lyricAnnotationTemperature = 0.9
	// 思考强度（reasoning_effort）：思考型模型默认的思考内容是正式输出的 3～9 倍，是生成慢的主要原因
	// （实测一首歌 70～145 秒）；提示词已给出完整的步骤与约束，关闭思考后质量相当，一首歌 10～20 秒
	lyricAnnotationReasoningEffort = "none"
)

var (
	lyricAnnotationMoods = map[string]bool{"calm": true, "bright": true, "sad": true, "intense": true}
	// 消散、流光、心跳全曲每种最多 lyricAnnotationMaxSpecialEffect 处，超出的换成相近的常规特效
	lyricAnnotationSpecialEffects = map[string]string{"dissolve": "glow", "shimmer": "glow", "heartbeat": "swell"}
	lyricAnnotationEffects        = map[string]bool{"swell": true, "glow": true, "wave": true, "shake": true, "focus": true, "dissolve": true, "shimmer": true, "heartbeat": true}
	// 行级全屏粒子场景（只在播放器页演出）
	lyricAnnotationScenes = func() map[string]bool {
		scenes := make(map[string]bool, len(lyricAnnotationSceneList))
		for _, scene := range lyricAnnotationSceneList {
			scenes[scene.Key] = true
		}
		return scenes
	}()
	// 短语可选的颜色：只允许 lyricAnnotationPalette 中的名称（具体色值由前端决定，保证在深浅背景上都清晰）
	lyricAnnotationColors = func() map[string]bool {
		colors := make(map[string]bool, len(lyricAnnotationPalette))
		for _, color := range lyricAnnotationPalette {
			colors[color.Key] = true
		}
		return colors
	}()
	// 旧版 8 色的名称：映射到新色板中最接近的颜色，已保存的标注与模型偶尔输出的旧名称仍然可用
	lyricAnnotationLegacyColors = map[string]string{"red": "crimson", "orange": "amber", "green": "forest", "cyan": "lake", "blue": "ocean", "pink": "cherry-blossom"}
	// 歌词行头：LRC 的 [mm:ss.xx]（可有多个）或 YRC / QRC 的 [开始,时长]
	lyricLineHeadRe = regexp.MustCompile(`^(?:\[(?:\d+:\d+(?:[.:]\d+)?|\d+,\d+)\])+`)
	// 逐字时间标签：YRC 的 (开始,时长,0)（在字前）、QRC 的 (开始,时长)（在字后）；第 1 组为时长，第 2 组只有 YRC 有
	lyricWordTagRe = regexp.MustCompile(`\(\d+,(\d+)(,\d+)?\)`)
)

// lyricAnnotationColor 色板中的一种颜色：英文名（模型输出与前端色值的键）、中文名与适合的意象，名称与意象写进提示词供模型挑选
type lyricAnnotationColor struct {
	Key, Name, Hint string
}

// lyricAnnotationPalette 歌词上色的语义化色板（与前端 web/src/lib/lyrics/colors.ts 保持一致）
var lyricAnnotationPalette = []lyricAnnotationColor{
	{"crimson", "绯红", "热烈、心跳、鲜血、红色本身"},
	{"rose", "玫瑰红", "玫瑰、爱情、告白、吻"},
	{"flame", "火焰红", "火焰、燃烧、激情、战斗"},
	{"sunset", "晚霞红", "黄昏、晚霞、夕阳、离别"},
	{"coral", "珊瑚橙", "珊瑚、海边、盛夏"},
	{"maple", "枫叶橙", "枫叶、深秋、落叶"},
	{"amber", "琥珀橙", "秋天、怀旧、灯火、旧时光"},
	{"peach", "蜜桃粉", "脸红、甜蜜、心动、害羞"},
	{"cherry-blossom", "樱花粉", "樱花、春天、少女心、初恋"},
	{"bauhinia", "紫荆红", "紫荆花、洋紫荆、香港"},
	{"sunshine", "阳光金", "阳光、晴天、夏天、希望"},
	{"gold", "鎏金", "荣耀、梦想、光芒、宝藏、金色"},
	{"lemon", "柠檬黄", "清新、青春、俏皮、活力"},
	{"candlelight", "烛光暖黄", "烛光、温暖、家、拥抱、陪伴"},
	{"spring-green", "嫩芽绿", "嫩芽、发芽、新生、成长"},
	{"forest", "森林绿", "森林、树木、草地、大自然"},
	{"mint", "薄荷绿", "清凉、微风、夏日午后"},
	{"jade", "翡翠绿", "翡翠、宝石、湖光、古典"},
	{"aurora", "极光绿", "极光、奇幻、遥远的北方"},
	{"lake", "湖水青", "湖水、溪流、清澈、倒影"},
	{"sky", "天空蓝", "晴空、自由、飞翔、远方"},
	{"ocean", "海洋蓝", "大海、海港、浪花、远航"},
	{"starry-blue", "星空蓝", "星空、夜晚、宇宙、梦想"},
	{"midnight", "午夜蓝", "深夜、思念、寂静、失眠"},
	{"ice", "冰蓝", "冰雪、寒冷、冬天、疏离"},
	{"rain", "雨幕蓝灰", "雨天、忧郁、泪水、阴天"},
	{"lavender", "薰衣草紫", "薰衣草、浪漫、温柔的思念"},
	{"violet", "罗兰紫", "紫罗兰、神秘、高贵、紫色本身"},
	{"twilight", "暮光紫", "暮色、黄昏后、暧昧、朦胧"},
	{"wisteria", "紫藤", "紫藤花、柔美、等待"},
	{"moonlight", "月光白", "月亮、月光、纯洁、皎洁"},
	{"silver", "银白", "银河、金属、冷静、时间流逝"},
}

// lyricAnnotationScene 全屏粒子场景：英文名（模型输出与前端绘制的键）、中文名与适合的画面，写进提示词供模型挑选
type lyricAnnotationScene struct {
	Key, Name, Hint string
}

// lyricAnnotationSceneList 全屏粒子场景（与前端 web/src/lib/lyrics/stage-particles.ts 保持一致）
var lyricAnnotationSceneList = []lyricAnnotationScene{
	{"petals", "花瓣", "花、花瓣飘落、春天"},
	{"sparks", "光点", "光芒、火花、闪耀、希望"},
	{"snow", "雪", "雪、冬天、寒冷"},
	{"stars", "星空", "星星、夜空、宇宙"},
	{"bubbles", "气泡", "水下、海底、汽水、梦幻"},
	{"rain", "雨", "雨、阴天、泪水"},
	{"leaves", "落叶", "落叶、秋天、凋零、离别"},
	{"fireflies", "萤火虫", "萤火虫、夏夜、田野、童年"},
	{"feathers", "羽毛", "羽毛、翅膀、天使、轻盈"},
	{"hearts", "爱心", "爱、心动、告白、甜蜜"},
	{"confetti", "彩色纸屑", "庆祝、派对、生日、欢呼"},
	{"fireworks", "烟花", "烟花、节日、跨年、绚烂而短暂"},
	{"dandelion", "蒲公英", "蒲公英、随风、漂泊、远行"},
	{"butterflies", "蝴蝶", "蝴蝶、花园、蜕变、自由"},
	{"meteors", "流星", "流星、许愿、转瞬即逝"},
	{"clouds", "云雾", "云、雾、天空、朦胧"},
	{"ripples", "涟漪", "湖面、水面、雨落水中、心起波澜"},
	{"notes", "音符", "唱歌、旋律、音乐本身"},
}

// lyricAnnotationFont 字体：英文名（模型输出与前端字体栈的键）、中文名与适合的气质，写进提示词供模型挑选
type lyricAnnotationFont struct {
	Key, Name, Hint string
}

// lyricAnnotationFontList 可选字体（与前端 web/src/lib/lyrics/lyric-player.css 的字体栈保持一致）
var lyricAnnotationFontList = []lyricAnnotationFont{
	{"song", "宋体", "古典、文艺、诗意、怀旧"},
	{"kai", "楷体", "书信、手写、古风、私语、温柔"},
	{"xingkai", "行楷", "书法、豪迈、江湖、写意"},
	{"fangsong", "仿宋", "旧时光、老电影字幕、日记"},
	{"round", "圆体", "可爱、童真、甜美、轻松"},
	{"mono", "等宽", "电子、机械、科幻、数字、冷感"},
	{"script", "英文花体", "浪漫、优雅（只对英文字母有效）"},
}

var (
	lyricAnnotationFonts = func() map[string]bool {
		fonts := make(map[string]bool, len(lyricAnnotationFontList))
		for _, font := range lyricAnnotationFontList {
			fonts[font.Key] = true
		}
		return fonts
	}()
	// 短语字形：粗体、斜体、下划线（下划线在演唱时逐字画出）；删除线已去掉（被否定、放弃的词改用 dissolve 消散），旧标注中的 strike 校验时丢弃
	lyricAnnotationStyles = map[string]bool{"bold": true, "italic": true, "underline": true}
)

// normalizeLyricColor 规范化颜色名：旧版名称映射到新色板，不在色板中的返回空字符串（不上色）
func normalizeLyricColor(color string) string {
	if mapped, ok := lyricAnnotationLegacyColors[color]; ok {
		return mapped
	}
	if lyricAnnotationColors[color] {
		return color
	}
	return ""
}

// lyricAnnotationJob 一首歌（一份歌词文本）的生成任务状态（进程内）
type lyricAnnotationJob struct {
	running     bool
	failedUntil time.Time
}

type lyricAnnotationService struct {
	mu      sync.Mutex
	jobs    map[string]*lyricAnnotationJob
	limiter *aiLimiter
	// complete 调用大模型，测试时可替换
	complete func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	// hotComments / chorus 生成时拉取热评与网易云副歌片段，可为 nil（测试时不拉取）
	hotComments func(ctx context.Context, id int64) []lyricAnnotationComment
	chorus      func(ctx context.Context, id int64) []dto.MusicChorusDto
	// wordTimed 生成时取 QQ 音乐 / 酷狗的逐字歌词（送去标注的歌词没有逐字时间时，向它借长音），可为 nil
	wordTimed   func(ctx context.Context, id int64) string
	concurrency func() int
	// done 任务结束时调用（测试用），可为 nil
	done func()
}

var lyricAnnotations = &lyricAnnotationService{
	jobs:    make(map[string]*lyricAnnotationJob),
	limiter: aiCallLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithReasoning(ctx, cfg, system, user, lyricAnnotationTemperature, lyricAnnotationReasoningEffort)
	},
	hotComments: fetchNCMHotComments,
	chorus:      fetchSongChorus,
	wordTimed:   fetchWordTimedLyric,
	concurrency: tools.GetAISummaryConcurrency,
}

// fetchWordTimedLyric QQ 音乐或酷狗的逐字歌词（QRC，均有缓存；按前端的来源顺序先 QQ 音乐），都没有时为空
func fetchWordTimedLyric(ctx context.Context, id int64) string {
	s := NewMusicService()
	if qq, svcerr := s.cachedQQLyric(ctx, id); svcerr == nil && qq.Format == "qrc" {
		return qq.Lyric
	}
	if kugou, svcerr := s.cachedKugouLyric(ctx, id); svcerr == nil && kugou.Format == "qrc" {
		return kugou.Lyric
	}
	return ""
}

// GetLyricAnnotations 取一首歌的歌词标注；还没有时开始生成并返回 pending，已过期时返回旧结果并在后台重新生成
func (s *MusicService) GetLyricAnnotations(ctx context.Context, id int64) (*dto.MusicLyricAnnotationsDto, *errs.ServiceError) {
	lines, info, cfg, svcerr := s.prepareLyricAnnotations(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	ttl := time.Duration(tools.GetLyricAnnotationTTLDays()) * 24 * time.Hour
	return lyricAnnotations.get(id, lines, info, cfg, ttl)
}

// RefreshLyricAnnotations 管理员手动重新生成一首歌的歌词标注（忽略有效期与失败冷却），旧结果在新结果生成前继续使用
func (s *MusicService) RefreshLyricAnnotations(ctx context.Context, id int64) (*dto.MusicLyricAnnotationsDto, *errs.ServiceError) {
	lines, info, cfg, svcerr := s.prepareLyricAnnotations(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	return lyricAnnotations.refresh(id, lines, info, cfg), nil
}

// prepareLyricAnnotations 校验能否为这首歌生成标注，并取出送去标注的歌词文本、上下文（热评在生成时再取）与模型配置
func (s *MusicService) prepareLyricAnnotations(ctx context.Context, id int64) ([]string, lyricAnnotationInfo, tools.AIConfig, *errs.ServiceError) {
	if id <= 0 {
		return nil, lyricAnnotationInfo{}, tools.AIConfig{}, errs.NewBadRequest("invalid_request_parameters")
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, lyricAnnotationInfo{}, cfg, errs.NewNotFound("lyric_annotations_unavailable")
	}
	track := s.playlistTrack(ctx, id)
	if track == nil {
		return nil, lyricAnnotationInfo{}, cfg, errs.NewNotFound("lyric_annotations_unavailable")
	}
	lines, info, svcerr := s.annotationSource(ctx, track)
	if svcerr != nil {
		return nil, lyricAnnotationInfo{}, cfg, svcerr
	}
	return lines, info, cfg, nil
}

// playlistTrack 博客歌单中的这首歌；只有网易云歌单由后端提供，静态歌单无法校验，视为不在歌单内（返回 nil）
func (s *MusicService) playlistTrack(ctx context.Context, id int64) *dto.MusicTrackDto {
	if !tools.GetNCMConfig().Configured() {
		return nil
	}
	tracks, svcerr := s.GetPlaylist(ctx)
	if svcerr != nil {
		return nil
	}
	for i := range tracks {
		if tracks[i].ID == id {
			return &tracks[i]
		}
	}
	return nil
}

// annotationSource 送去标注的歌词文本（每行一句，去掉时间标签）与上下文（歌曲信息、逐行中文翻译）：
// 优先网易云逐字歌词，其次网易云逐行歌词，网易云没有歌词时依次用 QQ 音乐、酷狗的歌词；翻译取自同一来源
func (s *MusicService) annotationSource(ctx context.Context, track *dto.MusicTrackDto) ([]string, lyricAnnotationInfo, *errs.ServiceError) {
	var timed []lyricTimedLine
	translation := ""
	wordTimed := false
	if lyric, svcerr := s.GetLyric(ctx, track.ID); svcerr == nil {
		if lyric.Yrc != nil {
			timed = lyricTimedLines(lyric.Yrc.Lyric, lyricAnnotationMaxLines)
			translation = lyricTranslationSource(lyric, true)
			wordTimed = len(timed) > 0
		}
		if len(timed) == 0 && lyric.Lrc != nil {
			timed = lyricTimedLines(lyric.Lrc.Lyric, lyricAnnotationMaxLines)
			translation = lyricTranslationSource(lyric, false)
		}
	}
	if len(timed) == 0 {
		if qq, svcerr := s.cachedQQLyric(ctx, track.ID); svcerr == nil {
			timed = lyricTimedLines(qq.Lyric, lyricAnnotationMaxLines)
			translation = qq.Translation
			wordTimed = qq.Format == "qrc"
		}
	}
	if len(timed) == 0 {
		if kugou, svcerr := s.cachedKugouLyric(ctx, track.ID); svcerr == nil {
			timed = lyricTimedLines(kugou.Lyric, lyricAnnotationMaxLines)
			translation = kugou.Translation
			wordTimed = kugou.Format == "qrc"
		}
	}
	if len(timed) == 0 {
		return nil, lyricAnnotationInfo{}, errs.NewNotFound("lyric_not_found")
	}
	lines := make([]string, len(timed))
	for i, line := range timed {
		lines[i] = line.Text
	}
	info := lyricAnnotationInfo{
		Title:        track.Name,
		Artists:      track.Artists,
		Album:        track.Album,
		Aliases:      track.Aliases,
		Translations: alignLyricTranslations(timed, translation),
		Timed:        timed,
		WordTimed:    wordTimed,
	}
	return lines, info, nil
}

// lyricTextLines 歌词正文（LRC / YRC / QRC）中每一行的文字；跳过元信息、无歌词占位与空行，行数与每行长度有上限
func lyricTextLines(raw string) []string {
	timed := lyricTimedLines(raw, lyricAnnotationMaxLines)
	lines := make([]string, len(timed))
	for i, line := range timed {
		lines[i] = line.Text
	}
	return lines
}

func lyricAnnotationKey(id int64, lines []string) (key, hash string) {
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	hash = hex.EncodeToString(sum[:])
	return strconv.FormatInt(id, 10) + ":" + hash, hash
}

func (a *lyricAnnotationService) get(id int64, lines []string, info lyricAnnotationInfo, cfg tools.AIConfig, ttl time.Duration) (*dto.MusicLyricAnnotationsDto, *errs.ServiceError) {
	key, hash := lyricAnnotationKey(id, lines)
	var record model.LyricAnnotation
	err := repo.GetDB().Where("song_id = ? AND lyric_hash = ?", id, hash).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	found := err == nil

	a.mu.Lock()
	defer a.mu.Unlock()
	job := a.jobs[key]
	running := job != nil && job.running
	coolingDown := job != nil && !job.running && time.Now().Before(job.failedUntil)

	if found {
		data := parseLyricAnnotationData(record.Data)
		result := &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusReady, Font: data.Font, Intro: data.Intro, Outro: data.Outro, Moments: data.Moments, Lines: data.Lines}
		// 旧版颜色名映射到新色板
		for i := range result.Lines {
			result.Lines[i].SceneColor = normalizeLyricColor(result.Lines[i].SceneColor)
			for j := range result.Lines[i].Phrases {
				result.Lines[i].Phrases[j].Color = normalizeLyricColor(result.Lines[i].Phrases[j].Color)
			}
		}
		// 已过期：先返回旧结果，在后台重新生成（失败冷却期内不重试，继续使用旧结果）
		if !running && !coolingDown && time.Since(record.CreatedAt) > ttl {
			a.startLocked(key, id, hash, lines, info, cfg)
			running = true
		}
		result.Stale = running
		return result, nil
	}

	if running {
		return &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusPending, Lines: []dto.MusicLyricAnnotationLine{}}, nil
	}
	if coolingDown {
		return nil, errs.NewNotFound("lyric_annotations_failed")
	}
	a.startLocked(key, id, hash, lines, info, cfg)
	return &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusPending, Lines: []dto.MusicLyricAnnotationLine{}}, nil
}

// refresh 强制开始重新生成（已在生成时不重复开始），立即返回 pending
func (a *lyricAnnotationService) refresh(id int64, lines []string, info lyricAnnotationInfo, cfg tools.AIConfig) *dto.MusicLyricAnnotationsDto {
	key, hash := lyricAnnotationKey(id, lines)
	a.mu.Lock()
	defer a.mu.Unlock()
	if job := a.jobs[key]; job == nil || !job.running {
		a.startLocked(key, id, hash, lines, info, cfg)
	}
	return &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusPending, Lines: []dto.MusicLyricAnnotationLine{}}
}

// startLocked 开始后台生成任务，调用方须持有 a.mu
func (a *lyricAnnotationService) startLocked(key string, id int64, hash string, lines []string, info lyricAnnotationInfo, cfg tools.AIConfig) {
	a.jobs[key] = &lyricAnnotationJob{running: true}
	go a.run(key, id, hash, lines, info, cfg)
}

func (a *lyricAnnotationService) run(key string, id int64, hash string, lines []string, info lyricAnnotationInfo, cfg tools.AIConfig) {
	ok := false
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("lyric annotation panic for song %d: %v", id, r)
		}
		a.mu.Lock()
		if ok {
			delete(a.jobs, key)
		} else {
			a.jobs[key] = &lyricAnnotationJob{failedUntil: time.Now().Add(lyricAnnotationRetryAfter)}
		}
		a.mu.Unlock()
		if a.done != nil {
			a.done()
		}
	}()

	// 热评与副歌片段只在生成时拉取；每次模型调用各自排队等待并发名额（见 generate）
	ctx, cancel := context.WithTimeout(context.Background(), lyricAnnotationTimeout)
	defer cancel()
	if a.hotComments != nil {
		info.Comments = a.hotComments(ctx, id)
	}
	if a.chorus != nil {
		info.Chorus = chorusLineRanges(info.Timed, a.chorus(ctx, id))
	}
	if a.wordTimed != nil && !info.WordTimed {
		info.Timed = borrowHeldNotes(info.Timed, a.wordTimed(ctx, id))
	}
	raw, err := a.generate(id, cfg, info, lines)
	if err != nil {
		logrus.Warnf("lyric annotation failed for song %d: %v", id, err)
		return
	}
	annotated, err := sanitizeLyricAnnotations(lines, info.Comments, raw)
	if err != nil {
		logrus.Warnf("lyric annotation for song %d is invalid: %v", id, err)
		return
	}
	data, _ := json.Marshal(annotated)
	record := &model.LyricAnnotation{SongID: id, LyricHash: hash, Data: string(data), Model: cfg.Model, CreatedAt: time.Now()}
	// 重新生成（过期或手动刷新）时覆盖旧结果
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "lyric_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"data", "model", "created_at"}),
	}
	if err := repo.GetDB().Clauses(upsert).Create(record).Error; err != nil {
		logrus.Errorf("save lyric annotation for song %d failed: %v", id, err)
		return
	}
	ok = true
}

// sanitizeLyricAnnotations 校验模型输出：行号必须存在、短语必须是该行原文的连续片段（忽略空白、标点与大小写）、
// 情绪、特效、颜色与场景只能取允许的值（旧版颜色名映射到新色板，未知颜色与场景丢弃，场景全曲最多 4 处），每行最多 2 个短语，全曲短语总数有上限；同一文本的行合并为一条（前端按文本匹配）
// lyricAnnotationData 保存到数据库的标注结果（旧版记录只有 lines 数组，读取时兼容）
type lyricAnnotationData struct {
	Font    string                           `json:"font,omitempty"`
	Intro   string                           `json:"intro,omitempty"`
	Outro   *dto.MusicLyricAnnotationComment `json:"outro,omitempty"`
	Moments []dto.MusicLyricAnnotationMoment `json:"moments,omitempty"`
	Lines   []dto.MusicLyricAnnotationLine   `json:"lines"`
}

// parseLyricAnnotationData 读取保存的标注：新版为对象，旧版为 lines 数组
func parseLyricAnnotationData(data string) lyricAnnotationData {
	result := lyricAnnotationData{Lines: []dto.MusicLyricAnnotationLine{}}
	trimmed := strings.TrimSpace(data)
	var err error
	if strings.HasPrefix(trimmed, "[") {
		err = json.Unmarshal([]byte(trimmed), &result.Lines)
	} else {
		err = json.Unmarshal([]byte(trimmed), &result)
	}
	if err != nil || result.Lines == nil {
		result.Lines = []dto.MusicLyricAnnotationLine{}
	}
	return result
}

func sanitizeLyricAnnotations(lines []string, comments []lyricAnnotationComment, raw string) (lyricAnnotationData, error) {
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return lyricAnnotationData{}, errors.New("no json object in response")
	}
	// theme 与 direction 是 SOP 中先写下的分析，只用于引导模型，不保存
	var parsed struct {
		Font         string `json:"font"`
		Intro        string `json:"intro"`
		OutroComment int    `json:"outro_comment"`
		Moments      []struct {
			I       int    `json:"i"`
			Comment int    `json:"comment"`
			Text    string `json:"text"`
		} `json:"moments"`
		Imagery []struct {
			Text   string `json:"text"`
			Effect string `json:"effect"`
			Color  string `json:"color"`
		} `json:"imagery"`
		Lines []struct {
			I           int    `json:"i"`
			Mood        string `json:"mood"`
			Chorus      bool   `json:"chorus"`
			ChorusStart bool   `json:"chorus_start"`
			Scene       string `json:"scene"`
			SceneColor  string `json:"scene_color"`
			Phrases     []struct {
				Text   string   `json:"text"`
				Effect string   `json:"effect"`
				Color  string   `json:"color"`
				Font   string   `json:"font"`
				Styles []string `json:"styles"`
			} `json:"phrases"`
		} `json:"lines"`
	}
	if err := json.Unmarshal([]byte(raw[start:end+1]), &parsed); err != nil {
		return lyricAnnotationData{}, err
	}

	// 每行最多 3 个短语，总数上限只防止异常输出（太紧会砍掉歌尾副歌的短语）
	maxPhrases := len(lines)*2 + 6
	phraseCount := 0
	// 同一意象全曲一致：规划的意象对照表优先，其次是同一短语第一次出现时的特效与颜色
	styles := map[string]dto.MusicLyricAnnotationPhrase{}
	for _, item := range parsed.Imagery {
		if key := normalizeLyricMatch(item.Text); key != "" && lyricAnnotationEffects[item.Effect] {
			styles[key] = dto.MusicLyricAnnotationPhrase{Effect: item.Effect, Color: normalizeLyricColor(item.Color)}
		}
	}
	specialCount := map[string]int{}
	sceneCount := 0
	phraseFontCount := 0
	result := []dto.MusicLyricAnnotationLine{}
	byText := map[string]int{}
	for _, item := range parsed.Lines {
		if item.I < 0 || item.I >= len(lines) {
			continue
		}
		text := lines[item.I]
		index, seen := byText[text]
		if !seen {
			result = append(result, dto.MusicLyricAnnotationLine{Text: text, Phrases: []dto.MusicLyricAnnotationPhrase{}})
			index = len(result) - 1
			byText[text] = index
		}
		line := &result[index]
		if line.Mood == "" && lyricAnnotationMoods[item.Mood] {
			line.Mood = item.Mood
		}
		line.Chorus = line.Chorus || item.Chorus || item.ChorusStart
		line.ChorusStart = line.ChorusStart || item.ChorusStart
		if line.Scene == "" && lyricAnnotationScenes[item.Scene] && sceneCount < lyricAnnotationMaxScenes {
			line.Scene = item.Scene
			line.SceneColor = normalizeLyricColor(item.SceneColor)
			sceneCount++
		}
		normalizedLine := normalizeLyricMatch(text)
		for _, phrase := range item.Phrases {
			phraseText := strings.TrimSpace(phrase.Text)
			normalized := normalizeLyricMatch(phraseText)
			if normalized == "" || utf8.RuneCountInString(phraseText) > lyricAnnotationMaxPhraseRune || !strings.Contains(normalizedLine, normalized) {
				continue
			}
			if len(line.Phrases) >= lyricAnnotationMaxPerLine || phraseCount >= maxPhrases {
				break
			}
			duplicate := false
			for _, existing := range line.Phrases {
				duplicate = duplicate || normalizeLyricMatch(existing.Text) == normalized
			}
			if duplicate {
				continue
			}
			effect, color := phrase.Effect, normalizeLyricColor(phrase.Color)
			if !lyricAnnotationEffects[effect] {
				effect = "swell"
			}
			if style, ok := styles[normalized]; ok {
				effect, color = style.Effect, style.Color
			} else {
				// 消散、流光、心跳是点睛之笔，全曲每种最多几处，超出的换成相近的常规特效
				if fallback, special := lyricAnnotationSpecialEffects[effect]; special {
					if specialCount[effect] >= lyricAnnotationMaxSpecialEffect {
						effect = fallback
					} else {
						specialCount[effect]++
					}
				}
				styles[normalized] = dto.MusicLyricAnnotationPhrase{Effect: effect, Color: color}
			}
			annotated := dto.MusicLyricAnnotationPhrase{Text: phraseText, Effect: effect, Color: color}
			if lyricAnnotationFonts[phrase.Font] && phraseFontCount < lyricAnnotationMaxPhraseFonts {
				annotated.Font = phrase.Font
				phraseFontCount++
			}
			for _, style := range phrase.Styles {
				if lyricAnnotationStyles[style] && !slices.Contains(annotated.Styles, style) {
					annotated.Styles = append(annotated.Styles, style)
				}
			}
			line.Phrases = append(line.Phrases, annotated)
			phraseCount++
		}
	}
	// 去掉没有任何标注的行
	kept := result[:0]
	for _, line := range result {
		if line.Mood != "" || line.Chorus || line.Scene != "" || len(line.Phrases) > 0 {
			kept = append(kept, line)
		}
	}
	font := ""
	if lyricAnnotationFonts[parsed.Font] {
		font = parsed.Font
	}
	data := lyricAnnotationData{Font: font, Intro: sanitizeLyricIntro(parsed.Intro), Lines: kept}
	// outro_comment 为热评在提示词中的编号（从 1 开始），超出范围时不展示
	usedComments := map[int]bool{}
	if n := parsed.OutroComment; n >= 1 && n <= len(comments) {
		data.Outro = &dto.MusicLyricAnnotationComment{Content: comments[n-1].Content, Liked: comments[n-1].Liked}
		usedComments[n] = true
	}
	data.Moments = sanitizeLyricMoments(lines, comments, parsed.Moments, usedComments)
	return data, nil
}

// sanitizeLyricMoments 关键节点的「时刻」：行号必须存在、每行最多一个、最多 lyricAnnotationMaxMoments 个，按行号排序；
// 优先使用热评（编号有效且没被用过），否则使用模型写的旁白；同一条热评不重复使用（含尾奏）
func sanitizeLyricMoments(lines []string, comments []lyricAnnotationComment, items []struct {
	I       int    `json:"i"`
	Comment int    `json:"comment"`
	Text    string `json:"text"`
}, usedComments map[int]bool,
) []dto.MusicLyricAnnotationMoment {
	type moment struct {
		index int
		value dto.MusicLyricAnnotationMoment
	}
	var picked []moment
	usedLines := map[int]bool{}
	for _, item := range items {
		if len(picked) >= lyricAnnotationMaxMoments {
			break
		}
		if item.I < 0 || item.I >= len(lines) || usedLines[item.I] {
			continue
		}
		value := dto.MusicLyricAnnotationMoment{Text: lines[item.I]}
		if n := item.Comment; n >= 1 && n <= len(comments) && !usedComments[n] {
			value.Content, value.Liked, value.Source = comments[n-1].Content, comments[n-1].Liked, "comment"
			usedComments[n] = true
		} else if text := sanitizeLyricIntro(item.Text); text != "" {
			value.Content, value.Source = text, "ai"
		} else {
			continue
		}
		// 这一行的文字在第几次出现（副歌常有重复的行，前端按文字匹配到第几次出现的那一行）
		for i := 0; i < item.I; i++ {
			if lines[i] == lines[item.I] {
				value.Occurrence++
			}
		}
		usedLines[item.I] = true
		picked = append(picked, moment{item.I, value})
	}
	if len(picked) == 0 {
		return nil
	}
	sort.Slice(picked, func(a, b int) bool { return picked[a].index < picked[b].index })
	result := make([]dto.MusicLyricAnnotationMoment, len(picked))
	for i, item := range picked {
		result[i] = item.value
	}
	return result
}

// sanitizeLyricIntro 导语：合并空白、去掉首尾引号，过长时截断
func sanitizeLyricIntro(intro string) string {
	intro = strings.TrimSpace(whitespaceRe.ReplaceAllString(intro, " "))
	intro = strings.Trim(intro, "\"'“”「」『』 ")
	if runes := []rune(intro); len(runes) > lyricAnnotationMaxIntroRunes {
		intro = string(runes[:lyricAnnotationMaxIntroRunes]) + "…"
	}
	return intro
}
