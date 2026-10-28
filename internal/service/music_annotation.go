package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
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
	lyricAnnotationMaxPerLine    = 2
	lyricAnnotationMaxScenes     = 4
)

var (
	lyricAnnotationMoods   = map[string]bool{"calm": true, "bright": true, "sad": true, "intense": true}
	lyricAnnotationEffects = map[string]bool{"swell": true, "glow": true, "wave": true, "shake": true, "focus": true}
	// 行级全屏粒子场景（只在播放器页演出）
	lyricAnnotationScenes = map[string]bool{"petals": true, "sparks": true, "snow": true, "stars": true, "bubbles": true, "rain": true}
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
	// 逐字时间标签：YRC 的 (开始,时长,0)、QRC 的 (开始,时长)
	lyricWordTagRe = regexp.MustCompile(`\(\d+,\d+(?:,\d+)?\)`)
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

const lyricAnnotationSystemPrompt = `你是歌词演出设计师，为逐字歌词播放器设计演唱时的强调特效。输入是一首歌的歌词，每行以「行号: 原文」给出。

先通读全曲，把握主题、情绪走向与副歌，再逐行标注。

硬性规则：
1. 只能引用给定歌词的原文：不得改写、翻译、补全或新增歌词，也不涉及任何时间。
2. phrases 中的 text 必须是该行原文中连续出现的片段（中日韩文 2～6 个字，英文 1～3 个词），每行最多 2 个。
3. 只输出 JSON，不要解释或 Markdown 代码块。

如何挑选：
- 挑情感最强、最值得被唱出来的词：告白、呐喊、核心意象、点题的词、副歌里的关键词。
- 宁缺毋滥：大多数行不需要强调，有强调的行不超过全曲的三分之一；重复出现的副歌保持一致的标注。
- 署名行（作词、作曲、编曲等）、拟声词、语气词（啊、哦、yeah 等）不要标注。

字段：
- effect（必填）：swell 饱满有力、情绪推向高点；glow 温柔、回忆、梦幻、伤感；wave 轻快、俏皮、跳跃。
  shake 震颤，用于呐喊、愤怒、心跳加速、颤抖等强烈冲击的词；focus 由虚到实，用于回忆浮现、梦醒、恍然、看清等词。
- color（可选）：给短语上色，只能取下方色板中的英文名，按中文名与意象挑选最贴切的一个：
{{colors}}
  本身带有颜色或强烈色彩联想的意象（如花、阳光、大海、夜空、火焰、春天等意向和颜色联想很强烈的词语或者歌词本身在这种场景下和颜色有关系），颜色要与意象相符；
  当然，一些词语没有明显的色彩联想，但是有间接的也可以加，比如爱情等
  你认为这个词语有65%以上的颜色联想概率就可以上色，没有合适的意象就不上色。
- mood（可选）：情绪鲜明的行标注基调 calm（平静）、bright（明亮）、sad（伤感）、intense（激昂），不确定时省略。
- chorus（可选）：副歌行标 true。
- scene（可选）：为歌词中出现具体画面的行选择全屏粒子场景，只能取 petals（花瓣）、sparks（光点、火花、萤火）、snow（雪）、
  stars（星空）、bubbles（气泡、水下）、rain（雨）。只在歌词明确写到相应景物或意境时使用，场景从该行开始持续约 8 行（遇到下一个标了 scene 的行时切换），
  因此只在画面出现处标注；全曲最多 4 处，没有合适的画面就不标。

输出格式：{"lines":[{"i":行号,"mood":"bright","chorus":true,"scene":"petals","phrases":[{"text":"原文片段","effect":"swell","color":"gold"}]}]}，只列出有标注的行。`

// lyricAnnotationPrompt 填入色板后的系统提示词
var lyricAnnotationPrompt = func() string {
	var b strings.Builder
	for i, color := range lyricAnnotationPalette {
		if i > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "  %s %s：%s", color.Key, color.Name, color.Hint)
	}
	return strings.Replace(lyricAnnotationSystemPrompt, "{{colors}}", b.String(), 1)
}()

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
	complete    func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	concurrency func() int
	// done 任务结束时调用（测试用），可为 nil
	done func()
}

var lyricAnnotations = &lyricAnnotationService{
	jobs:        make(map[string]*lyricAnnotationJob),
	limiter:     aiCallLimiter,
	complete:    chatCompletion,
	concurrency: tools.GetAISummaryConcurrency,
}

// GetLyricAnnotations 取一首歌的歌词标注；还没有时开始生成并返回 pending，已过期时返回旧结果并在后台重新生成
func (s *MusicService) GetLyricAnnotations(ctx context.Context, id int64) (*dto.MusicLyricAnnotationsDto, *errs.ServiceError) {
	lines, title, cfg, svcerr := s.prepareLyricAnnotations(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	ttl := time.Duration(tools.GetLyricAnnotationTTLDays()) * 24 * time.Hour
	return lyricAnnotations.get(id, lines, title, cfg, ttl)
}

// RefreshLyricAnnotations 管理员手动重新生成一首歌的歌词标注（忽略有效期与失败冷却），旧结果在新结果生成前继续使用
func (s *MusicService) RefreshLyricAnnotations(ctx context.Context, id int64) (*dto.MusicLyricAnnotationsDto, *errs.ServiceError) {
	lines, title, cfg, svcerr := s.prepareLyricAnnotations(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	return lyricAnnotations.refresh(id, lines, title, cfg), nil
}

// prepareLyricAnnotations 校验能否为这首歌生成标注，并取出送去标注的歌词文本与模型配置
func (s *MusicService) prepareLyricAnnotations(ctx context.Context, id int64) ([]string, string, tools.AIConfig, *errs.ServiceError) {
	if id <= 0 {
		return nil, "", tools.AIConfig{}, errs.NewBadRequest("invalid_request_parameters")
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() || !s.inBlogPlaylist(ctx, id) {
		return nil, "", cfg, errs.NewNotFound("lyric_annotations_unavailable")
	}
	lines, title, svcerr := s.annotationSource(ctx, id)
	if svcerr != nil {
		return nil, "", cfg, svcerr
	}
	return lines, title, cfg, nil
}

// inBlogPlaylist 歌曲是否在博客歌单内；只有网易云歌单由后端提供，静态歌单无法校验，视为不在
func (s *MusicService) inBlogPlaylist(ctx context.Context, id int64) bool {
	if !tools.GetNCMConfig().Configured() {
		return false
	}
	tracks, svcerr := s.GetPlaylist(ctx)
	return svcerr == nil && containsTrack(tracks, id)
}

// annotationSource 送去标注的歌词文本（每行一句，去掉时间标签）与「歌名 - 歌手」：
// 优先网易云逐字歌词，其次网易云逐行歌词，网易云没有歌词时用 QQ 音乐的歌词
func (s *MusicService) annotationSource(ctx context.Context, id int64) ([]string, string, *errs.ServiceError) {
	var lines []string
	if lyric, svcerr := s.GetLyric(ctx, id); svcerr == nil {
		if lyric.Yrc != nil {
			lines = lyricTextLines(lyric.Yrc.Lyric)
		}
		if len(lines) == 0 && lyric.Lrc != nil {
			lines = lyricTextLines(lyric.Lrc.Lyric)
		}
	}
	if len(lines) == 0 {
		if qq, svcerr := s.cachedQQLyric(ctx, id); svcerr == nil {
			lines = lyricTextLines(qq.Lyric)
		}
	}
	if len(lines) == 0 {
		return nil, "", errs.NewNotFound("lyric_not_found")
	}
	title := ""
	if song, svcerr := s.GetSong(ctx, id); svcerr == nil {
		title = song.Name
		if len(song.Artists) > 0 {
			title += " - " + strings.Join(song.Artists, " / ")
		}
	}
	return lines, title, nil
}

// lyricTextLines 歌词正文（LRC / YRC / QRC）中每一行的文字；跳过元信息、无歌词占位与空行，行数与每行长度有上限
func lyricTextLines(raw string) []string {
	var lines []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		head := lyricLineHeadRe.FindString(line)
		if head == "" {
			continue
		}
		text := strings.TrimSpace(lyricWordTagRe.ReplaceAllString(line[len(head):], ""))
		if text == "" || text == "no_lyric" || text == "pure_music_without_lyric" {
			continue
		}
		if runes := []rune(text); len(runes) > lyricAnnotationMaxLineRunes {
			text = string(runes[:lyricAnnotationMaxLineRunes])
		}
		lines = append(lines, text)
		if len(lines) >= lyricAnnotationMaxLines {
			break
		}
	}
	return lines
}

func lyricAnnotationKey(id int64, lines []string) (key, hash string) {
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	hash = hex.EncodeToString(sum[:])
	return strconv.FormatInt(id, 10) + ":" + hash, hash
}

func (a *lyricAnnotationService) get(id int64, lines []string, title string, cfg tools.AIConfig, ttl time.Duration) (*dto.MusicLyricAnnotationsDto, *errs.ServiceError) {
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
		result := &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusReady, Lines: []dto.MusicLyricAnnotationLine{}}
		if json.Unmarshal([]byte(record.Data), &result.Lines) != nil {
			result.Lines = []dto.MusicLyricAnnotationLine{}
		}
		// 旧版颜色名映射到新色板
		for i := range result.Lines {
			for j := range result.Lines[i].Phrases {
				result.Lines[i].Phrases[j].Color = normalizeLyricColor(result.Lines[i].Phrases[j].Color)
			}
		}
		// 已过期：先返回旧结果，在后台重新生成（失败冷却期内不重试，继续使用旧结果）
		if !running && !coolingDown && time.Since(record.CreatedAt) > ttl {
			a.startLocked(key, id, hash, lines, title, cfg)
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
	a.startLocked(key, id, hash, lines, title, cfg)
	return &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusPending, Lines: []dto.MusicLyricAnnotationLine{}}, nil
}

// refresh 强制开始重新生成（已在生成时不重复开始），立即返回 pending
func (a *lyricAnnotationService) refresh(id int64, lines []string, title string, cfg tools.AIConfig) *dto.MusicLyricAnnotationsDto {
	key, hash := lyricAnnotationKey(id, lines)
	a.mu.Lock()
	defer a.mu.Unlock()
	if job := a.jobs[key]; job == nil || !job.running {
		a.startLocked(key, id, hash, lines, title, cfg)
	}
	return &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusPending, Lines: []dto.MusicLyricAnnotationLine{}}
}

// startLocked 开始后台生成任务，调用方须持有 a.mu
func (a *lyricAnnotationService) startLocked(key string, id int64, hash string, lines []string, title string, cfg tools.AIConfig) {
	a.jobs[key] = &lyricAnnotationJob{running: true}
	go a.run(key, id, hash, lines, title, cfg)
}

func (a *lyricAnnotationService) run(key string, id int64, hash string, lines []string, title string, cfg tools.AIConfig) {
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

	// 排队等待并发名额（与 AI 摘要共用），拿到后才开始计算超时
	_ = a.limiter.acquire(context.Background(), a.concurrency, false, nil)
	defer a.limiter.release()
	ctx, cancel := context.WithTimeout(context.Background(), lyricAnnotationTimeout)
	defer cancel()

	raw, err := a.complete(ctx, cfg, lyricAnnotationPrompt, buildLyricAnnotationPrompt(title, lines))
	if err != nil {
		logrus.Warnf("lyric annotation failed for song %d: %v", id, err)
		return
	}
	annotated, err := sanitizeLyricAnnotations(lines, raw)
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

// buildLyricAnnotationPrompt 用户消息：歌名与带行号的歌词
func buildLyricAnnotationPrompt(title string, lines []string) string {
	var b strings.Builder
	if title != "" {
		b.WriteString("歌曲：" + title + "\n")
	}
	b.WriteString("歌词：\n")
	for i, line := range lines {
		fmt.Fprintf(&b, "%d: %s\n", i, line)
	}
	return b.String()
}

// sanitizeLyricAnnotations 校验模型输出：行号必须存在、短语必须是该行原文的连续片段（忽略空白、标点与大小写）、
// 情绪、特效、颜色与场景只能取允许的值（旧版颜色名映射到新色板，未知颜色与场景丢弃，场景全曲最多 4 处），每行最多 2 个短语，全曲短语总数有上限；同一文本的行合并为一条（前端按文本匹配）
func sanitizeLyricAnnotations(lines []string, raw string) ([]dto.MusicLyricAnnotationLine, error) {
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return nil, errors.New("no json object in response")
	}
	var parsed struct {
		Lines []struct {
			I       int    `json:"i"`
			Mood    string `json:"mood"`
			Chorus  bool   `json:"chorus"`
			Scene   string `json:"scene"`
			Phrases []struct {
				Text   string `json:"text"`
				Effect string `json:"effect"`
				Color  string `json:"color"`
			} `json:"phrases"`
		} `json:"lines"`
	}
	if err := json.Unmarshal([]byte(raw[start:end+1]), &parsed); err != nil {
		return nil, err
	}

	maxPhrases := len(lines)/2 + 4
	phraseCount := 0
	sceneCount := 0
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
		line.Chorus = line.Chorus || item.Chorus
		if line.Scene == "" && lyricAnnotationScenes[item.Scene] && sceneCount < lyricAnnotationMaxScenes {
			line.Scene = item.Scene
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
			effect := phrase.Effect
			if !lyricAnnotationEffects[effect] {
				effect = "swell"
			}
			color := normalizeLyricColor(phrase.Color)
			line.Phrases = append(line.Phrases, dto.MusicLyricAnnotationPhrase{Text: phraseText, Effect: effect, Color: color})
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
	return kept, nil
}
