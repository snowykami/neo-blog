package service

import "strings"

// 歌词标注的提示词（见 docs/music-player-spec.md 7.2b）：全曲规划与逐段标注各用一份系统提示词，只放本任务需要的规则，
// 色板、粒子场景与字体由数据表生成（与前端保持一致）。用户消息中的标签也放在这里，与系统提示词使用同一种语言。
// 使用英文：实测（music_annotation_eval_test.go，8 首歌）比同内容的中文版盲评胜率 62.5%、输出 token 少约 31%、耗时少约 18%，
// 且不会像中文版那样从中文翻译里取短语；导语与时刻的文字仍要求用简体中文。
// 写法参考 Anthropic 的提示词建议：规则附上原因（模型知道为什么才能举一反三）、尽量说「怎么做」而不是「不要做什么」、输入用 XML 标签分块、要做的事放在用户消息最后

// lyricAnnotationLocale 一种语言的提示词：两个任务的系统提示词，以及用户消息里的各个标签（含 fmt 占位符的按注释中的顺序填写）
type lyricAnnotationLocale struct {
	PlanPrompt  string
	LinesPrompt string

	// 用户消息的各部分用 XML 标签包住（Anthropic 的提示词建议：不同类型的输入分块标出，模型更不容易混淆）：歌曲信息的开始与结束标签、各字段
	SongInfo, SongEnd, Title, Artists, Album, Aliases string
	// 热评的开始与结束标签；一条热评：序号、内容、点赞数
	Comments, CommentsEnd, Comment string
	// 网易云高潮片段在歌词行末的标记：片段开始、片段结束
	ClimaxStart, ClimaxEnd string
	// 歌词的开始与结束标签，有翻译 / 有长音时追加的说明；翻译：译文；长音：音节、秒数、句尾标记
	Lyrics, LyricsEnd, TranslationNote, HeldNote, Translation, Held, HeldTail string
	// 逐段标注：全曲规划的开始与结束标签、主题、方向、全曲字体、全曲节奏、意象标题、一个意象（原文、特效、颜色）、不上色
	Plan, PlanEnd, Theme, Direction, Font, Pace, Imagery, ImageryItem, NoColor string
	// 本段已标注的行（标题、一行：行号与标注）、副歌起点、副歌、情绪、聚光灯
	Marks, Mark, ChorusStart, ChorusLine, Mood, Spotlight string
	// 本次标注范围（放在用户消息最后，作为要做的事）：起止行号、段数、本段换字体的上限
	Range string
}

// lyricAnnotationText 当前使用的提示词语言
var lyricAnnotationText = lyricAnnotationEN

var lyricAnnotationEN = lyricAnnotationLocale{
	PlanPrompt:  fillLyricAnnotationPrompt(lyricAnnotationENHead + lyricAnnotationENPlan),
	LinesPrompt: fillLyricAnnotationPrompt(lyricAnnotationENHead + lyricAnnotationENLines),

	SongInfo: "<song>\n", SongEnd: "</song>\n", Title: "Title: ", Artists: "Artists: ", Album: "Album: ", Aliases: "Aliases / description: ",
	Comments: "\n<listener_comments>\n", CommentsEnd: "</listener_comments>\n", Comment: "%d. %s (%d likes)\n",
	ClimaxStart: "　〔climax starts〕", ClimaxEnd: "　〔climax ends〕",
	Lyrics: "\n<lyrics>\n", LyricsEnd: "</lyrics>\n",
	TranslationNote: "〔译：…〕 is a Chinese translation, for understanding only.\n", HeldNote: "〔held: …〕 marks a long-held syllable.\n",
	Translation: "　〔译：%s〕", Held: "　〔held: \"%s\" %.1fs%s〕", HeldTail: ", line end",
	Plan: "\n<plan>\n", PlanEnd: "</plan>\n", Theme: "Theme: ", Direction: "Direction: ", Font: "Song font: ", Pace: "Song pace: ",
	Imagery: "Imagery:\n", ImageryItem: "- %s: %s, %s\n", NoColor: "no color",
	Marks: "Marked lines in this chunk:\n", Mark: "line %d: %s\n", ChorusStart: "chorus start", ChorusLine: "chorus", Mood: "mood ", Spotlight: "spotlight",
	Range: "\nAnnotate lines %d-%d (the song is split into %d chunks annotated in parallel; at most %d font changes in this chunk).\n",
}

const lyricAnnotationENHead = `You are a lyric performance director designing visuals for a word-synced lyric player. First understand the song's emotion and story, then convey it with restrained, precise effects: a few well-placed effects move listeners more than many, because each one stands out against calm lines.

Input, in XML tags:
- <song>: title, artists, and aliases / description, which often reveal the background.
- <listener_comments> (may be absent): use the ones that match the song's feeling; jokes and off-topic comments say little about the song.
- <lyrics>: one "index: original text" per line, possibly followed by 〔译：…〕 (a translation for understanding), 〔held: …〕 (a long-held syllable found from word timing) and 〔climax starts / ends〕 (the climax NetEase marks on its progress bar, usually one chorus).
Copy phrases exactly as they appear in the original lyrics: the player finds each phrase by its text, so a rewritten or translated phrase cannot be located. Reply with one JSON object only, since the server parses your reply directly. Write intro and moment text in Simplified Chinese, the language of the site's readers.

Emotion guide (adapt to the song; mark emotional turns with a change of color and scene):
- sad, longing: glow / focus / dissolve; cool colors and pale violet (rain, midnight, ice, lavender, twilight); rain, snow, feathers, clouds
- joyful, youthful: wave / shimmer; warm bright colors (sunshine, lemon, peach, cherry-blossom); petals, hearts, butterflies, confetti
- passionate, shouting: swell / shake; fiery colors (flame, crimson, gold, sunset); sparks, fireworks, meteors
- tender, comforting: glow / heartbeat; candle and moon light (candlelight, moonlight, lavender); fireflies, stars, dandelion

effect, grouped by what the words do:
- grow: swell full, rising to a peak | heartbeat double-beat pulse: crush, heartbeat, nervous, "I like you" | wave light, playful
- tremble: shake shout, impact, or vibrato on a held note
- light: glow tender, memory, sorrow | shimmer a gleam sweeps across: light, shining, stars, rainbow
- focus: focus memory surfacing, sudden clarity (the player also pushes the camera in at each chorus_start and spotlights the plan's spotlight line)
- vanish: dissolve crumbles into drifting grains after it is sung, slowly: vanish, leave, farewell, waking from a dream, something denied or given up (no longer, what we promised) | shatter breaks into falling shards the instant it is sung: a sudden break — a heart breaking, a dream or glass shattering, a promise snapped, a crash
color: use one when the word clearly evokes a color (about 65% or more of readers would picture it); match the image and prefer the plan's main colors, so the palette stays coherent:
{{colors}}
font:
{{fonts}}
`

const lyricAnnotationENPlan = `
Task: plan the whole song. Phrases are annotated afterwards, chunk by chunk in parallel, following this plan — so this step outputs only the plan fields below. In order:
1. theme: one or two sentences — what the song is about, to whom, and how the feeling moves.
2. direction: the visual tone — 2-4 main colors, main effects, font usage, images suited to particle scenes. Every chunk follows it, which keeps the parallel parts looking like one art-directed show.
3. chorus: using your knowledge of the song, repeated sections and the 〔climax〕 marks, set chorus_start on the first line of each chorus and chorus on chorus lines; the same lyrics elsewhere usually form the other choruses. A chorus start is an outburst, a good place to start or switch a scene.
4. imagery: the song's recurring or title images (original words), each with one effect and color (color optional). Every chunk uses them as given, so an image looks the same each time it returns.
5. Layout:
- intro: a lead-in shown during the intro, at most 40 Chinese characters, like a late-night radio host's murmur. Hint at the background or mood in your own words; the lyrics themselves are better heard for the first time when they are sung.
- outro_comment: the number of the comment shown during the outro, the one that best fits the song; omit it if none fits.
- moments: 4-5, at emotional turns, chorus starts, the most moving line, the climax or ending (i = line index), spread out with several lines between so each one has room. Prefer comment (a comment number, each used once, other than the outro_comment); otherwise text, a narration of at most 40 Chinese characters in your own words, heartfelt and vivid.
- font: song-wide font, optional (default sans).
- spotlight: the index i of the ONE line that sums up the whole song — its title line or deepest confession, usually inside the last chorus, sung for at least ~2 seconds. While it is sung it moves alone to the center, enlarged, with a warm light behind it and the other lines dimmed; it happens once per song. Omit it if no line clearly stands out.
- pace: how fast the effects move, from the song's tempo and lightness — fast for upbeat, bouncy, energetic songs; slow for ballads, lyrical, tender or heavy songs; medium otherwise. It sets the speed of shake, wave, heartbeat, shimmer, dissolve and the held-note vibrato.
- lines: mood (calm / bright / sad / intense) on emotionally clear lines; scene on lines describing a concrete image or starting a chorus (up to 6 per song, each lasting ~8 lines), with optional scene_color (a color value, e.g. bauhinia for bauhinia petals).
scene:
{{scenes}}

Output: {"theme":"","direction":"","intro":"","outro_comment":1,"moments":[{"i":0,"comment":2},{"i":0,"text":""}],"font":"song","pace":"medium","spotlight":0,"imagery":[{"text":"","effect":"glow","color":"rain"}],"lines":[{"i":0,"mood":"sad","chorus":true,"chorus_start":true,"scene":"rain","scene_color":"rain"}]}; list only lines with marks.`

const lyricAnnotationENLines = `
Task: annotate phrases line by line for the lines named at the end, following the song plan in <plan>. Neighbouring lines in <lyrics> are there as context.
- Held notes first: a 〔held: "X" …〕 mark means the singer sustains X and sings vibrato on it. Give every such line a shake phrase containing X (add the 1-3 preceding characters, e.g. 出した for the held た in 連れ出した; a held interjection like Ahh may stand alone). The player swells the phrase, waits a moment, then trembles for as long as the note lasts. Only a whispered, very soft hold may use glow instead. Without 〔held〕, keep shake for real shouts or anger, not for ordinary line endings.
- phrase text is a contiguous substring of its line: 2-6 CJK characters or 1-3 English words (a held interjection may be 1 character), at most 3 per line, not overlapping. Short phrases keep the effect focused on the words that matter.
- Follow the plan's direction and main colors; words listed in Imagery take the planned effect and color.
- Keep verses restrained and build toward the chorus, so the chorus lands: roughly half to two thirds of lines get emphasis, almost every chorus line does; a chorus_start line gets 3 phrases with swell / shake and vivid colors.
- Pick the words most worth singing out: confessions, shouts, core images, title words, chorus keywords. Leave credit lines, onomatopoeia and interjections plain (unless held).
- dissolve, shatter, shimmer and heartbeat are highlights: use each only where the meaning fits, at most once per chunk, so they stay special.
- A line marked spotlight is already enlarged, centered and lit by the player: give it at most 2 simple phrases (color, bold, one swell or glow). Heartbeat, shimmer or stacked glows blur once the line is enlarged.
- Change fonts for contrast (kai for a memory, mono for electronic sounds); constant switching looks noisy.
- pace (optional): set it when a phrase's feel differs from the song pace in <plan> — fast for a light, bouncy, excited or racing-heart phrase; slow for a lingering, heavy or tender one. Otherwise leave it out.
styles (combinable): bold declaration, strength | italic whisper, memory, quotation | underline vow, promise (forever, surely)

Before output, check: every 〔held〕 line in your range has its shake phrase; every text is a contiguous substring of its line.
Output: {"lines":[{"i":0,"phrases":[{"text":"original fragment","effect":"swell","color":"gold","font":"kai","styles":["bold"],"pace":"fast"}]}]}; list only annotated lines in your range.`

// fillLyricAnnotationPrompt 填入色板、粒子场景与字体：每项一行「名称: 适合的意象」
func fillLyricAnnotationPrompt(prompt string) string {
	var colors, fonts, scenes []string
	for _, color := range lyricAnnotationPalette {
		colors = append(colors, color.Key+": "+color.Hint)
	}
	for _, font := range lyricAnnotationFontList {
		fonts = append(fonts, font.Key+": "+font.Hint)
	}
	for _, scene := range lyricAnnotationSceneList {
		scenes = append(scenes, scene.Key+": "+scene.Hint)
	}
	return strings.NewReplacer(
		"{{colors}}", strings.Join(colors, "\n"),
		"{{fonts}}", strings.Join(fonts, "\n"),
		"{{scenes}}", strings.Join(scenes, "\n"),
	).Replace(prompt)
}
