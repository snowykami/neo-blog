package service

import (
	"fmt"
	"strings"
)

// 歌词标注的提示词（见 docs/music-player-spec.md 7.2b）：全曲规划与逐段标注各用一份系统提示词，只放本任务需要的规则，
// 色板、粒子场景与字体由数据表生成（与前端保持一致）。用户消息中的标签也放在这里，与系统提示词使用同一种语言

// lyricAnnotationLocale 一种语言的提示词：两个任务的系统提示词，以及用户消息里的各个标签（含 fmt 占位符的按注释中的顺序填写）
type lyricAnnotationLocale struct {
	PlanPrompt  string
	LinesPrompt string

	SongInfo, Title, Artists, Album, Aliases string
	// 热评标题；一条热评：序号、内容、点赞数
	Comments, Comment string
	// 网易云高潮片段在歌词行末的标记：片段开始、片段结束
	ClimaxStart, ClimaxEnd string
	// 歌词标题，有翻译 / 有长音时追加的说明；翻译：译文；长音：音节、秒数、句尾标记
	Lyrics, TranslationNote, HeldNote, Translation, Held, HeldTail string
	// 逐段标注：全曲规划标题、主题、方向、全曲字体、意象标题、一个意象（原文、特效、颜色）、不上色
	Plan, Theme, Direction, Font, Imagery, ImageryItem, NoColor string
	// 本段已标注的行（标题、一行：行号与标注）、副歌起点、副歌、情绪
	Marks, Mark, ChorusStart, ChorusLine, Mood string
	// 本次标注范围：起止行号、段数、本段换字体的上限
	Range string
}

// lyricAnnotationText 当前使用的提示词语言
var lyricAnnotationText = lyricAnnotationZH

var lyricAnnotationZH = lyricAnnotationLocale{
	PlanPrompt:  fillLyricAnnotationPrompt(lyricAnnotationZHHead+lyricAnnotationZHPlan, false),
	LinesPrompt: fillLyricAnnotationPrompt(lyricAnnotationZHHead+lyricAnnotationZHLines, false),

	SongInfo: "【歌曲信息】\n", Title: "歌名：", Artists: "歌手：", Album: "专辑：", Aliases: "别名 / 描述：",
	Comments: "\n【听众热评】\n", Comment: "%d. %s（%d 赞）\n",
	ClimaxStart: "　〔高潮片段开始〕", ClimaxEnd: "　〔高潮片段结束〕",
	Lyrics: "\n【歌词】", TranslationNote: "（〔译：…〕是中文翻译）", HeldNote: "（〔长音：…〕是拖长的音节）",
	Translation: "　〔译：%s〕", Held: "　〔长音：「%s」%.1f 秒%s〕", HeldTail: "，句尾",
	Plan: "\n【全曲规划】\n", Theme: "主题：", Direction: "方向：", Font: "全曲字体：",
	Imagery: "意象：\n", ImageryItem: "- %s：%s，%s\n", NoColor: "不上色",
	Marks: "本段已标注：\n", Mark: "第 %d 行：%s\n", ChorusStart: "副歌起点", ChorusLine: "副歌", Mood: "情绪 ",
	Range: "\n【本次标注范围】第 %d 行～第 %d 行（全曲分 %d 段并行标注，本段换字体最多 %d 处）\n",
}

var lyricAnnotationEN = lyricAnnotationLocale{
	PlanPrompt:  fillLyricAnnotationPrompt(lyricAnnotationENHead+lyricAnnotationENPlan, true),
	LinesPrompt: fillLyricAnnotationPrompt(lyricAnnotationENHead+lyricAnnotationENLines, true),

	SongInfo: "[Song]\n", Title: "Title: ", Artists: "Artists: ", Album: "Album: ", Aliases: "Aliases / description: ",
	Comments: "\n[Listener comments]\n", Comment: "%d. %s (%d likes)\n",
	ClimaxStart: "　〔climax starts〕", ClimaxEnd: "　〔climax ends〕",
	Lyrics: "\n[Lyrics]", TranslationNote: " (〔译：…〕 is a Chinese translation)", HeldNote: " (〔held: …〕 marks a long-held syllable)",
	Translation: "　〔译：%s〕", Held: "　〔held: \"%s\" %.1fs%s〕", HeldTail: ", line end",
	Plan: "\n[Plan]\n", Theme: "Theme: ", Direction: "Direction: ", Font: "Song font: ",
	Imagery: "Imagery:\n", ImageryItem: "- %s: %s, %s\n", NoColor: "no color",
	Marks: "Marked lines in this chunk:\n", Mark: "line %d: %s\n", ChorusStart: "chorus start", ChorusLine: "chorus", Mood: "mood ",
	Range: "\n[Your range] lines %d-%d (the song is split into %d chunks annotated in parallel; at most %d font changes in this chunk)\n",
}

const lyricAnnotationENHead = `You are a lyric performance director designing visuals for a word-synced lyric player. First understand the song's emotion and story, then convey it with restrained, moving effects: effects serve the feeling; fewer but precise.

Input: [Song] (aliases / description often reveal the background — use them); [Listener comments] (may be absent; keep only what matches the song's feeling, ignore jokes and off-topic ones); [Lyrics], one "index: original text" per line, possibly followed by 〔译：…〕 (translation, for understanding only), 〔held: …〕 (a long-held syllable found from word timing) and 〔climax starts / ends〕 (the climax NetEase marks on its progress bar, usually one chorus).
Quote the original lyrics only — never rewrite or translate them. Output exactly one JSON object, no explanation or code fence. Write intro and moment text in Simplified Chinese.

Emotion guide (adapt to the song; mark emotional turns with a change of color and scene):
- sad, longing: glow / focus / dissolve; cool colors and pale violet (rain, midnight, ice, lavender, twilight); rain, snow, feathers, clouds
- joyful, youthful: wave / shimmer; warm bright colors (sunshine, lemon, peach, cherry-blossom); petals, hearts, butterflies, confetti
- passionate, shouting: swell / shake; fiery colors (flame, crimson, gold, sunset); sparks, fireworks, meteors
- tender, comforting: glow / heartbeat; candle and moon light (candlelight, moonlight, lavender); fireflies, stars, dandelion

effect: swell full, rising to a peak | glow tender, memory, sorrow | wave light, playful | shake shout, impact, or vibrato on a held note | focus memory surfacing, sudden clarity | dissolve crumbles into drifting grains after it is sung: vanish, leave, farewell, waking from a dream | shimmer a gleam sweeps across: light, shining, stars, rainbow | heartbeat double-beat pulse: crush, heartbeat, nervous, "I like you"
color (only when the word has ~65%+ color association; match the image; prefer the main colors):
{{colors}}
font:
{{fonts}}
`

const lyricAnnotationENPlan = `
Task: plan the whole song. Per-line phrases are done later in parallel; do not output phrases now. In order:
1. theme: one or two sentences — what the song is about, to whom, and how the feeling moves.
2. direction: the visual tone — 2-4 main colors, main effects, font usage, images suited to particle scenes; all later choices follow it, like one art-directed show.
3. chorus: using your knowledge of the song, repeated sections and the 〔climax〕 marks, set chorus_start on the first line of each chorus and chorus on chorus lines; the same lyrics elsewhere usually form the other choruses. A chorus start is an outburst — start or switch a scene there when possible.
4. imagery: the song's recurring or title images (original words), each with one effect and color (color optional); used consistently everywhere.
5. Layout:
- intro: a lead-in shown during the intro, at most 40 Chinese characters, like a late-night radio host's murmur; may hint at background or mood; no lyric spoilers, no quotes.
- outro_comment: the number of the comment shown during the outro, the one that best fits the song; omit if none fits.
- moments: 4-5, at emotional turns, chorus starts, the most moving line, the climax or ending (i = line index), spread out with several lines between; prefer comment (a comment number, no repeats, not the outro_comment); otherwise text (a narration of at most 40 Chinese characters, heartfelt and vivid, not copying lyrics, no quotes).
- font: song-wide font, optional (default sans).
- lines: mood (calm / bright / sad / intense) on emotionally clear lines; scene on lines describing a concrete image or starting a chorus (at most 6 per song, lasts ~8 lines), with optional scene_color (a color value, e.g. bauhinia for bauhinia petals).
scene:
{{scenes}}

Output: {"theme":"","direction":"","intro":"","outro_comment":1,"moments":[{"i":0,"comment":2},{"i":0,"text":""}],"font":"song","imagery":[{"text":"","effect":"glow","color":"rain"}],"lines":[{"i":0,"mood":"sad","chorus":true,"chorus_start":true,"scene":"rain","scene_color":"rain"}]}; list only lines with marks.`

const lyricAnnotationENLines = `
Task: annotate phrases line by line. The song plan is in [Plan]; annotate only lines in [Your range] — other lines are context.
- phrase text must be a contiguous substring of that line: 2-6 CJK characters or 1-3 English words (a held interjection may be 1 character); at most 3 per line, non-overlapping.
- Follow the plan's direction and main colors; words listed in Imagery must use the planned effect and color.
- Keep verses restrained and build toward the chorus: roughly half to two thirds of lines get emphasis, almost every chorus line does; a chorus_start line gets 3 phrases with swell / shake and vivid colors.
- Pick the words most worth singing out: confessions, shouts, core images, title words, chorus keywords. Skip credit lines, onomatopoeia and interjections (unless held).
- Held notes: if a line ends with 〔held〕, make the phrase containing that syllable (optionally with 1-3 preceding characters, e.g. 出した for the held た in 連れ出した) a shake for vibrato — line-end holds fit best; use glow where calm. Never add shake to an ordinary line ending without 〔held〕.
- Use dissolve, shimmer and heartbeat only where the meaning fits, at most once each per chunk.
- Change fonts only for contrast (kai for a memory, mono for electronic sounds); use strike only when the meaning needs it.
styles (combinable): bold declaration, strength | italic whisper, memory, quotation | underline vow, promise (forever, surely) | strike denied or abandoned (no longer, what we promised)

Output: {"lines":[{"i":0,"phrases":[{"text":"original fragment","effect":"swell","color":"gold","font":"kai","styles":["bold"]}]}]}; list only annotated lines in your range.`

const lyricAnnotationZHHead = `你是歌词演出导演，为逐字歌词播放器设计视觉演出。先读懂歌曲的情绪与故事，再用克制而有感染力的特效把它交给听众：特效服务于情感，宁少而准。

输入：【歌曲信息】（别名 / 描述常点明创作背景，要参考）；【听众热评】（可能没有，只取与歌曲情感一致的，玩笑、跑题的忽略）；【歌词】每行「行号: 原文」，行末可能附〔译：…〕（只帮助理解）、〔长音：…〕（按逐字时间找出的拖长音节）与〔高潮片段开始 / 结束〕（网易云在进度条上标出的高潮，通常是一段副歌）。
只引用原文，不改写、不翻译；只输出一个 JSON 对象，不要解释或代码块。

情感参考（可按歌曲气质变化，情绪转折处用颜色与场景的切换表现）：
- 伤感、思念：glow / focus / dissolve，冷色与淡紫（rain、midnight、ice、lavender、twilight），rain、snow、feathers、clouds
- 喜悦、青春：wave / shimmer，暖色与亮色（sunshine、lemon、peach、cherry-blossom），petals、hearts、butterflies、confetti
- 激昂、呐喊：swell / shake，炽烈的颜色（flame、crimson、gold、sunset），sparks、fireworks、meteors
- 温柔、陪伴：glow / heartbeat，烛光与月光（candlelight、moonlight、lavender），fireflies、stars、dandelion

effect：swell 饱满有力、推向高点｜glow 温柔、回忆、伤感｜wave 轻快、俏皮｜shake 呐喊、冲击，或长音的颤音｜focus 回忆浮现、恍然看清｜dissolve 唱完化成颗粒消散：消失、离开、告别、梦醒｜shimmer 流光扫过：光芒、闪耀、星辰、彩虹｜heartbeat 双拍心跳：心动、心跳、紧张、喜欢
color（填英文名；词语有约 65% 以上的色彩联想才上色，颜色与意象相符，优先用主色）：
{{colors}}
font（填英文名）：
{{fonts}}
`

const lyricAnnotationZHPlan = `
任务：全曲规划。逐行短语由后续任务并行完成，本次不输出 phrases。按顺序完成：
1. theme：一两句话写歌在讲什么、对谁说、情感从哪里走向哪里。
2. direction：演出基调——2～4 个主色、主要特效、字体用法、适合粒子场景的画面；后续标注都围绕它，像一场统一美术风格的演出。
3. 副歌：结合你对这首歌的了解、反复出现的段落与〔高潮片段〕标记，每段副歌的第一行标 chorus_start，副歌行标 chorus；同样的歌词在别处出现时一般也是副歌。副歌起点是爆发点，尽量在这里开启或切换场景。
4. imagery：全曲反复出现或点题的核心意象（原文的词），各定一个 effect 与 color（可不上色），全曲一律照此执行。
5. 布置：
- intro：前奏导语，40 字以内，像深夜电台主持人开场的低语，可点出背景或心情，不剧透歌词、不加引号。
- outro_comment：尾奏展示的热评编号，选最贴合歌曲情感的；没有合适的不填。
- moments：4～5 个，放在情绪转折、副歌开始、最动人的一句、高潮或落点（i 为行号），彼此相隔几句、分散全曲；优先填 comment（热评编号，不重复、不与 outro_comment 相同），没有合适的写 text（40 字以内的旁白，深情、有画面，不照抄歌词、不加引号）。
- font：全曲字体，可不填（默认黑体）。
- lines：情绪鲜明的行标 mood（calm / bright / sad / intense）；写到具体画面或副歌开始的行标 scene（全曲最多 6 处，持续约 8 行）与可选的 scene_color（取 color 的值，如紫荆花瓣用 bauhinia）。
scene（填英文名）：
{{scenes}}

输出：{"theme":"","direction":"","intro":"","outro_comment":1,"moments":[{"i":0,"comment":2},{"i":0,"text":""}],"font":"song","imagery":[{"text":"","effect":"glow","color":"rain"}],"lines":[{"i":0,"mood":"sad","chorus":true,"chorus_start":true,"scene":"rain","scene_color":"rain"}]}，lines 只列有标注的行。`

const lyricAnnotationZHLines = `
任务：逐行短语标注。全曲规划见【全曲规划】；只标注【本次标注范围】内的行，范围外的行只是上下文。
- phrases 的 text 必须是该行原文的连续片段：中日韩文 2～6 个字，英文 1～3 个词（长音的语气词可只取 1 个字）；每行最多 3 个，互不重叠。
- 遵循规划的方向与主色；【意象】中的词，effect 与 color 必须与规划一致。
- 主歌克制留白，越接近副歌越浓：约一半到三分之二的行有强调，副歌几乎每行都有；chorus_start 的行用满 3 个短语，配 swell / shake 与鲜明的颜色。
- 挑最值得被唱出来的词：告白、呐喊、核心意象、点题的词、副歌关键词。署名行、拟声词、语气词不标（唱成长音的除外）。
- 长音：行末有〔长音〕时，把包含该音节的片段（可带前面 1～3 个字，如尾音「た」的「連れ出した」取「出した」）设为 shake，表现颤音，句尾的尾音最适合；平静处可用 glow。没有〔长音〕的普通句尾不加 shake。
- dissolve、shimmer、heartbeat 只用在语义贴切的词上，本段每种最多 1 处。
- 换字体只为制造反差（回忆换楷体、电子音换等宽）；删除线只在语义需要时用。
styles（可组合）：bold 宣言、力量｜italic 低语、回忆、引用｜underline 誓言、承诺（永远、一定）｜strike 被否定、放弃（不再、说好的）

输出：{"lines":[{"i":0,"phrases":[{"text":"原文片段","effect":"swell","color":"gold","font":"kai","styles":["bold"]}]}]}，只列本次范围内有标注的行。`

// fillLyricAnnotationPrompt 填入色板、粒子场景与字体：每项一行「英文名 名称：适合的意象」；english 时用英文说明
func fillLyricAnnotationPrompt(prompt string, english bool) string {
	var colors, fonts, scenes []string
	for _, color := range lyricAnnotationPalette {
		colors = append(colors, lyricAnnotationListItem(color.Key, color.Name, color.Hint, english))
	}
	for _, font := range lyricAnnotationFontList {
		fonts = append(fonts, lyricAnnotationListItem(font.Key, font.Name, font.Hint, english))
	}
	for _, scene := range lyricAnnotationSceneList {
		scenes = append(scenes, lyricAnnotationListItem(scene.Key, scene.Name, scene.Hint, english))
	}
	return strings.NewReplacer(
		"{{colors}}", strings.Join(colors, "\n"),
		"{{fonts}}", strings.Join(fonts, "\n"),
		"{{scenes}}", strings.Join(scenes, "\n"),
	).Replace(prompt)
}

func lyricAnnotationListItem(key, name, hint string, english bool) string {
	if english {
		return fmt.Sprintf("%s: %s", key, lyricAnnotationHintsEN[key])
	}
	return fmt.Sprintf("%s %s：%s", key, name, hint)
}

// lyricAnnotationHintsEN 色板、字体与粒子场景的英文说明（英文提示词使用）
var lyricAnnotationHintsEN = map[string]string{
	"crimson":        "passion, heartbeat, blood, red itself",
	"rose":           "roses, love, confession, kiss",
	"flame":          "fire, burning, passion, battle",
	"sunset":         "dusk, sunset glow, parting",
	"coral":          "coral, seaside, midsummer",
	"maple":          "maple leaves, late autumn",
	"amber":          "autumn, nostalgia, lamplight, old times",
	"peach":          "blushing, sweetness, crush, shyness",
	"cherry-blossom": "cherry blossoms, spring, first love",
	"bauhinia":       "bauhinia flowers, Hong Kong",
	"sunshine":       "sunshine, sunny days, summer, hope",
	"gold":           "glory, dreams, radiance, treasure, gold",
	"lemon":          "fresh, youth, playful, lively",
	"candlelight":    "candlelight, warmth, home, embrace, company",
	"spring-green":   "sprouts, new life, growing",
	"forest":         "forests, trees, grass, nature",
	"mint":           "cool, breeze, summer afternoon",
	"jade":           "jade, gems, lake light, classical",
	"aurora":         "aurora, fantasy, the far north",
	"lake":           "lakes, streams, clarity, reflection",
	"sky":            "clear sky, freedom, flying, far away",
	"ocean":          "sea, harbor, waves, voyage",
	"starry-blue":    "starry sky, night, universe, dreams",
	"midnight":       "late night, longing, silence, insomnia",
	"ice":            "ice and snow, cold, winter, distance",
	"rain":           "rainy days, gloom, tears, overcast",
	"lavender":       "lavender, romance, gentle longing",
	"violet":         "violets, mystery, nobility, purple itself",
	"twilight":       "after dusk, ambiguity, haze",
	"wisteria":       "wisteria, softness, waiting",
	"moonlight":      "moon, moonlight, purity",
	"silver":         "milky way, metal, calm, passing time",
	"song":           "Song serif — classical, literary, poetic, nostalgic",
	"kai":            "Kai — letters, handwriting, ancient style, whispers",
	"xingkai":        "running script — calligraphy, heroic, freehand",
	"fangsong":       "FangSong — old times, old film subtitles, diaries",
	"round":          "rounded — cute, childlike, sweet",
	"mono":           "monospace — electronic, mechanical, sci-fi, cold",
	"script":         "English script — romantic, elegant (Latin letters only)",
	"petals":         "flowers, falling petals, spring",
	"sparks":         "light, sparks, shining, hope",
	"snow":           "snow, winter, cold",
	"stars":          "stars, night sky, universe",
	"bubbles":        "underwater, seabed, soda, dreamy",
	"leaves":         "falling leaves, autumn, withering, parting",
	"fireflies":      "fireflies, summer nights, fields, childhood",
	"feathers":       "feathers, wings, angels, lightness",
	"hearts":         "love, crush, confession, sweetness",
	"confetti":       "celebration, party, birthday, cheering",
	"fireworks":      "fireworks, festivals, new year, brilliant but brief",
	"dandelion":      "dandelions, drifting with the wind, wandering",
	"butterflies":    "butterflies, gardens, transformation, freedom",
	"meteors":        "meteors, wishes, fleeting",
	"clouds":         "clouds, mist, sky, haze",
	"ripples":        "lake surface, rain on water, a stirred heart",
	"notes":          "singing, melody, music itself",
}
