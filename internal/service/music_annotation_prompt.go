package service

import "strings"

// 歌词标注的提示词（见 docs/music-player-spec.md 7.2b）：全曲规划与逐段标注各用一份系统提示词，只放本任务需要的规则，
// 色板、粒子场景与字体由数据表生成（与前端保持一致）。用户消息中的标签也放在这里，与系统提示词使用同一种语言。
// 使用英文：实测（music_annotation_eval_test.go，8 首歌）比同内容的中文版盲评胜率 62.5%、输出 token 少约 31%、耗时少约 18%，
// 且不会像中文版那样从中文翻译里取短语；导语与时刻的文字仍要求用简体中文

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
	// 逐段标注：全曲规划标题、主题、方向、全曲字体、全曲节奏、意象标题、一个意象（原文、特效、颜色）、不上色
	Plan, Theme, Direction, Font, Pace, Imagery, ImageryItem, NoColor string
	// 本段已标注的行（标题、一行：行号与标注）、副歌起点、副歌、情绪
	Marks, Mark, ChorusStart, ChorusLine, Mood string
	// 本次标注范围：起止行号、段数、本段换字体的上限
	Range string
}

// lyricAnnotationText 当前使用的提示词语言
var lyricAnnotationText = lyricAnnotationEN

var lyricAnnotationEN = lyricAnnotationLocale{
	PlanPrompt:  fillLyricAnnotationPrompt(lyricAnnotationENHead + lyricAnnotationENPlan),
	LinesPrompt: fillLyricAnnotationPrompt(lyricAnnotationENHead + lyricAnnotationENLines),

	SongInfo: "[Song]\n", Title: "Title: ", Artists: "Artists: ", Album: "Album: ", Aliases: "Aliases / description: ",
	Comments: "\n[Listener comments]\n", Comment: "%d. %s (%d likes)\n",
	ClimaxStart: "　〔climax starts〕", ClimaxEnd: "　〔climax ends〕",
	Lyrics: "\n[Lyrics]", TranslationNote: " (〔译：…〕 is a Chinese translation)", HeldNote: " (〔held: …〕 marks a long-held syllable)",
	Translation: "　〔译：%s〕", Held: "　〔held: \"%s\" %.1fs%s〕", HeldTail: ", line end",
	Plan: "\n[Plan]\n", Theme: "Theme: ", Direction: "Direction: ", Font: "Song font: ", Pace: "Song pace: ",
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

effect: swell full, rising to a peak | glow tender, memory, sorrow | wave light, playful | shake shout, impact, or vibrato on a held note | focus memory surfacing, sudden clarity | dissolve crumbles into drifting grains after it is sung: vanish, leave, farewell, waking from a dream, something denied or given up (no longer, what we promised) | shimmer a gleam sweeps across: light, shining, stars, rainbow | heartbeat double-beat pulse: crush, heartbeat, nervous, "I like you"
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
- pace: how fast the effects move, from the song's tempo and lightness — fast for upbeat, bouncy, energetic songs; slow for ballads, lyrical, tender or heavy songs; medium otherwise. It sets the speed of shake, wave, heartbeat, shimmer, dissolve and the held-note vibrato.
- lines: mood (calm / bright / sad / intense) on emotionally clear lines; scene on lines describing a concrete image or starting a chorus (at most 6 per song, lasts ~8 lines), with optional scene_color (a color value, e.g. bauhinia for bauhinia petals).
scene:
{{scenes}}

Output: {"theme":"","direction":"","intro":"","outro_comment":1,"moments":[{"i":0,"comment":2},{"i":0,"text":""}],"font":"song","pace":"medium","imagery":[{"text":"","effect":"glow","color":"rain"}],"lines":[{"i":0,"mood":"sad","chorus":true,"chorus_start":true,"scene":"rain","scene_color":"rain"}]}; list only lines with marks.`

const lyricAnnotationENLines = `
Task: annotate phrases line by line. The song plan is in [Plan]; annotate only lines in [Your range] — other lines are context.
- Held notes first: a 〔held: "X" …〕 mark means the singer sustains X and sings vibrato on it. Give every such line a shake phrase containing X (add the 1-3 preceding characters, e.g. 出した for the held た in 連れ出した; a held interjection like Ahh may stand alone). The player swells the phrase, waits a moment, then trembles for as long as the note lasts. Only a whispered, very soft hold may use glow instead. Without 〔held〕, use shake only for real shouts or anger — never just because a line ends.
- phrase text must be a contiguous substring of that line: 2-6 CJK characters or 1-3 English words (a held interjection may be 1 character); at most 3 per line, non-overlapping.
- Follow the plan's direction and main colors; words listed in Imagery must use the planned effect and color.
- Keep verses restrained and build toward the chorus: roughly half to two thirds of lines get emphasis, almost every chorus line does; a chorus_start line gets 3 phrases with swell / shake and vivid colors.
- Pick the words most worth singing out: confessions, shouts, core images, title words, chorus keywords. Skip credit lines, onomatopoeia and interjections (unless held).
- Use dissolve, shimmer and heartbeat only where the meaning fits, at most once each per chunk.
- Change fonts only for contrast (kai for a memory, mono for electronic sounds).
- pace (optional): only when a phrase's feel differs from the song pace in [Plan] — fast for a light, bouncy, excited or racing-heart phrase; slow for a lingering, heavy or tender one. Omit it otherwise.
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
