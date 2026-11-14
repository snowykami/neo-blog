package service

import (
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// lyricTranslateLanguages 支持的 AI 歌词翻译目标语言（与前端 service language / 评论翻译语言保持一致）
var lyricTranslateLanguages = map[string]string{
	"zh":    "简体中文",
	"zh-tw": "台灣繁體中文（使用台灣地道書面語與用詞，切勿機械簡轉繁）",
	"zh-hk": "香港澳門繁體中文（使用港澳地道書面語與用詞，切勿機械簡轉繁）",
	"en":    "English",
	"ja":    "日本語",
	"ko":    "한국어",
}

// 繁简高频特征字表（常见高频且仅在简体或繁体侧出现的字，用于判断中文文本属于简体还是繁体）
const (
	lyricTradDistinctChars = "們這為說時來對會著過還讓給從沒進動發開見經現樣點聽風愛覺夢淚歲聲詞樂車長門問間裡後無東難寫讀語話誰請問謝認識學寫書畫電腦機車飛關總結實際應當應該變變化處總體體萬與業叢嚴喪個豐臨麗舉義樂喬習鄉買亂乾虧雲亞產親億僅僕仍倉儀優價儲兒黨蘭關興養獸內冊寫軍農冠沖決況凍淨準涼減幾鳳憑凱出擊劉則剛創刪別刮到制刷券刺刻劑"
	lyricSimpDistinctChars = "们这为说时来对会着过还让给从没进动发开见经现样点听风爱觉梦泪岁声词乐车长门问间里后无东难写读语话谁请问谢认识学写书画电脑机车飞关总结实际应当应该变变化处总体体万与业丛严丧个丰临丽举义乐乔习乡买乱干亏云亚产亲亿仅仆仍仓仪优价储儿党兰关兴养兽内册写军农冠冲决况冻净准凉减几凤凭凯出击刘则刚创删别刮到制刷券刺刻剂"
)

var (
	lyricTradSet = runeSetFromString(lyricTradDistinctChars)
	lyricSimpSet = runeSetFromString(lyricSimpDistinctChars)

	lyricInterjectionWords = map[string]bool{
		"oh": true, "ooh": true, "oooh": true, "ah": true, "ahh": true, "aah": true,
		"yeah": true, "yea": true, "yep": true, "nah": true, "na": true, "la": true,
		"da": true, "ba": true, "ra": true, "sha": true, "hey": true, "yo": true, "uh": true,
		"mm": true, "hmm": true, "hm": true, "baby": true, "woo": true, "woah": true,
		"whoa": true, "ha": true, "haha": true, "eh": true, "ay": true, "ayy": true,
		"hu": true, "uhh": true, "mhm": true, "o": true,
		"nya": true, "ny": true, "bala": true, "dala": true,
		"pico": true, "bibo": true, "dido": true, "nino": true,
		"pa": true, "pap": true, "doo": true, "bop": true, "cha": true,
		"ding": true, "dong": true, "boom": true, "bang": true,
		"ya": true, "yoo": true, "wah": true, "wo": true,
	}

	// 多词英文行中一旦出现常见虚词/实词，不视为纯拟声词（避免误跳过 "no I love you" 等真歌词）
	lyricEnglishFunctionWords = map[string]bool{
		"i": true, "you": true, "he": true, "she": true, "it": true, "we": true, "they": true,
		"me": true, "him": true, "her": true, "us": true, "them": true,
		"my": true, "your": true, "his": true, "its": true, "our": true, "their": true,
		"am": true, "is": true, "are": true, "was": true, "were": true, "be": true, "been": true,
		"do": true, "does": true, "did": true, "have": true, "has": true, "had": true,
		"can": true, "could": true, "will": true, "would": true, "shall": true, "should": true,
		"may": true, "might": true, "must": true,
		"a": true, "an": true, "the": true, "and": true, "or": true, "but": true, "if": true,
		"so": true, "no": true, "not": true, "yes": true,
		"in": true, "on": true, "at": true, "to": true, "for": true, "of": true, "from": true,
		"by": true, "with": true, "as": true, "up": true, "out": true, "off": true, "down": true, "all": true,
		"go": true, "come": true, "see": true, "say": true, "let": true, "get": true, "got": true,
		"put": true, "run": true, "love": true, "like": true, "know": true, "want": true, "need": true,
		"feel": true, "make": true, "take": true, "time": true, "day": true, "way": true, "now": true,
		"here": true, "one": true, "two": true, "why": true, "who": true, "how": true, "what": true,
		"when": true, "where": true, "this": true, "that": true,
		"im": true, "dont": true, "away": true, "never": true, "just": true,
	}

	lyricSingerCueRoles = map[string]bool{
		"男": true, "女": true, "合": true, "合唱": true, "齐": true, "齊": true, "齐唱": true, "齊唱": true,
		"男声": true, "男聲": true, "女声": true, "女聲": true, "童声": true, "童聲": true,
		"主唱": true, "伴唱": true, "和声": true, "和聲": true, "独白": true, "獨白": true,
		"念白": true, "旁白": true, "说唱": true, "說唱": true, "rap": true,
		"male": true, "female": true, "all": true, "both": true, "chorus": true, "together": true, "vocal": true,
	}

	lyricSectionTagRe = regexp.MustCompile(`^(?:\[[^\]]{1,32}\]|【[^】]{1,32}】|\([^)]{1,32}\)|（[^）]{1,32}）)$`)
	lyricSectionWords = map[string]bool{
		"intro": true, "verse": true, "chorus": true, "bridge": true, "outro": true,
		"prechorus": true, "hook": true, "interlude": true, "solo": true, "instrumental": true,
		"music": true, "rap": true, "break": true, "ending": true, "coda": true,
		"前奏": true, "主歌": true, "副歌": true, "间奏": true, "間奏": true, "尾奏": true,
		"桥段": true, "橋段": true, "独奏": true, "獨奏": true, "伴奏": true, "纯音乐": true, "純音樂": true,
	}
	lyricArtistSplitRe   = regexp.MustCompile(`[/、&,，·+]+`)
	lyricParensCleanupRe = regexp.MustCompile(`\([^)]*\)|（[^）]*）`)
	lyricParensInnerRe   = regexp.MustCompile(`\(([^)]+)\)|（([^）]+)）`)
	lyricColonSplitRe    = regexp.MustCompile(`[：:]`)
)

func runeSetFromString(s string) map[rune]bool {
	set := make(map[rune]bool, utf8.RuneCountInString(s))
	for _, r := range s {
		set[r] = true
	}
	return set
}

// normalizeLyricLangTag 把 TTML xml:lang 等 BCP-47 语言标签归一化为目标服务语言或 other；-Latn 音译标签视为空
func normalizeLyricLangTag(raw string) string {
	tag := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(raw, "_", "-")))
	if tag == "" || strings.Contains(tag, "-latn") {
		return ""
	}
	switch {
	case tag == "zh-hk" || tag == "zh-mo" || strings.HasPrefix(tag, "zh-hk-") || strings.HasPrefix(tag, "zh-mo-") || strings.HasSuffix(tag, "-hk") || strings.HasSuffix(tag, "-mo"):
		return "zh-hk"
	case tag == "zh-tw" || strings.HasPrefix(tag, "zh-tw-") || strings.HasSuffix(tag, "-tw") || strings.Contains(tag, "-hant") || strings.Contains(tag, "hant"):
		return "zh-tw"
	case tag == "zh" || strings.HasPrefix(tag, "zh-"):
		return "zh"
	case tag == "en" || strings.HasPrefix(tag, "en-"):
		return "en"
	case tag == "ja" || strings.HasPrefix(tag, "ja-") || tag == "jp":
		return "ja"
	case tag == "ko" || strings.HasPrefix(tag, "ko-") || tag == "kr":
		return "ko"
	default:
		// 仅检查主语言前缀是否为合法字母段
		head, _, _ := strings.Cut(tag, "-")
		if len(head) >= 2 && len(head) <= 3 {
			return "other"
		}
		return ""
	}
}

type lyricScriptStats struct {
	han   int
	kana  int
	hang  int
	latin int
	other int
	trad  int
	simp  int
}

func countLyricScripts(texts []string) (lyricScriptStats, []string) {
	var stats lyricScriptStats
	var latinWords []string
	var curWord strings.Builder
	flushWord := func() {
		if curWord.Len() > 0 {
			latinWords = append(latinWords, curWord.String())
			curWord.Reset()
		}
	}
	for _, text := range texts {
		for _, r := range text {
			switch {
			case unicode.In(r, unicode.Hiragana, unicode.Katakana):
				flushWord()
				stats.kana++
			case unicode.In(r, unicode.Hangul):
				flushWord()
				stats.hang++
			case unicode.In(r, unicode.Han):
				flushWord()
				stats.han++
				if lyricTradSet[r] {
					stats.trad++
				}
				if lyricSimpSet[r] {
					stats.simp++
				}
			case unicode.In(r, unicode.Latin):
				stats.latin++
				curWord.WriteRune(unicode.ToLower(r))
			case r == '\'' || r == '’':
				// 忽略英文缩写撇号，合并 don't -> dont
			case unicode.IsLetter(r):
				flushWord()
				stats.other++
			default:
				flushWord()
			}
		}
		flushWord()
	}
	return stats, latinWords
}

// detectLyricTextLang 识别一组歌词或参考翻译文本的主要语言（返回 zh / zh-tw / zh-hk / en / ja / ko / other，空文本返回 ""）
func detectLyricTextLang(texts []string, explicitTag string) string {
	normTag := normalizeLyricLangTag(explicitTag)
	stats, latinWords := countLyricScripts(texts)
	total := stats.han + stats.kana + stats.hang + stats.latin + stats.other
	if total == 0 {
		return normTag
	}
	cjk := stats.han + stats.kana + stats.hang

	// 显式标签需与实际文字脚本交叉校验，避免如将中文翻译误标为 ja/ko/en/zh-tw 时污染语言判断
	switch normTag {
	case "ja":
		if stats.kana > 0 || (stats.han > 0 && stats.han <= 4 && stats.hang == 0 && stats.latin == 0 && stats.simp == 0) {
			return "ja"
		}
	case "ko":
		if stats.hang > 0 {
			return "ko"
		}
	case "en":
		if stats.latin > 0 && (cjk == 0 || stats.latin > cjk*2) {
			return "en"
		}
	case "other":
		if (stats.other > 0 || stats.latin > 0) && cjk == 0 {
			return "other"
		}
	case "zh-tw", "zh-hk":
		if stats.kana == 0 && stats.hang == 0 && stats.han > 0 {
			if stats.simp >= 2 && stats.simp > stats.trad*2 {
				return "zh"
			}
			return normTag
		}
	case "zh":
		if stats.kana == 0 && stats.hang == 0 {
			if stats.han == 0 && stats.latin > stats.other {
				return detectLatinLang(latinWords)
			}
			if stats.trad >= 2 && stats.trad > stats.simp*2 {
				return "zh-tw"
			}
			if stats.han > 0 {
				return "zh"
			}
		}
	}

	if stats.kana >= 2 && float64(stats.kana) >= float64(max(cjk, 1))*0.05 {
		return "ja"
	}
	if stats.hang >= 2 && float64(stats.hang) >= float64(total)*0.1 {
		return "ko"
	}
	if stats.han > 0 && (stats.latin == 0 || float64(stats.han) >= float64(stats.latin)*0.15) {
		if stats.trad >= 2 && stats.trad > stats.simp*2 {
			return "zh-tw"
		}
		return "zh"
	}
	if stats.latin >= stats.other && stats.latin > 0 {
		return detectLatinLang(latinWords)
	}
	if stats.other > 0 {
		return "other"
	}
	return ""
}

func detectLatinLang(words []string) string {
	hits := map[string]bool{}
	for _, w := range words {
		if lyricEnglishFunctionWords[w] {
			hits[w] = true
		}
	}
	if len(hits) >= 2 || (len(words) <= 6 && len(hits) >= 1) {
		return "en"
	}
	return "other"
}

func isShortInterjectionLatin(text string) bool {
	stats, words := countLyricScripts([]string{text})
	if stats.han+stats.kana+stats.hang+stats.other > 0 {
		return false
	}
	if len(words) == 0 {
		return true
	}
	if len(words) == 1 {
		return len([]rune(words[0])) <= 5 && (lyricInterjectionWords[words[0]] || !lyricEnglishFunctionWords[words[0]])
	}
	allInterjection := true
	shortOrInterjection := 0
	hasRepeat := false
	maxLen := 0
	uniq := make(map[string]bool, len(words))
	for i, w := range words {
		if lyricEnglishFunctionWords[w] {
			return false
		}
		if !lyricInterjectionWords[w] {
			allInterjection = false
		}
		wLen := len([]rune(w))
		if wLen > maxLen {
			maxLen = wLen
		}
		if wLen <= 3 || lyricInterjectionWords[w] {
			shortOrInterjection++
		}
		if i > 0 && w == words[i-1] {
			hasRepeat = true
		}
		uniq[w] = true
	}
	if allInterjection {
		return true
	}
	// 连字符拟声/哼唱（如 "Pico bala-ba-ba-ba"、"Nino na-ra-na-na-na"、"Tick-tock"）
	hasHyphen := strings.Contains(text, "-")
	return len(words) >= 3 && (hasRepeat || hasHyphen) && shortOrInterjection*2 >= len(words) && maxLen <= 6 && len(uniq) <= len(words)-1
}

// songAlreadyInTargetLang 判断整首歌的有效唱词是否已纯属目标语言（若含实质性多语混唱则返回 false，由 AI 逐行判断）
func songAlreadyInTargetLang(vocalLines []string, targetLang string) bool {
	if len(vocalLines) == 0 {
		return true
	}
	var substantive []string
	substantiveLatinLines := 0
	hasKana := false
	hasHang := false
	hasHan := false
	hasOtherScript := false
	pureHanLines := 0

	for _, line := range vocalLines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || isShortInterjectionLatin(trimmed) {
			continue
		}
		stats, _ := countLyricScripts([]string{trimmed})
		if stats.han+stats.kana+stats.hang+stats.latin+stats.other == 0 {
			continue
		}
		substantive = append(substantive, trimmed)
		if stats.kana > 0 {
			hasKana = true
		}
		if stats.hang > 0 {
			hasHang = true
		}
		if stats.han > 0 {
			hasHan = true
		}
		if stats.other > 0 {
			hasOtherScript = true
		}
		if stats.han > 0 && stats.kana == 0 && stats.hang == 0 && stats.latin == 0 && stats.other == 0 && utf8.RuneCountInString(normalizeLyricMatch(trimmed)) >= 3 {
			pureHanLines++
		}
		if stats.latin > 0 && stats.han == 0 && stats.kana == 0 && stats.hang == 0 && stats.other == 0 {
			substantiveLatinLines++
		}
	}
	if len(substantive) == 0 {
		return true
	}

	switch targetLang {
	case "zh", "zh-tw", "zh-hk":
		// 纯中文歌（可含拟声/哼唱词，如 "Pico bala-ba-ba-ba"）通常无需翻译；
		// 但若含古文/文言文句子（如《琵琶行》或含古文句的古风歌曲），仍交给 AI 做「古文转白话」；
		// 若混有假名、谚文、其他文字或任何实质性英文歌词，也交给 AI 逐行判断
		if !(hasHan && !hasKana && !hasHang && !hasOtherScript && substantiveLatinLines == 0) {
			return false
		}
		return !songHasClassicalChinese(substantive)
	case "ja":
		return hasKana && !hasHang && !hasOtherScript && pureHanLines < 2 && substantiveLatinLines < 2
	case "ko":
		return hasHang && !hasKana && !hasOtherScript && pureHanLines < 2 && substantiveLatinLines < 2
	case "en":
		if hasHan || hasKana || hasHang || hasOtherScript {
			return false
		}
		return detectLyricTextLang(substantive, "") == "en"
	default:
		return false
	}
}

// isNonLyricCueLine 判断是否为段落标记、纯伴奏/器乐提示或纯演职员信息
func isNonLyricCueLine(text string) bool {
	trimmed := strings.TrimSpace(text)
	norm := normalizeLyricMatch(trimmed)
	if norm == "" || lyricInstrumentalRe.MatchString(trimmed) || isLyricCreditText(trimmed) {
		return true
	}
	if lyricSectionWords[norm] {
		return true
	}
	if lyricSectionTagRe.MatchString(trimmed) {
		// 如 [Verse 1]、[Chorus]、[Bridge]、[Guitar Solo]、【间奏】
		clean := strings.TrimRight(norm, "0123456789")
		if lyricSectionWords[clean] || clean == "bg" {
			return true
		}
		for kw := range lyricSectionWords {
			if len(kw) >= 2 && strings.Contains(clean, kw) {
				return true
			}
		}
	}
	return false
}

// cutLeadingColon 在前 maxRunes 个字符内查找首个冒号并切分前缀与正文
func cutLeadingColon(text string, maxRunes int) (prefix, rest string, ok bool) {
	runes := []rune(text)
	limit := min(len(runes), maxRunes)
	for i := 0; i < limit; i++ {
		if runes[i] == ':' || runes[i] == '：' {
			return strings.TrimSpace(string(runes[:i])), strings.TrimSpace(string(runes[i+1:])), true
		}
	}
	return "", "", false
}

// isSingerCuePrefix 判断冒号前的前缀是否为歌手名称、合唱角色标签或单字母代号
func isSingerCuePrefix(prefix string, artists []string) bool {
	clean := strings.TrimSpace(lyricParensCleanupRe.ReplaceAllString(prefix, ""))
	if clean == "" {
		return false
	}
	// 单个大写字母标签 A: / B:
	if len([]rune(clean)) == 1 {
		r, _ := utf8.DecodeRuneInString(clean)
		if r >= 'A' && r <= 'F' {
			return true
		}
	}
	artistTokens := collectArtistMatchTokens(artists)
	parts := lyricArtistSplitRe.Split(clean, -1)
	if len(parts) == 0 {
		return false
	}
	matchedAll := true
	matchedAny := false
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		norm := normalizeLyricMatch(part)
		if norm == "" {
			continue
		}
		if lyricSingerCueRoles[norm] || lyricSingerCueRoles[strings.ToLower(part)] || slices.Contains(artistTokens, norm) {
			matchedAny = true
		} else {
			matchedAll = false
		}
	}
	return matchedAny && matchedAll
}

func collectArtistMatchTokens(artists []string) []string {
	var tokens []string
	add := func(s string) {
		norm := normalizeLyricMatch(s)
		if norm != "" && !slices.Contains(tokens, norm) {
			tokens = append(tokens, norm)
		}
	}
	for _, artist := range artists {
		add(artist)
		// 拆分 "可莉 (花玲)" 或 "A / B"，同时提取括号内的配音/别名
		for _, sub := range lyricArtistSplitRe.Split(artist, -1) {
			trimmed := strings.TrimSpace(sub)
			add(trimmed)
			if bare := strings.TrimSpace(lyricParensCleanupRe.ReplaceAllString(trimmed, "")); bare != "" && utf8.RuneCountInString(normalizeLyricMatch(bare)) >= 2 {
				add(bare)
			}
			for _, m := range lyricParensInnerRe.FindAllStringSubmatch(trimmed, -1) {
				inner := m[1]
				if inner == "" {
					inner = m[2]
				}
				for _, innerPart := range lyricArtistSplitRe.Split(inner, -1) {
					if p := strings.TrimSpace(innerPart); p != "" && utf8.RuneCountInString(normalizeLyricMatch(p)) >= 2 {
						add(p)
					}
				}
			}
		}
	}
	return tokens
}

// classifyLyricVocalLine 过滤非唱词行并剥离行首歌手提示前缀（如 "李荣浩："、"女："）；
// 返回应送入模型的纯唱词文本与是否整行跳过
func classifyLyricVocalLine(text string, artists []string) (vocalText string, skip bool) {
	trimmed := strings.TrimSpace(text)
	if isNonLyricCueLine(trimmed) {
		return "", true
	}
	if prefix, rest, ok := cutLeadingColon(trimmed, 24); ok {
		// 单独的冒号结尾提示行（如 "李荣浩："、"女："、"合唱："）一律不翻译
		if rest == "" && utf8.RuneCountInString(prefix) <= 16 {
			return "", true
		}
		// 已知歌手名或合唱角色提示前缀：剥掉前缀只保留后面唱词
		if isSingerCuePrefix(prefix, artists) {
			if isNonLyricCueLine(rest) {
				return "", true
			}
			return rest, false
		}
	}
	return trimmed, false
}

// stripLeakedCuePrefix 模型偶发在译文开头带上冒号前歌手提示时剥离掉，避免译文出现 "李荣浩：" 等非唱词文字
func stripLeakedCuePrefix(origRaw, vocalText, translation string, artists []string) string {
	tr := strings.TrimSpace(translation)
	if tr == "" {
		return ""
	}
	origPrefix, _, hasOrigColon := cutLeadingColon(strings.TrimSpace(origRaw), 24)
	if !hasOrigColon {
		return tr
	}
	stripped := strings.TrimSpace(origRaw) != strings.TrimSpace(vocalText)
	if trPrefix, trRest, hasTrColon := cutLeadingColon(tr, 24); hasTrColon {
		if stripped || strings.EqualFold(normalizeLyricMatch(origPrefix), normalizeLyricMatch(trPrefix)) || isSingerCuePrefix(trPrefix, artists) {
			return trRest
		}
	}
	return tr
}

var (
	classicalModernColloquialWords = []string{
		"的", "吗", "嗎", "呢", "吧", "啦", "呀", "哇", "哦", "噢", "嘛", "呗", "唄", "哈", "嗨", "喂",
		"我们", "我們", "你们", "你們", "他们", "他們", "她们", "她們", "它们", "它們", "咱们", "咱們",
		"什么", "什麼", "怎么", "怎麼", "怎样", "怎樣", "为什么", "為什麼", "因为", "因為", "所以",
		"如果", "虽然", "雖然", "但是", "可是", "而且", "已经", "已經", "正在", "曾经", "曾經",
		"喜欢", "喜歡", "觉得", "覺得", "感觉", "感覺", "知道", "明白", "没有", "沒有", "不是",
		"不会", "不會", "不能", "不要", "不用", "可以", "应该", "應該", "需要", "希望",
		"突然", "终于", "終於", "一直", "一起", "自己", "现在", "現在", "今天", "明天", "昨天",
		"这里", "這裏", "這裡", "那里", "那裏", "哪裡", "哪里", "这么", "這麼", "那么", "那麼",
		"这儿", "這兒", "那儿", "那兒",
		"了我", "了你", "了他", "了她", "了它", "了这", "了這", "了那", "好了", "算了", "走了", "忘了", "懂了", "哭了", "笑了",
		"嘅", "咗", "喺", "冇", "係", "唔", "啲", "嚟", "咁", "乜", "咩", "仲", "畀", "揾", "搵", "睇", "佢", "哋",
	}
	classicalModernCompoundsReplacer = strings.NewReplacer(
		"之后", " ", "之後", " ", "之前", " ", "之间", " ", "之間", " ", "之中", " ", "之上", " ", "之下", " ", "之外", " ", "之内", " ", "之內", " ",
		"之际", " ", "之際", " ", "之旅", " ", "之路", " ", "之歌", " ", "之声", " ", "之聲", " ", "之城", " ", "之光", " ", "之恋", " ", "之戀", " ",
		"之夜", " ", "之约", " ", "之約", " ", "之一", " ", "之二", " ", "之类", " ", "之類", " ",
		"在乎", " ", "几乎", " ", "幾乎", " ", "似乎", " ", "关乎", " ", "關乎", " ", "合乎", " ", "超乎", " ", "出乎", " ", "不亦乐乎", " ", "不亦樂乎", " ",
		"或者", " ", "作者", " ", "读者", " ", "讀者", " ", "记者", " ", "記者", " ", "歌者", " ", "舞者", " ", "勇者", " ", "智者", " ",
		"患者", " ", "使者", " ", "学者", " ", "學者", " ", "长者", " ", "長者", " ", "行者", " ",
		"也许", " ", "也許", " ", "也罢", " ", "也罷", " ", "也好", " ", "也是", " ", "也有", " ", "也没", " ", "也沒", " ", "也不", " ", "也想", " ", "也会", " ", "也會", " ",
		"其实", " ", "其實", " ", "其他", " ", "其它", " ", "其中", " ", "其余", " ", "其餘", " ", "其次", " ", "极其", " ", "極其", " ", "尤其", " ",
		"顺其自然", " ", "順其自然", " ", "莫名其妙", " ", "突如其来", " ", "突如其來", " ", "总而言之", " ", "總而言之", " ",
		"换言之", " ", "換言之", " ", "久而久之", " ", "尔后", " ", "爾後", " ", "偶尔", " ", "偶爾", " ", "莞尔", " ", "莞爾", " ", "乃至", " ", "乃是", " ",
	)
	classicalStrongRunes   = runeSetFromString("兮矣焉哉欤歟乎吾汝岂豈毋孰曷盍叵")
	classicalStrongPhrases = []string{
		"奈何", "安得", "安能", "焉能", "岂曰", "豈曰", "与子", "與子", "莫道", "休道", "休言",
		"忽闻", "忽聞", "惟见", "惟見", "唯见", "唯見", "犹抱", "猶抱", "知否", "应是", "應是",
		"何事", "何必", "何似", "何须", "何須", "与君", "與君", "为君", "為君", "思君",
		"问君", "問君", "劝君", "勸君", "君不见", "君不見", "归去来", "歸去來", "嗟乎", "呜呼", "嗚呼", "哀哉",
		"谓之", "謂之", "之谓", "之謂", "之所", "无乃", "無乃", "孰能", "何尝", "何嘗", "岂料", "豈料",
		"犹记", "猶記", "曾记", "曾記", "试问", "試問", "借问", "借問", "却道", "卻道", "恰似", "宛若",
		"沦落人", "淪落人", "相逢何必", "曾相识", "曾相識",
	}
	classicalZhiPhrases = []string{
		"谓之", "謂之", "求之", "失之", "得之", "听之", "聽之", "取之", "用之", "与之", "與之",
		"为之", "為之", "视之", "視之", "观之", "觀之", "言之", "呼之", "往之", "之乎", "之者",
		"之所以", "之谓", "之謂", "何之",
	}
	classicalModernPronouns = runeSetFromString("我你他她它这這那")
	classicalClauseSplitRe  = regexp.MustCompile(`[，,。；;！!？?、\s]+`)
)

func hasModernColloquialMarker(text string) bool {
	for _, w := range classicalModernColloquialWords {
		if strings.Contains(text, w) {
			return true
		}
	}
	return false
}

func isClassicalChineseLine(line string) (strongMarker bool, strictMeter bool, modern bool, pureHanLine bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false, false, false, false
	}
	stats, _ := countLyricScripts([]string{trimmed})
	if stats.han < 4 || stats.kana > 0 || stats.hang > 0 || stats.latin > 0 || stats.other > 0 {
		return false, false, false, false
	}
	pureHanLine = true
	if hasModernColloquialMarker(trimmed) {
		return false, false, true, true
	}

	masked := classicalModernCompoundsReplacer.Replace(trimmed)
	for _, r := range masked {
		if classicalStrongRunes[r] {
			strongMarker = true
			break
		}
	}
	if !strongMarker {
		for _, phrase := range classicalStrongPhrases {
			if strings.Contains(masked, phrase) {
				strongMarker = true
				break
			}
		}
	}
	if !strongMarker && strings.ContainsRune(masked, '之') {
		for _, phrase := range classicalZhiPhrases {
			if strings.Contains(masked, phrase) {
				strongMarker = true
				break
			}
		}
	}

	hasModernPronoun := false
	for _, r := range trimmed {
		if classicalModernPronouns[r] {
			hasModernPronoun = true
			break
		}
	}
	if !hasModernPronoun {
		rawClauses := classicalClauseSplitRe.Split(trimmed, -1)
		clauses := make([]string, 0, len(rawClauses))
		for _, c := range rawClauses {
			if c != "" {
				clauses = append(clauses, c)
			}
		}
		if len(clauses) >= 1 && len(clauses) <= 4 {
			allMatch := true
			for _, c := range clauses {
				n := utf8.RuneCountInString(c)
				if n != 5 && n != 7 {
					allMatch = false
					break
				}
				for _, r := range c {
					if !unicode.In(r, unicode.Han) {
						allMatch = false
						break
					}
				}
				if !allMatch {
					break
				}
			}
			strictMeter = allMatch
		}
	}
	return strongMarker, strictMeter, false, true
}

// songHasClassicalChinese 判断中文歌曲是否包含古文/文言文句子（含全曲古诗词与夹杂文言句的古风歌曲）
func songHasClassicalChinese(lines []string) bool {
	hanLineCount := 0
	strongCount := 0
	strictMeterCount := 0
	modernLineCount := 0
	for _, line := range lines {
		strong, strictMeter, modern, pureHan := isClassicalChineseLine(line)
		if !pureHan {
			continue
		}
		hanLineCount++
		if modern {
			modernLineCount++
			continue
		}
		if strong {
			strongCount++
		}
		if strictMeter {
			strictMeterCount++
		}
	}
	if hanLineCount == 0 {
		return false
	}
	if strongCount >= 1 {
		return true
	}
	return strictMeterCount >= 4 && strictMeterCount*100 >= hanLineCount*30 && modernLineCount*100 < hanLineCount*25
}

// classifyLyricTranslationLine 判定歌词翻译任务行：跳过空行、占位行、纯器乐与独立歌手空标签；
// 署名/演职员提示行（如 "词作者：XXX"）保留并标为 isHint，由模型在有确定译法时翻译。
func classifyLyricTranslationLine(text string, artists []string) (vocalText string, skip bool, isHint bool) {
	trimmed := strings.TrimSpace(text)
	norm := normalizeLyricMatch(trimmed)
	if norm == "" || lyricInstrumentalRe.MatchString(trimmed) {
		return "", true, false
	}
	if isLyricCreditText(trimmed) {
		return trimmed, false, true
	}
	if isNonLyricCueLine(trimmed) {
		return "", true, false
	}
	if prefix, rest, ok := cutLeadingColon(trimmed, 24); ok {
		if rest == "" && utf8.RuneCountInString(prefix) <= 16 {
			return "", true, false
		}
		if isSingerCuePrefix(prefix, artists) {
			if isLyricCreditText(rest) {
				return rest, false, true
			}
			if isNonLyricCueLine(rest) {
				return "", true, false
			}
			return rest, false, false
		}
	}
	return trimmed, false, false
}

// containsChineseGrammaticalChar 识别典型的现代中文独有虚词/语法字（不含日语常规汉字用法），防止日韩译文误输出短中文句
func containsChineseGrammaticalChar(text string) bool {
	for _, r := range text {
		switch r {
		case '的', '了', '吗', '呢', '吧', '呀', '么', '这', '那', '们', '没', '让', '把', '给', '对', '说', '个':
			return true
		}
	}
	return false
}

// isValidTargetScriptTranslation 校验模型产出的单行译文是否违背目标语言脚本（例如目标 ja 却输出纯中文句）
func isValidTargetScriptTranslation(orig, trans, targetLang string) bool {
	if trans == "" {
		return true
	}
	origStats, _ := countLyricScripts([]string{orig})
	trStats, _ := countLyricScripts([]string{trans})
	if trStats.han+trStats.kana+trStats.hang+trStats.latin+trStats.other == 0 {
		return false
	}
	switch targetLang {
	case "ja":
		if trStats.hang > 0 && origStats.hang == 0 {
			return false
		}
		if trStats.kana == 0 && trStats.han >= 4 {
			return false
		}
		if trStats.kana == 0 && trStats.han >= 2 && (trStats.simp > 0 || containsChineseGrammaticalChar(trans)) {
			return false
		}
		return true
	case "ko":
		return !(trStats.han > 0 && trStats.hang == 0)
	case "en":
		if (trStats.han+trStats.kana+trStats.hang) > 0 && trStats.latin == 0 {
			return false
		}
		if (trStats.han > 0 && origStats.han == 0) || (trStats.kana > 0 && origStats.kana == 0) || (trStats.hang > 0 && origStats.hang == 0) {
			return false
		}
		return true
	case "zh", "zh-tw", "zh-hk":
		if trStats.han == 0 && ((trStats.kana > 0 && origStats.kana == 0) || (trStats.hang > 0 && origStats.hang == 0)) {
			return false
		}
		return true
	default:
		return true
	}
}
