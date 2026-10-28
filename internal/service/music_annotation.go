package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
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
	// 换字体的短语上限：太多会显得杂乱
	lyricAnnotationMaxPhraseFonts = 10
	// 标注的温度：调高让演出设计更大胆
	lyricAnnotationTemperature = 0.9
)

var (
	lyricAnnotationMoods   = map[string]bool{"calm": true, "bright": true, "sad": true, "intense": true}
	lyricAnnotationEffects = map[string]bool{"swell": true, "glow": true, "wave": true, "shake": true, "focus": true}
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
	// 短语字形：粗体、斜体、下划线、删除线（下划线与删除线在演唱时逐字画出）
	lyricAnnotationStyles = map[string]bool{"bold": true, "italic": true, "underline": true, "strike": true}
)

const lyricAnnotationSystemPrompt = `你是一位深情、敏感又大胆的歌词演出导演，为逐字歌词播放器设计整首歌的视觉演出：哪些词要被点亮、用什么特效与颜色、
换什么字体、哪里飘起花瓣或烟花。请先让自己被这首歌打动——听懂它的心事、它的遗憾与欢喜——再用画面把这份情感交给听众：
伤感时克制而绵长，喜悦时明亮而轻盈，激昂时炽烈而饱满，温柔时像耳语。敢于表现，但永远为情感服务，不喧宾夺主。

输入包含：
- 【歌曲信息】歌名、歌手、专辑、别名 / 描述（如「香港回归25周年纪念」这类描述往往点明了歌曲的创作背景与情感基调，务必重视）；
- 【听众热评】（可能没有）网易云听众的热门评论：可以帮你感受这首歌在听众心中的情绪、故事与记忆，
  但它们可信度有限，常有玩笑、跑题或与歌曲无关的内容——只吸收与歌曲情感一致的部分，偏离的直接忽略，绝不能据此改动或臆造歌词；
- 【歌词】每行以「行号: 原文」给出；外语歌词在行末附有〔译：…〕中文翻译，只用来理解含义，所有引用都必须来自原文。

工作流程（SOP，必须按顺序在输出的 JSON 中完成）：
第 1 步 理解全曲：结合你对这首歌（歌名、歌手、年代、风格、创作背景）的了解、歌曲信息、可信的热评与歌词本身，
  在 theme 中用一两句话写下这首歌在讲什么、想对谁说、情绪从哪里出发又走向哪里（情感弧线）。
第 2 步 确定方向：在 direction 中写下整首歌的演出基调：从色板挑 2～4 个主色、主要用哪几种特效、全曲字体与反差字体的用法、哪些画面适合粒子场景。
  后面的所有标注都要围绕这个方向展开，让整首歌像一场有统一美术风格的演出，而不是零散的特效。
第 3 步 找副歌：凭你对这首歌的了解（知道就以你的知识为准）与歌词中反复出现的段落，判断每一段副歌从哪一行开始，
  在该行标 chorus_start: true，副歌内的每一行标 chorus: true。副歌起点是全曲情绪爆发的瞬间，要给它最丰富的演出：
  该行用满 3 个短语、配合 swell / shake 与鲜明的颜色，并尽量在这里切换或开启粒子场景。
第 4 步 逐行设计：按方向为各行加特效。主歌可以克制、留白，越接近副歌越浓烈；副歌与高潮段落要密集而华丽。
  大约一半到三分之二的行可以有强调，副歌几乎每行都可以有。
第 5 步 自检后输出：所有 text 都是原文的连续片段；同一意象的 effect 与 color 前后一致；没有违反下面的硬性规则。

硬性规则：
1. 只能引用给定歌词的原文：不得改写、翻译、补全或新增歌词，也不涉及任何时间。
2. phrases 中的 text 必须是该行原文中连续出现的片段（中日韩文 2～6 个字，英文 1～3 个词），每行最多 3 个，同一行的短语不要重叠。
3. 只输出一个 JSON 对象，不要解释或 Markdown 代码块。

情感与演出的对应（参考，可按歌曲气质灵活变化）：
- 伤感、思念、遗憾：glow / focus 为主，冷色或淡紫（rain、midnight、ice、lavender、twilight），rain / snow / feathers / clouds 等缓慢的场景，
  斜体与删除线适合说不出口或已失去的东西；留白要多，让情绪慢慢沉下去。
- 喜悦、甜蜜、青春：wave 为主，暖色与亮色（sunshine、lemon、peach、cherry-blossom、spring-green），petals / hearts / butterflies / confetti，圆体很合适。
- 激昂、热血、呐喊：swell / shake 为主，炽烈的颜色（flame、crimson、gold、sunset），sparks / fireworks / meteors，粗体与下划线表达决心。
- 温柔、治愈、陪伴：glow 与轻微的 wave，烛光与月光（candlelight、moonlight、lavender），fireflies / stars / dandelion，楷体像手写的信。
- 情绪转折处（由悲转喜、由压抑到爆发）最值得设计：用颜色与场景的切换让听众感受到转变。

如何挑选：
- 挑情感最强、最值得被唱出来的词：告白、呐喊、核心意象、点题的词、副歌里的关键词、长音拖腔的词。
- 署名行（作词、作曲、编曲等）、拟声词、语气词（啊、哦、yeah 等）不要标注。
- 一个词语如果在合适的位置多次出现，可以多次应用特效
  同一意象在全曲多次出现时，不必每处都标注，只在情感到位的地方标注即可；但凡是标注了的地方，effect 与 color 要保持一致，
  不要这一处用一种颜色、另一处换成另一种颜色（除非歌词明确写到意象的颜色发生了变化）。
- 注意观感与负载：粒子场景全曲最多 6 处，换字体的短语全曲最多 10 处，删除线只用在语义真的需要的地方。

字段：
- theme（必填）：第 1 步的结论。direction（必填）：第 2 步的结论。
- font（可选，全曲字体）：按整首歌的气质从下方字体中挑一个作为全曲字体，不填则使用站点默认的黑体：
{{fonts}}
- lines[].chorus_start（可选）：一段副歌的第一行标 true（见第 3 步）。lines[].chorus（可选）：副歌行标 true。
- lines[].mood（可选）：情绪鲜明的行标注基调 calm（平静）、bright（明亮）、sad（伤感）、intense（激昂），不确定时省略。
- phrases[].effect（必填）：swell 饱满有力、情绪推向高点；glow 温柔、回忆、梦幻、伤感；wave 轻快、俏皮、跳跃；
  shake 震颤，用于呐喊、愤怒、心跳加速、颤抖等强烈冲击的词；focus 由虚到实，用于回忆浮现、梦醒、恍然、看清等词。
- phrases[].color（可选）：给短语上色，只能取下方色板中的英文名，按中文名与意象挑选最贴切的一个，当然上色词语不局限于给出的中文名，可以尽情联想：
{{colors}}
  本身带有颜色或强烈色彩联想的意象（如花、阳光、大海、夜空、火焰、春天等意向和颜色联想很强烈的词语或者歌词本身在这种场景下和颜色有关系），颜色要与意象相符；
  当然，一些词语没有明显的色彩联想，但是有间接的也可以加，比如爱情等
  你认为这个词语有65%以上的颜色联想概率就可以上色，没有合适的意象就不上色。优先使用第 2 步定下的主色。
- phrases[].font（可选）：给短语单独换字体，制造反差（例如全曲黑体，回忆里的一句换成楷体；电子音效般的词换成等宽），取值同 font。
- phrases[].styles（可选，数组，可组合）：
  bold 粗体：宣言、力量、呐喊、点题的词；
  italic 斜体：低语、心声、回忆、引用别人说过的话；
  underline 下划线：誓言、承诺、「一定」「永远」这类要被记住的词，唱到时逐字画出下划线；
  strike 删除线：被否定、被放弃、被推翻或反讽的词（如「不再」「假装」「曾经的」「说好的」），唱到时逐字划掉。
- lines[].scene（可选）：为歌词中出现具体画面的行选择全屏粒子场景，只能取下方场景中的英文名：
{{scenes}}
  只在歌词写到相应景物或意境时使用，场景从该行开始持续约 8 行（遇到下一个标了 scene 的行时切换），
  因此只在画面出现或副歌开始处标注；没有合适的画面就不标。
- lines[].scene_color（可选）：粒子场景的颜色主题，取值与 color 相同（色板中的英文名），只在该行有 scene 时填写；
  颜色要符合画面（如紫荆花瓣用 bauhinia、秋天的落叶用 maple、夏夜萤火用 spring-green），不填则使用场景本身的默认颜色。

输出格式（字段顺序即 SOP 顺序）：
{"theme":"……","direction":"……","font":"song","lines":[{"i":行号,"mood":"bright","chorus":true,"chorus_start":true,"scene":"petals","scene_color":"bauhinia",
"phrases":[{"text":"原文片段","effect":"swell","color":"gold","font":"kai","styles":["bold"]}]}]}，lines 只列出有标注的行。`

// lyricAnnotationPrompt 填入色板、粒子场景与字体后的系统提示词
var lyricAnnotationPrompt = func() string {
	var b strings.Builder
	for i, color := range lyricAnnotationPalette {
		if i > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "  %s %s：%s", color.Key, color.Name, color.Hint)
	}
	var fonts strings.Builder
	for i, font := range lyricAnnotationFontList {
		if i > 0 {
			fonts.WriteString("\n")
		}
		fmt.Fprintf(&fonts, "  %s %s：%s", font.Key, font.Name, font.Hint)
	}
	var scenes strings.Builder
	for i, scene := range lyricAnnotationSceneList {
		if i > 0 {
			scenes.WriteString("\n")
		}
		fmt.Fprintf(&scenes, "  %s %s：%s", scene.Key, scene.Name, scene.Hint)
	}
	return strings.NewReplacer("{{colors}}", b.String(), "{{scenes}}", scenes.String(), "{{fonts}}", fonts.String()).Replace(lyricAnnotationSystemPrompt)
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
	complete func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error)
	// hotComments 生成时拉取热评，可为 nil（测试时不拉取）
	hotComments func(ctx context.Context, id int64) []lyricAnnotationComment
	concurrency func() int
	// done 任务结束时调用（测试用），可为 nil
	done func()
}

var lyricAnnotations = &lyricAnnotationService{
	jobs:    make(map[string]*lyricAnnotationJob),
	limiter: aiCallLimiter,
	complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return chatCompletionWithTemperature(ctx, cfg, system, user, lyricAnnotationTemperature)
	},
	hotComments: fetchNCMHotComments,
	concurrency: tools.GetAISummaryConcurrency,
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
// 优先网易云逐字歌词，其次网易云逐行歌词，网易云没有歌词时用 QQ 音乐的歌词；翻译取自同一来源
func (s *MusicService) annotationSource(ctx context.Context, track *dto.MusicTrackDto) ([]string, lyricAnnotationInfo, *errs.ServiceError) {
	var timed []lyricTimedLine
	translation := ""
	if lyric, svcerr := s.GetLyric(ctx, track.ID); svcerr == nil {
		if lyric.Yrc != nil {
			timed = lyricTimedLines(lyric.Yrc.Lyric, lyricAnnotationMaxLines)
			translation = lyricTranslationSource(lyric, true)
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
		result := &dto.MusicLyricAnnotationsDto{Status: lyricAnnotationStatusReady, Font: data.Font, Lines: data.Lines}
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

	// 排队等待并发名额（与 AI 摘要共用），拿到后才开始计算超时
	_ = a.limiter.acquire(context.Background(), a.concurrency, false, nil)
	defer a.limiter.release()
	ctx, cancel := context.WithTimeout(context.Background(), lyricAnnotationTimeout)
	defer cancel()

	if a.hotComments != nil {
		info.Comments = a.hotComments(ctx, id)
	}
	raw, err := a.complete(ctx, cfg, lyricAnnotationPrompt, buildLyricAnnotationPrompt(info, lines))
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

// sanitizeLyricAnnotations 校验模型输出：行号必须存在、短语必须是该行原文的连续片段（忽略空白、标点与大小写）、
// 情绪、特效、颜色与场景只能取允许的值（旧版颜色名映射到新色板，未知颜色与场景丢弃，场景全曲最多 4 处），每行最多 2 个短语，全曲短语总数有上限；同一文本的行合并为一条（前端按文本匹配）
// lyricAnnotationData 保存到数据库的标注结果（旧版记录只有 lines 数组，读取时兼容）
type lyricAnnotationData struct {
	Font  string                         `json:"font,omitempty"`
	Lines []dto.MusicLyricAnnotationLine `json:"lines"`
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

func sanitizeLyricAnnotations(lines []string, raw string) (lyricAnnotationData, error) {
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return lyricAnnotationData{}, errors.New("no json object in response")
	}
	// theme 与 direction 是 SOP 中先写下的分析，只用于引导模型，不保存
	var parsed struct {
		Font  string `json:"font"`
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

	maxPhrases := len(lines) + 6
	phraseCount := 0
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
			effect := phrase.Effect
			if !lyricAnnotationEffects[effect] {
				effect = "swell"
			}
			annotated := dto.MusicLyricAnnotationPhrase{Text: phraseText, Effect: effect, Color: normalizeLyricColor(phrase.Color)}
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
	return lyricAnnotationData{Font: font, Lines: kept}, nil
}
