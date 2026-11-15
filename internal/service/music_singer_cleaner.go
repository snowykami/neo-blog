package service

import (
	"html"
	"regexp"
	"sort"
	"strings"
	"unicode"

	nethtml "golang.org/x/net/html"
)

const (
	vocalCleanMinSingers = 2
	vocalCleanMinTags    = 2
	vocalCleanMinRunes   = 40
)

// vocalCharacterMap 常见 ACG / Vocaloid / 企划角色缩写到统一角色名的映射表（键均为小写去空白/下划线格式）
var vocalCharacterMap = map[string]string{
	// Virtual Singers (Crypton / SynthV / CeVIO / UTAU)
	"miku":          "初音未来",
	"hatsune miku":  "初音未来",
	"初音ミク":          "初音未来",
	"初音未来":          "初音未来",
	"rin":           "镜音铃",
	"kagamine rin":  "镜音铃",
	"鏡音リン":          "镜音铃",
	"镜音铃":           "镜音铃",
	"len":           "镜音连",
	"kagamine len":  "镜音连",
	"鏡音レン":          "镜音连",
	"镜音连":           "镜音连",
	"luka":          "巡音流歌",
	"megurine luka": "巡音流歌",
	"巡音ルカ":          "巡音流歌",
	"巡音流歌":          "巡音流歌",
	"meiko":         "MEIKO",
	"kaito":         "KAITO",
	"gumi":          "GUMI",
	"megpoid":       "GUMI",
	"ia":            "IA",
	"teto":          "重音Teto",
	"kasane teto":   "重音Teto",
	"重音テト":          "重音Teto",
	"flower":        "flower",
	"vflower":       "flower",
	"v flower":      "flower",
	"kafu":          "可不",
	"可不":            "可不",
	"gakupo":        "神威乐步",
	"kamui gakupo":  "神威乐步",
	"神威がくぽ":         "神威乐步",
	"yuzuki yukari": "结月缘",
	"yukari":        "结月缘",
	"結月ゆかり":         "结月缘",
	"luo tianyi":    "洛天依",
	"洛天依":           "洛天依",
	"yanhe":         "言和",
	"言和":            "言和",
	"yuezheng ling": "乐正绫",
	"乐正绫":           "乐正绫",

	// Project SEKAI — Leo/need
	"ichika":           "星乃一歌",
	"hoshino ichika":   "星乃一歌",
	"星乃一歌":             "星乃一歌",
	"saki":             "天马咲希",
	"tenma saki":       "天马咲希",
	"天馬咲希":             "天马咲希",
	"天马咲希":             "天马咲希",
	"honami":           "望月穗波",
	"mochizuki honami": "望月穗波",
	"望月穂波":             "望月穗波",
	"望月穗波":             "望月穗波",
	"shiho":            "日野森志步",
	"hinomori shiho":   "日野森志步",
	"日野森志歩":            "日野森志步",
	"日野森志步":            "日野森志步",

	// Project SEKAI — MORE MORE JUMP!
	"minori":           "花里实乃里",
	"hanasato minori":  "花里实乃里",
	"花里みのり":            "花里实乃里",
	"花里实乃里":            "花里实乃里",
	"haruka":           "桐谷遥",
	"kiritani haruka":  "桐谷遥",
	"桐谷遥":              "桐谷遥",
	"airi":             "桃井爱莉",
	"momoi airi":       "桃井爱莉",
	"桃井愛莉":             "桃井爱莉",
	"桃井爱莉":             "桃井爱莉",
	"shizuku":          "日野森雫",
	"hinomori shizuku": "日野森雫",
	"日野森雫":             "日野森雫",

	// Project SEKAI — Vivid BAD SQUAD
	"kohane":          "小豆泽心羽",
	"azusawa kohane":  "小豆泽心羽",
	"小豆沢こはね":          "小豆泽心羽",
	"小豆泽心羽":           "小豆泽心羽",
	"an":              "白石杏",
	"shiraishi an":    "白石杏",
	"白石杏":             "白石杏",
	"akito":           "东云彰人",
	"shinonome akito": "东云彰人",
	"東雲彰人":            "东云彰人",
	"东云彰人":            "东云彰人",
	"toya":            "青柳冬弥",
	"aoyagi toya":     "青柳冬弥",
	"青柳冬弥":            "青柳冬弥",

	// Project SEKAI — Wonderlands x Showtime
	"tsukasa":       "天马司",
	"tenma tsukasa": "天马司",
	"天馬司":           "天马司",
	"天马司":           "天马司",
	"emu":           "凤笑梦",
	"otori emu":     "凤笑梦",
	"鳳えむ":           "凤笑梦",
	"凤笑梦":           "凤笑梦",
	"nene":          "草薙宁宁",
	"kusanagi nene": "草薙宁宁",
	"草薙寧々":          "草薙宁宁",
	"草薙宁宁":          "草薙宁宁",
	"rui":           "神代类",
	"kamishiro rui": "神代类",
	"神代類":           "神代类",
	"神代类":           "神代类",

	// Project SEKAI — 25-ji, Nightcord de.
	"kanade":         "宵崎奏",
	"yoisaki kanade": "宵崎奏",
	"宵崎奏":            "宵崎奏",
	"mafuyu":         "朝比奈真冬",
	"asahina mafuyu": "朝比奈真冬",
	"朝比奈まふゆ":         "朝比奈真冬",
	"朝比奈真冬":          "朝比奈真冬",
	"ena":            "东云绘名",
	"shinonome ena":  "东云绘名",
	"東雲絵名":           "东云绘名",
	"东云绘名":           "东云绘名",
	"mizuki":         "晓山瑞希",
	"akiyama mizuki": "晓山瑞希",
	"暁山瑞希":           "晓山瑞希",
	"晓山瑞希":           "晓山瑞希",

	// 少女歌剧 Revue Starlight
	"karen":            "爱城华恋",
	"aijo karen":       "爱城华恋",
	"愛城華恋":             "爱城华恋",
	"hikari":           "神乐光",
	"kagura hikari":    "神乐光",
	"神楽ひかり":            "神乐光",
	"mahiru":           "露崎真昼",
	"tsuyuzaki mahiru": "露崎真昼",
	"露崎まひる":            "露崎真昼",
	"maya":             "天堂真矢",
	"tendo maya":       "天堂真矢",
	"天堂真矢":             "天堂真矢",
	"claudine":         "西条克洛迪娜",
	"saijo claudine":   "西条克洛迪娜",
	"西條クロディーヌ":         "西条克洛迪娜",
	"nana":             "大场奈奈",
	"daiba nana":       "大场奈奈",
	"大場なな":             "大场奈奈",
	"junna":            "星见纯那",
	"hoshimi junna":    "星见纯那",
	"星見純那":             "星见纯那",
	"futaba":           "石动双叶",
	"isurugi futaba":   "石动双叶",
	"石動双葉":             "石动双叶",
	"kaoruko":          "花柳香子",
	"hanayagi kaoruko": "花柳香子",
	"花柳香子":             "花柳香子",

	// BanG Dream!
	"kasumi":           "户山香澄",
	"toyama kasumi":    "户山香澄",
	"tae":              "花园多惠",
	"hanazono tae":     "花园多惠",
	"rimi":             "牛込里美",
	"ushigome rimi":    "牛込里美",
	"saaya":            "山吹沙绫",
	"saya":             "山吹沙绫",
	"yamabuki saaya":   "山吹沙绫",
	"arisa":            "市谷有咲",
	"ichigaya arisa":   "市谷有咲",
	"yukina":           "凑友希那",
	"minato yukina":    "凑友希那",
	"sayo":             "冰川纱夜",
	"hikawa sayo":      "冰川纱夜",
	"lisa":             "今井莉莎",
	"imai lisa":        "今井莉莎",
	"ako":              "宇田川亚子",
	"udagawa ako":      "宇田川亚子",
	"rinko":            "白金燐子",
	"shirokane rinko":  "白金燐子",
	"ran":              "美竹兰",
	"mitake ran":       "美竹兰",
	"moca":             "青叶摩卡",
	"himari":           "上原绯玛丽",
	"tomoe":            "宇田川巴",
	"tsugumi":          "羽泽鸫",
	"aya":              "丸山彩",
	"hina":             "冰川日菜",
	"chisato":          "白鹭千圣",
	"maya_bandori":     "大和麻弥",
	"eve":              "若宫伊芙",
	"kokoro":           "弦卷心",
	"kaoru":            "濑田薰",
	"hagumi":           "北泽育美",
	"kanon_bandori":    "松原花音",
	"misaki":           "奥泽美咲",
	"mashiro":          "仓田真白",
	"touko":            "桐谷透子",
	"nanami":           "广町七深",
	"tsukushi":         "二叶筑紫",
	"rui_bandori":      "八潮瑠唯",
	"layer":            "LAYER",
	"lock":             "LOCK",
	"masking":          "MASKING",
	"pareo":            "PAREO",
	"chu2":             "CHU²",
	"tomori":           "高松灯",
	"takamatsu tomori": "高松灯",
	"anon":             "千早爱音",
	"chihaya anon":     "千早爱音",
	"rana":             "要乐奈",
	"raana":            "要乐奈",
	"kaname rana":      "要乐奈",
	"soyo":             "长崎爽世",
	"nagasaki soyo":    "长崎爽世",
	"taki":             "椎名立希",
	"shiina taki":      "椎名立希",
	"uika":             "三角初华",
	"misumi uika":      "三角初华",
	"mutsumi":          "若叶睦",
	"wakaba mutsumi":   "若叶睦",
	"umiri":            "八幡海铃",
	"yahata umiri":     "八幡海铃",
	"nyamu":            "祐天寺若麦",
	"yutenji nyamu":    "祐天寺若麦",
	"sakiko":           "丰川祥子",
	"togawa sakiko":    "丰川祥子",

	// Love Live!
	"honoka":         "高坂穗乃果",
	"eli":            "绚濑绘里",
	"kotori":         "南小鸟",
	"umi":            "园田海未",
	"nozomi":         "东条希",
	"hanayo":         "小泉花阳",
	"nico":           "矢泽妮可",
	"maki":           "西木野真姬",
	"chika":          "高海千歌",
	"riko":           "樱内梨子",
	"kanan":          "松浦果南",
	"dia":            "黑泽黛雅",
	"you":            "渡边曜",
	"yoshiko":        "津岛善子",
	"yohane":         "津岛善子",
	"hanamaru":       "国木田花丸",
	"mari":           "小原鞠莉",
	"ruby":           "黑泽露比",
	"ayumu":          "上原步梦",
	"kasumi_niji":    "中须霞",
	"shizuku_niji":   "樱坂雫",
	"karin":          "朝香果林",
	"ai":             "宫下爱",
	"kanata":         "近江彼方",
	"setsuna":        "优木雪菜",
	"emma":           "艾玛·维尔德",
	"rina":           "天王寺璃奈",
	"shioriko":       "三船栞子",
	"lanzhu":         "钟岚珠",
	"mia":            "米娅·泰勒",
	"kanon":          "涩谷香音",
	"keke":           "唐可可",
	"chisato_liella": "岚千砂都",
	"sumire":         "平安名堇",
	"ren":            "叶月恋",
	"kinako":         "樱小路希奈子",
	"mei":            "米女芽衣",
	"shiki":          "若菜四季",
	"natsumi":        "鬼冢夏美",
	"margarete":      "维恩·玛格丽特",
	"tomari":         "鬼冢冬毬",

	// 孤独摇滚 / K-ON!
	"hitori":           "后藤一里",
	"bocchi":           "后藤一里",
	"gotoh hitori":     "后藤一里",
	"nijika":           "伊地知虹夏",
	"ijichi nijika":    "伊地知虹夏",
	"ryo":              "山田凉",
	"yamada ryo":       "山田凉",
	"ikuyo":            "喜多郁代",
	"kita":             "喜多郁代",
	"kita ikuyo":       "喜多郁代",
	"yui":              "平泽唯",
	"hirasawa yui":     "平泽唯",
	"mio":              "秋山澪",
	"akiyama mio":      "秋山澪",
	"ritsu":            "田井中律",
	"tainaka ritsu":    "田井中律",
	"mugi":             "琴吹䌷",
	"tsumugi":          "琴吹䌷",
	"kotobuki tsumugi": "琴吹䌷",
	"azusa":            "中野梓",
	"nakano azusa":     "中野梓",

	// 请问您今天要来点兔子吗？(Gochiusa)
	"chino":          "香风智乃",
	"kafu chino":     "香风智乃",
	"香風智乃":           "香风智乃",
	"条河麻耶":           "条河麻耶",
	"jouga maya":     "条河麻耶",
	"megu":           "奈津惠",
	"natsu megumi":   "奈津惠",
	"奈津恵":            "奈津惠",
	"cocoa":          "保登心爱",
	"hoto cocoa":     "保登心爱",
	"保登心愛":           "保登心爱",
	"rize":           "天天座理世",
	"tedeza rize":    "天天座理世",
	"天々座理世":          "天天座理世",
	"chiya":          "宇治松千夜",
	"ujimatsu chiya": "宇治松千夜",
	"宇治松千夜":          "宇治松千夜",
	"syaro":          "桐间纱路",
	"sharo":          "桐间纱路",
	"kirima syaro":   "桐间纱路",
	"桐間紗路":           "桐间纱路",

	// 合唱 / 全员通用标记
	"all":         "合唱",
	"all members": "合唱",
	"everyone":    "合唱",
	"shared":      "合唱",
	"group":       "合唱",
	"chorus":      "合唱",
	"together":    "合唱",
	"full":        "合唱",
	"合":           "合唱",
	"合唱":          "合唱",
	"全员":          "合唱",
	"全員":          "合唱",
	"齐唱":          "合唱",
}

// nonRoleKeywords MediaWiki 模板名/结构标签/制作人员字段等黑名单（小写比较）
var nonRoleKeywords = map[string]bool{
	"poem": true, "copylyrics": true, "lyrics": true, "lyricstab": true,
	"lyrics line": true, "lyric": true, "ruby": true, "photrans": true, "rb": true,
	"rt": true, "rp": true, "lang": true, "ja": true, "jp": true, "en": true, "zh": true,
	"romaji": true, "rōmaji": true, "kanji": true, "kan": true, "english": true,
	"japanese": true, "chinese": true, "translation": true, "note": true, "notes": true,
	"ref": true, "clear": true, "br": true, "color": true, "colore": true,
	"fontcolor": true, "coloredtext": true, "span": true, "div": true, "music": true,
	"song": true, "infobox": true, "listen": true, "cite": true, "small": true, "big": true,
	"center": true, "left": true, "right": true, "sub": true, "sup": true, "nowiki": true,
	"unicode": true, "efn": true, "sfn": true, "abbr": true, "tip": true, "ttml": true,
	"header": true, "footer": true, "navbox": true, "tracklist": true, "discography": true,
	"external": true, "citation": true, "ver": true, "version": true, "short": true,
	"game": true, "sekai": true, "virtual singer": true, "vocaloid": true, "official": true,
	"shared": false, "solo": true, "instrumental": true, "interlude": true, "break": true,
	"intro": true, "outro": true, "verse": true, "pre-chorus": true, "post-chorus": true,
	"bridge": true, "hook": true, "refrain": true, "ad-lib": true, "adlib": true,
	"spoken": true, "guitar solo": true, "piano solo": true, "drum solo": true,
	"main": true, "mainonly": true, "anchor": true, "nihongo": true, "w": true, "wp": true,
	"tl": true, "tab": true, "tabs": true, "gallery": true, "trivia": true, "references": true,
	"uncredited": true, "unknown": true, "n/a": true, "none": true, "tbd": true, "未匹配": true,
	"作词": true, "作詞": true, "作曲": true, "编曲": true, "編曲": true, "制作人": true,
	"製作人": true, "混音": true, "母带": true, "母帶": true, "和声": true, "和聲": true,
	"演唱": true, "歌": true, "词": true, "曲": true, "编": true,
	"lyricist": true, "lyrics by": true, "composer": true, "composed by": true,
	"arranger": true, "arranged by": true, "producer": true, "arrangement": true,
	"vocal": true, "vocals": true, "music by": true, "guitar": true, "bass": true, "drums": true,
	"mix": true, "mixing": true, "mastering": true, "illustrator": true, "movie": true,
	"pv": true, "mv": true, "illust": true, "tuning": true,
	"tl;dr": true, "!": true, "=": true, "-": true, "—": true,
	"black": true, "white": true, "transparent": true, "inherit": true, "auto": true,
	"red": true, "blue": true, "green": true, "yellow": true, "grey": true, "gray": true,
	"scroll box": true, "scrollbox": true, "collapse": true, "collapsed": true, "hidden": true, "quote": true, "cquote": true,
}

var (
	reCleanZeroWidth         = regexp.MustCompile(`[\x{200B}-\x{200F}\x{FEFF}\r]`)
	reCleanSectionLyrics     = regexp.MustCompile(`(?im)^==\s*(?:lyrics|歌詞|歌词|song\s+lyrics)\s*==`)
	reCleanSectionNext       = regexp.MustCompile(`(?m)^==[^=].*?==\s*$`)
	reCleanWikiComment       = regexp.MustCompile(`(?s)<!--.*?-->`)
	reCleanWikiRef           = regexp.MustCompile(`(?is)<ref[^>]*>.*?</ref>|<ref[^/>]*/>`)
	reCleanWikiLink          = regexp.MustCompile(`\[\[(?:[^|\]]*\|)?([^\]]+)\]\]`)
	reCleanExtLink           = regexp.MustCompile(`\[https?://[^\s\]]+(?:\s+([^\]]+))?\]`)
	reCleanPJSKUnitSuffix    = regexp.MustCompile(`(?i)[\s_\-]*(?:ln|mmj|vbs|wxs|ws|25ji|n25|niigo|25|vs|v2|sekai|unit|alt)$`)
	reCleanCreditLine        = regexp.MustCompile(`(?im)^[\s\x{3000}]*(?:作[词詞]|作曲|[编編]曲|製作人|制作人|混音|演唱|歌|lyrics|composer|composed|arranged|arranger|music|vocal|vocals|tuning|illust|movie|mv|pv)[\s\x{3000}]*[:：]`)
	reCleanBracketSection    = regexp.MustCompile(`(?i)^(?:intro|verse|pre-?chorus|post-?chorus|chorus|bridge|outro|hook|refrain|interlude|instrumental|break|solo|coda|ad-?lib|main|主歌|副歌|前奏|间奏|尾奏|桥段|过渡)\s*(?:\d+|[ivx]+|[a-d])?\s*[:：\-–—]\s*(.+)$`)
	reCleanBracketOnlySec    = regexp.MustCompile(`(?i)^(?:intro|verse|pre-?chorus|post-?chorus|chorus|bridge|outro|hook|refrain|interlude|instrumental|break|solo|coda|ad-?lib|spoken|guitar\s+solo|piano\s+solo|主歌|副歌|前奏|间奏|尾奏|桥段|过渡|间奏曲)(?:\s*(?:\d+|[ivx]+|[a-d]))?$`)
	reCleanMultiSep          = regexp.MustCompile(`\s*(?:&|＆|/|,|、|\+|×|\band\b)\s*`)
	reCleanColorStyle        = regexp.MustCompile(`(?i)(?:^|[;"'\s])(?:color|background-color)\s*:\s*(#[0-9a-f]{3,8}|[a-z]+)`)
	reCleanFontColor         = regexp.MustCompile(`(?is)<font[^>]*color=["']?(#[0-9a-f]{3,8}|[a-z]+)["']?[^>]*>(.*?)</font>`)
	reCleanHexOnly           = regexp.MustCompile(`^#[0-9a-fA-F]{3,8}$`)
	reCleanSpaceCollapse     = regexp.MustCompile(`[ \t\x{3000}]{2,}`)
	reCleanNewlineCollapse   = regexp.MustCompile(`\n{3,}`)
	reCleanLineTimestamp     = regexp.MustCompile(`\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]`)
	reCleanMetaTag           = regexp.MustCompile(`(?i)^\[(ti|ar|al|by|offset|re|ve|length|id|hash|sign|total|ly|au|trans):.*\]$`)
	reCleanHeaderBracketLine = regexp.MustCompile(`^[\s\x{3000}]*(?:【([^】]{1,50})】|\[([^\]]{1,50})\])[\s\x{3000}]*(.*)$`)
	reCleanHeaderColonLine   = regexp.MustCompile(`^\s*([\p{L}\p{N}・·._\-\s&＆/、+×]{1,36}?)\s*[:：]\s*(.+)$`)
	reCleanNormalizedBlock   = regexp.MustCompile(`^\[([^\[\]\n]{1,60})\]:$`)
)

// cleanAndVerifyCandidate 按候选来源格式清洗原始文本，执行零幻觉硬门槛（>=2角色、>=2次切分、>=40字符、同语种歌词重叠校验），并回填元数据
func cleanAndVerifyCandidate(c *VocalEvidenceCandidate, q *VocalSearchQuery) bool {
	if c == nil {
		return false
	}
	raw := strings.TrimSpace(c.RawContent)
	if raw == "" && c.Format != VocalEvidenceFormatNormalized {
		return false
	}

	var cleaned string
	switch c.Format {
	case VocalEvidenceFormatNormalized:
		cleaned = mergeConsecutiveVocalBlocks(strings.TrimSpace(c.CleanContent))
		if cleaned == "" {
			cleaned = mergeConsecutiveVocalBlocks(raw)
		}
	case VocalEvidenceFormatWikitext:
		cleaned = cleanMediaWikiVocalEvidence(raw, q)
	case VocalEvidenceFormatMoegirlHTML:
		cleaned = cleanMoegirlHTMLVocalEvidence(raw, q)
	case VocalEvidenceFormatBrackets:
		cleaned, _, _ = cleanBracketVocalEvidence(raw)
	case VocalEvidenceFormatHTML:
		cleaned = cleanHTMLVocalEvidence(raw, q)
	default:
		cleaned, _, _ = cleanBracketVocalEvidence(raw)
	}

	cleaned = mergeConsecutiveVocalBlocks(cleaned)
	// PJSK 翻唱串台拦截：原曲仅含虚拟歌手（不含 SEKAI 组合名或人类角色）时，拒绝 PJSK 站点中含有 20 名 SEKAI 人类角色的翻唱声部（例如おこちゃま戦争误匹配草薙宁宁翻唱版）
	if q != nil && q.PrefersVirtualSinger && (strings.Contains(c.ProviderID, "projectsekai") || strings.Contains(c.ProviderID, "sekaipedia")) {
		if containsPJSKHumanCharacter(cleaned) {
			return false
		}
	}
	singers, tags, lyricLines := inspectNormalizedVocalBlocks(cleaned)
	if singers < vocalCleanMinSingers || tags < vocalCleanMinTags {
		return false
	}

	lyricRuneLen := 0
	for _, line := range lyricLines {
		lyricRuneLen += len([]rune(line))
	}
	if lyricRuneLen < vocalCleanMinRunes {
		return false
	}

	overlap := computeVocalLyricOverlap(lyricLines, q)
	if !verifyVocalLyricOverlap(lyricLines, overlap, c.Priority, q) {
		return false
	}

	c.CleanContent = cleaned
	c.DetectedSingers = singers
	c.DetectedTags = tags
	c.OverlapScore = overlap
	return true
}

// cleanBracketVocalEvidence 清洗 Genius [Verse 1: Singer] / [角色] / 【角色】 / Role: 形式的文本
func cleanBracketVocalEvidence(rawText string) (cleaned string, singersCount int, tagSwitches int) {
	rawText = normalizeLineBreaks(reCleanZeroWidth.ReplaceAllString(rawText, ""))
	rawLines := strings.Split(rawText, "\n")

	type blockLine struct {
		role string
		text string
	}
	var blocks []blockLine
	currentRole := ""

	for _, rawLine := range rawLines {
		line := strings.TrimSpace(reCleanLineTimestamp.ReplaceAllString(rawLine, ""))
		if line == "" || reCleanMetaTag.MatchString(line) || reCleanCreditLine.MatchString(line) {
			continue
		}

		// 检查整行或行首的 [角色] / 【角色】
		if m := reCleanHeaderBracketLine.FindStringSubmatch(line); len(m) == 4 {
			inner := strings.TrimSpace(m[1])
			if inner == "" {
				inner = strings.TrimSpace(m[2])
			}
			rest := strings.TrimSpace(m[3])
			// 冒号结尾形式 `[角色]:` 或全/半角冒号引导正文 `[角色]：歌词`
			rest = strings.TrimSpace(strings.TrimLeft(rest, ":： \t\u3000"))

			if role, isSectionOnly := parseBracketRoleToken(inner); isSectionOnly {
				// 纯段落标记如 [Chorus] / [Verse 1]：不新建角色块，但如果同行后半句有歌词则继承当前角色
				if rest != "" && currentRole != "" {
					blocks = append(blocks, blockLine{role: currentRole, text: rest})
				}
				continue
			} else if role != "" {
				currentRole = role
				if rest != "" {
					blocks = append(blocks, blockLine{role: currentRole, text: rest})
				}
				continue
			}
		}

		// 检查行首 `Role: lyric` / `Role：lyric`
		if m := reCleanHeaderColonLine.FindStringSubmatch(line); len(m) == 3 {
			candidateRole := strings.TrimSpace(m[1])
			rest := strings.TrimSpace(m[2])
			if role, isSec := parseBracketRoleToken(candidateRole); !isSec && role != "" && !strings.HasPrefix(strings.ToLower(rest), "//") {
				currentRole = role
				if rest != "" && !reCleanCreditLine.MatchString(line) {
					blocks = append(blocks, blockLine{role: currentRole, text: rest})
				}
				continue
			}
		}

		if currentRole != "" {
			blocks = append(blocks, blockLine{role: currentRole, text: line})
		}
	}

	if len(blocks) == 0 {
		return "", 0, 0
	}

	var b strings.Builder
	lastRole := ""
	for _, blk := range blocks {
		if blk.text == "" {
			continue
		}
		if blk.role != lastRole {
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString("[")
			b.WriteString(blk.role)
			b.WriteString("]:\n")
			lastRole = blk.role
		} else {
			b.WriteByte('\n')
		}
		b.WriteString(blk.text)
	}

	cleaned = mergeConsecutiveVocalBlocks(b.String())
	singersCount, tagSwitches, _ = inspectNormalizedVocalBlocks(cleaned)
	return cleaned, singersCount, tagSwitches
}

// cleanMediaWikiVocalEvidence 清洗 Fandom / Sekaipedia / Miraheze Vocaloid Lyrics 等维基 wikitext
func cleanMediaWikiVocalEvidence(rawWikitext string, q *VocalSearchQuery) string {
	text := normalizeLineBreaks(reCleanZeroWidth.ReplaceAllString(rawWikitext, ""))
	text = reCleanWikiComment.ReplaceAllString(text, "")
	text = reCleanWikiRef.ReplaceAllString(text, "")

	// 提取全页范围的颜色图例表，放在节截取之前以免图例位于 == Lyrics == 之上
	legendColors := extractWikiColorLegend(text)

	// 定位 == Lyrics == 段落，剥离 Infobox 与尾部 Navbox
	text = isolateWikiLyricsSection(text)

	// 解包 {{Lyrics|Kan=...}} / {{lyricstab|japanese=...}} / 嵌套 <tabber> 与 {{#tag:tabber|...}}
	text = selectBestWikiTabContent(text, q)
	text = unwrapWikiLyricsWrapperTemplates(text, q)

	// 优先检查是否为 Miraheze Vocaloid Lyrics 表格结构（{| ... |- style="color:..." |jp|rom|eng |}）
	if tableCleaned := parseMirahezeColorTables(text, legendColors); tableCleaned != "" {
		return mergeConsecutiveVocalBlocks(tableCleaned)
	}

	// 清理外层标签并将模板/内联颜色转为规范标记 `[角色]:` 块
	cleaned := parseMediaWikiRoleMarkup(text, legendColors, q)
	return mergeConsecutiveVocalBlocks(cleaned)
}

// cleanMoegirlHTMLVocalEvidence 解析萌娘百科条目 HTML（.Lyrics-line / .Lyrics-original / span[title] + 颜色图例）
func cleanMoegirlHTMLVocalEvidence(rawHTML string, _ *VocalSearchQuery) string {
	doc, err := nethtml.Parse(strings.NewReader(rawHTML))
	if err != nil {
		return ""
	}

	root := findMoegirlContentRoot(doc)
	if root == nil {
		root = doc
	}

	// 提取页面中的颜色图例（例如 演唱分色表格 / <span style="color:#HEX">角色名</span>）
	legendColors := extractHTMLColorLegend(root)

	// 路径一：现代萌百 {{LyricsKai}} 渲染结构（.Lyrics-line -> .Lyrics-original）
	var originals []*nethtml.Node
	collectNodesByClass(root, "Lyrics-original", &originals)

	var out strings.Builder
	lastRole := ""
	appendSegment := func(role, lyricText string) {
		lyricText = cleanLyricSegmentText(lyricText)
		if lyricText == "" {
			return
		}
		if role == "" {
			role = lastRole
		}
		if role == "" {
			return
		}
		if role != lastRole {
			if out.Len() > 0 {
				out.WriteString("\n\n")
			}
			out.WriteString("[")
			out.WriteString(role)
			out.WriteString("]:\n")
			lastRole = role
		} else if out.Len() > 0 && !strings.HasSuffix(out.String(), "\n") {
			out.WriteByte(' ')
		}
		out.WriteString(lyricText)
	}

	if len(originals) > 0 {
		for _, lineNode := range originals {
			segs := extractMoegirlOriginalLineSegments(lineNode, legendColors)
			wroteLine := false
			for _, seg := range segs {
				txt := cleanLyricSegmentText(seg.text)
				if txt == "" || reCleanCreditLine.MatchString(txt) {
					continue
				}
				if seg.role != "" {
					if seg.role != lastRole {
						if out.Len() > 0 {
							out.WriteString("\n\n")
						}
						out.WriteString("[")
						out.WriteString(seg.role)
						out.WriteString("]:\n")
						lastRole = seg.role
					} else if wroteLine {
						out.WriteByte(' ')
					} else if out.Len() > 0 {
						out.WriteByte('\n')
					}
					out.WriteString(txt)
					wroteLine = true
				} else if lastRole != "" {
					if wroteLine {
						out.WriteByte(' ')
					} else if out.Len() > 0 {
						out.WriteByte('\n')
					}
					out.WriteString(txt)
					wroteLine = true
				}
			}
		}
		if cleaned := mergeConsecutiveVocalBlocks(out.String()); countDistinctSingersInNormalized(cleaned) >= vocalCleanMinSingers {
			return cleaned
		}
	}

	// 路径二：老式萌百歌词（<div class="poem"> 或 <p> 内的 <span style="color:#HEX"> / 【角色】）
	out.Reset()
	lastRole = ""
	var poemBlocks []*nethtml.Node
	collectMoegirlPoemOrColorBlocks(root, &poemBlocks)
	for _, blk := range poemBlocks {
		lines := extractHTMLColorOrBracketLines(blk, legendColors)
		for _, item := range lines {
			appendSegment(item.role, item.text)
			if item.text != "" && !strings.HasSuffix(out.String(), "\n") {
				out.WriteByte('\n')
			}
		}
	}
	if cleaned := mergeConsecutiveVocalBlocks(out.String()); countDistinctSingersInNormalized(cleaned) >= vocalCleanMinSingers {
		return cleaned
	}

	// 路径三：通用括号清洗兜底
	plainLines := extractPlainTextLinesFromHTML(root)
	if cleaned, singers, tags := cleanBracketVocalEvidence(plainLines); singers >= vocalCleanMinSingers && tags >= vocalCleanMinTags {
		return cleaned
	}
	return ""
}

// cleanHTMLVocalEvidence 清洗 Atwiki / Ameba / 普通歌词博客 HTML
func cleanHTMLVocalEvidence(rawHTML string, _ *VocalSearchQuery) string {
	doc, err := nethtml.Parse(strings.NewReader(rawHTML))
	if err != nil {
		cleaned, _, _ := cleanBracketVocalEvidence(rawHTML)
		return cleaned
	}

	legendColors := extractHTMLColorLegend(doc)
	if len(legendColors) >= vocalCleanMinSingers {
		lines := extractHTMLColorOrBracketLines(doc, legendColors)
		var out strings.Builder
		lastRole := ""
		for _, item := range lines {
			txt := cleanLyricSegmentText(item.text)
			if txt == "" || reCleanCreditLine.MatchString(txt) {
				continue
			}
			role := item.role
			if role == "" {
				role = lastRole
			}
			if role == "" {
				continue
			}
			if role != lastRole {
				if out.Len() > 0 {
					out.WriteString("\n\n")
				}
				out.WriteString("[")
				out.WriteString(role)
				out.WriteString("]:\n")
				lastRole = role
			} else {
				out.WriteByte('\n')
			}
			out.WriteString(txt)
		}
		if merged := mergeConsecutiveVocalBlocks(out.String()); countDistinctSingersInNormalized(merged) >= vocalCleanMinSingers {
			return merged
		}
	}

	plainText := extractPlainTextLinesFromHTML(doc)
	cleaned, _, _ := cleanBracketVocalEvidence(plainText)
	return cleaned
}

// normalizeVocalRoleName 规范化角色/歌手名：剥离 PJSK 分团后缀，拆分多人分隔符，查标准映射表并合并去重
func normalizeVocalRoleName(raw string) string {
	raw = html.UnescapeString(reCleanZeroWidth.ReplaceAllString(raw, ""))
	raw = strings.TrimSpace(raw)
	raw = strings.Trim(raw, "[]【】<>•·・:：/|\\　 ")
	if raw == "" || reCleanHexOnly.MatchString(raw) {
		return ""
	}
	// 丢弃形如 `<span ...>` 或 URL/模板语法残留
	if strings.ContainsAny(raw, "{}<>=") || strings.Contains(strings.ToLower(raw), "http") {
		return ""
	}

	// 检查整体是否包含多人分隔符
	parts := reCleanMultiSep.Split(raw, -1)
	if len(parts) > 1 {
		seen := make(map[string]bool, len(parts))
		var normalized []string
		for _, p := range parts {
			single := normalizeSingleRoleToken(p)
			if single == "" || seen[single] {
				continue
			}
			seen[single] = true
			normalized = append(normalized, single)
		}
		if len(normalized) == 0 {
			return ""
		}
		if len(normalized) == 1 {
			return normalized[0]
		}
		return strings.Join(normalized, " & ")
	}
	return normalizeSingleRoleToken(raw)
}

func normalizeSingleRoleToken(raw string) string {
	tok := strings.TrimSpace(strings.Trim(raw, "[]【】()（）<>•·・:：/|\\'\"　 "))
	if tok == "" || reCleanHexOnly.MatchString(tok) {
		return ""
	}
	if len([]rune(tok)) > 40 {
		return ""
	}
	if isNumericOnly(tok) || isNonRoleName(tok) {
		return ""
	}

	// 尝试直接查映射表
	lower := normalizeRoleKey(tok)
	if mapped, ok := vocalCharacterMap[lower]; ok {
		return mapped
	}

	// 剥离 PJSK 组合后缀（如 `Miku 25`, `Rin vbs`, `Rin wxs`, `Luka ln`, `KAITO mmj`）后再查一次
	stripped := strings.TrimSpace(reCleanPJSKUnitSuffix.ReplaceAllString(tok, ""))
	if stripped != "" && stripped != tok {
		if isNonRoleName(stripped) {
			return ""
		}
		strippedLower := normalizeRoleKey(stripped)
		if mapped, ok := vocalCharacterMap[strippedLower]; ok {
			return mapped
		}
		tok = stripped
	}

	// 剥离尾部括号说明（如 `初音未来(25时)`）做辅助校验，但若原本非 PJSK 简写则尽量保留清洗后名字
	if idx := strings.IndexAny(tok, "（("); idx > 0 {
		prefix := strings.TrimSpace(tok[:idx])
		if mapped, ok := vocalCharacterMap[normalizeRoleKey(prefix)]; ok {
			return mapped
		}
	}
	return tok
}

func normalizeRoleKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "_", " ")
	s = reCleanSpaceCollapse.ReplaceAllString(s, " ")
	return s
}

func isNonRoleName(s string) bool {
	key := normalizeRoleKey(s)
	if key == "" {
		return true
	}
	if bad, exists := nonRoleKeywords[key]; exists && bad {
		return true
	}
	// 纯符号或标点
	hasLetterOrDigit := false
	for _, r := range key {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			hasLetterOrDigit = true
			break
		}
	}
	if !hasLetterOrDigit {
		return true
	}
	if reCleanBracketOnlySec.MatchString(key) {
		return true
	}
	return false
}

func isNumericOnly(s string) bool {
	for _, r := range s {
		if !unicode.IsDigit(r) && !unicode.IsPunct(r) && !unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

func parseBracketRoleToken(inner string) (role string, sectionOnly bool) {
	trimmed := strings.TrimSpace(inner)
	if trimmed == "" {
		return "", false
	}
	if reCleanBracketOnlySec.MatchString(trimmed) {
		return "", true
	}
	if m := reCleanBracketSection.FindStringSubmatch(trimmed); len(m) == 2 {
		trimmed = strings.TrimSpace(m[1])
		if trimmed == "" {
			return "", true
		}
	}
	if reCleanCreditLine.MatchString(trimmed + ":") {
		return "", true
	}
	return normalizeVocalRoleName(trimmed), false
}

// ---------- MediaWiki Wikitext 解析器 ----------

func isolateWikiLyricsSection(text string) string {
	loc := reCleanSectionLyrics.FindStringIndex(text)
	if loc == nil {
		return text
	}
	sub := text[loc[1]:]
	if nextLoc := reCleanSectionNext.FindStringIndex(sub); nextLoc != nil {
		sub = sub[:nextLoc[0]]
	}
	return strings.TrimSpace(sub)
}

func extractWikiColorLegend(text string) map[string]string {
	legend := make(map[string]string)
	// 匹配 <span style="...color:#HEX...">Role</span> 或 {{color|#HEX|Role}} 或 <font color="#HEX">Role</font>
	reSpan := regexp.MustCompile(`(?is)<span[^>]*style=["'][^"']*color\s*:\s*(#[0-9a-f]{3,8}|[a-z]+)[^"']*["'][^>]*>(.*?)</span>`)
	for _, m := range reSpan.FindAllStringSubmatch(text, -1) {
		addLegendEntry(legend, m[1], stripWikiInlineNoise(m[2]))
	}
	for _, m := range reCleanFontColor.FindAllStringSubmatch(text, -1) {
		addLegendEntry(legend, m[1], stripWikiInlineNoise(m[2]))
	}
	// 表格色块形式：`| style="background:#HEX;..." | RoleName` 或 `| style="color:#HEX" | RoleName`
	reTableLegend := regexp.MustCompile(`(?im)\|\s*(?:style=["'][^"']*(?:color|background(?:-color)?)\s*:\s*(#[0-9a-f]{3,8}|[a-z]+)[^"']*["'][^|]*\|)\s*([^\|\n]{1,50})`)
	for _, m := range reTableLegend.FindAllStringSubmatch(text, -1) {
		addLegendEntry(legend, m[1], stripWikiInlineNoise(m[2]))
	}
	// {{color|#HEX|Role}} 图例短行（长度 <= 40 rune 才认为是图例）
	reColorTpl := regexp.MustCompile(`(?i)\{\{color\|(#[0-9a-f]{3,8}|[a-z]+)\|([^\{\}\|\n]{1,40})\}\}`)
	for _, m := range reColorTpl.FindAllStringSubmatch(text, -1) {
		addLegendEntry(legend, m[1], stripWikiInlineNoise(m[2]))
	}
	return legend
}

func addLegendEntry(legend map[string]string, rawColor, rawRole string) {
	colorKey := canonicalColorKey(rawColor)
	if colorKey == "" || colorKey == "#000000" || colorKey == "black" || colorKey == "#ffffff" || colorKey == "white" {
		return
	}
	// 图例单元格里的角色名通常是短标签；过滤整句歌词
	if len([]rune(rawRole)) > 35 || strings.ContainsAny(rawRole, "。！？♪") {
		return
	}
	role := normalizeVocalRoleName(rawRole)
	if role == "" {
		return
	}
	if _, exists := legend[colorKey]; !exists {
		legend[colorKey] = role
	}
}

func canonicalColorKey(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "#") {
		// 将 3 位 hex 扩展为 6 位便于对比
		if len(s) == 4 {
			return fmtHex6(s[1], s[2], s[3])
		}
		if len(s) >= 7 {
			return s[:7]
		}
		return s
	}
	return s
}

func fmtHex6(r, g, b byte) string {
	return "#" + string([]byte{r, r, g, g, b, b})
}

// selectBestWikiTabContent 递归展开嵌套的 <tabber> 与 {{#tag:tabber|...}} 并选择最优版本/语言页签
func selectBestWikiTabContent(text string, q *VocalSearchQuery) string {
	// 反复展开直到最外层不存在 tabber
	for round := 0; round < 6; round++ {
		changed := false
		// 1) 优先处理 <tabber>...</tabber>
		if start, innerStart, innerEnd, end := findOutermostXMLTabber(text); start >= 0 {
			tabs := splitTabberSections(text[innerStart:innerEnd])
			chosen := pickBestTabSection(tabs, q)
			text = text[:start] + "\n" + chosen + "\n" + text[end:]
			changed = true
			continue
		}
		// 2) 处理 {{#tag:tabber|...}}
		if start, innerStart, innerEnd, end := findOutermostParserTabber(text); start >= 0 {
			inner := strings.ReplaceAll(text[innerStart:innerEnd], "{{!}}-{{!}}", "|-|")
			inner = strings.ReplaceAll(inner, "{{!}}", "|")
			tabs := splitTabberSections(inner)
			chosen := pickBestTabSection(tabs, q)
			text = text[:start] + "\n" + chosen + "\n" + text[end:]
			changed = true
			continue
		}
		if !changed {
			break
		}
	}
	return text
}

func findOutermostXMLTabber(s string) (start, innerStart, innerEnd, end int) {
	lower := strings.ToLower(s)
	openIdx := strings.Index(lower, "<tabber>")
	if openIdx < 0 {
		return -1, -1, -1, -1
	}
	depth := 1
	pos := openIdx + len("<tabber>")
	for pos < len(s) {
		nextOpen := strings.Index(lower[pos:], "<tabber>")
		nextClose := strings.Index(lower[pos:], "</tabber>")
		if nextClose < 0 {
			// 未闭合时容错截到文末
			return openIdx, openIdx + len("<tabber>"), len(s), len(s)
		}
		if nextOpen >= 0 && nextOpen < nextClose {
			depth++
			pos += nextOpen + len("<tabber>")
			continue
		}
		depth--
		pos += nextClose
		if depth == 0 {
			return openIdx, openIdx + len("<tabber>"), pos, pos + len("</tabber>")
		}
		pos += len("</tabber>")
	}
	return -1, -1, -1, -1
}

func findOutermostParserTabber(s string) (start, innerStart, innerEnd, end int) {
	reOpen := regexp.MustCompile(`(?is)\{\{\s*#tag\s*:\s*tabber\s*\|`)
	loc := reOpen.FindStringIndex(s)
	if loc == nil {
		return -1, -1, -1, -1
	}
	depth := 2 // 处于 `{{` 内部
	pos := loc[0] + 2
	for pos < len(s) {
		if strings.HasPrefix(s[pos:], "{{") {
			depth += 2
			pos += 2
			continue
		}
		if strings.HasPrefix(s[pos:], "}}") {
			depth -= 2
			if depth <= 0 {
				return loc[0], loc[1], pos, pos + 2
			}
			pos += 2
			continue
		}
		pos++
	}
	return -1, -1, -1, -1
}

type wikiTabSection struct {
	name    string
	content string
}

func splitTabberSections(inner string) []wikiTabSection {
	var parts []string
	var cur strings.Builder
	tabDepth := 0
	braceDepth := 0
	i := 0
	for i < len(inner) {
		if strings.HasPrefix(strings.ToLower(inner[i:]), "<tabber>") {
			tabDepth++
			cur.WriteString(inner[i : i+8])
			i += 8
			continue
		}
		if strings.HasPrefix(strings.ToLower(inner[i:]), "</tabber>") {
			if tabDepth > 0 {
				tabDepth--
			}
			cur.WriteString(inner[i : i+9])
			i += 9
			continue
		}
		if strings.HasPrefix(inner[i:], "{{") {
			braceDepth++
			cur.WriteString("{{")
			i += 2
			continue
		}
		if strings.HasPrefix(inner[i:], "}}") {
			if braceDepth > 0 {
				braceDepth--
			}
			cur.WriteString("}}")
			i += 2
			continue
		}
		if tabDepth == 0 && braceDepth == 0 && strings.HasPrefix(inner[i:], "|-|") {
			parts = append(parts, cur.String())
			cur.Reset()
			i += 3
			continue
		}
		cur.WriteByte(inner[i])
		i++
	}
	parts = append(parts, cur.String())

	var sections []wikiTabSection
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if name, body, ok := strings.Cut(part, "="); ok && !strings.Contains(name, "\n") && len(name) <= 60 {
			sections = append(sections, wikiTabSection{
				name:    strings.TrimSpace(name),
				content: strings.TrimSpace(body),
			})
		} else {
			sections = append(sections, wikiTabSection{
				name:    "",
				content: part,
			})
		}
	}
	return sections
}

func pickBestTabSection(tabs []wikiTabSection, q *VocalSearchQuery) string {
	if len(tabs) == 0 {
		return ""
	}
	if len(tabs) == 1 {
		return selectBestWikiTabContent(tabs[0].content, q)
	}

	prefersFull := q != nil && len(q.LyricsLines) >= 25
	prefersVS := q != nil && q.PrefersVirtualSinger
	prefersCJK := q == nil || q.HasCJKContext

	bestIdx := 0
	bestScore := -100000

	// 预先展开子 tabber 以便依据实际含有的角色标签密度做决策
	expanded := make([]string, len(tabs))
	for i, tab := range tabs {
		expanded[i] = selectBestWikiTabContent(tab.content, q)
		label := strings.ToLower(strings.TrimSpace(tab.name))
		content := expanded[i]

		score := 0
		roleDensity := estimateWikiRoleDensity(content)
		hasCJK := reVocalCJK.MatchString(content)

		// 纯翻译 tab 大幅降权（避免抢占原文声部标注）
		if strings.Contains(label, "english") || strings.Contains(label, "translation") || strings.Contains(label, "eng") && !strings.Contains(label, "kan") {
			score -= 500
		}

		// 版本偏好：Full vs Game / Short
		if prefersFull {
			if strings.Contains(label, "full") {
				score += 180
			} else if strings.Contains(label, "game") || strings.Contains(label, "short") || strings.Contains(label, "tv") {
				score -= 120
			}
		} else if len(tabs) > 1 && strings.Contains(label, "game") && q != nil && len(q.LyricsLines) > 0 && len(q.LyricsLines) < 25 {
			score += 60
		}

		// PJSK 版本偏好：Virtual Singer vs SEKAI
		if prefersVS {
			if strings.Contains(label, "virtual") || strings.Contains(label, "vocaloid") || strings.Contains(label, "original") {
				score += 160
			} else if strings.Contains(label, "sekai") {
				score -= 80
			}
		} else {
			if strings.Contains(label, "sekai") {
				score += 140
			}
		}

		// 语种优先级：日文原文（含声部标签） > 罗马音（含声部标签） > 无标签日文
		isJapaneseLabel := strings.Contains(label, "japan") || strings.Contains(label, "kanji") ||
			label == "kan" || strings.Contains(label, "nihongo") ||
			strings.Contains(label, "日本") || strings.Contains(label, "原文") || strings.Contains(label, "歌词")
		isRomajiLabel := strings.Contains(label, "romaji") || strings.Contains(label, "rōmaji")
		if isJapaneseLabel {
			score += 120
		} else if isRomajiLabel {
			score += 40
		}
		if prefersCJK && hasCJK {
			score += 70
		}
		if roleDensity > 0 {
			score += 300 + min(roleDensity*15, 200)
		} else {
			score -= 150
		}

		if score > bestScore {
			bestScore = score
			bestIdx = i
		}
	}
	return expanded[bestIdx]
}

func estimateWikiRoleDensity(wikitext string) int {
	reTpl := regexp.MustCompile(`\{\{([^\|{}\n]{1,36})\|`)
	count := 0
	for _, m := range reTpl.FindAllStringSubmatch(wikitext, -1) {
		name := strings.TrimSpace(m[1])
		lower := strings.ToLower(name)
		if lower == "lyric" || lower == "lyrics line" || lower == "multiccalt" || lower == "multicc" || lower == "colore" || lower == "color" {
			count += 2
			continue
		}
		if normalizeVocalRoleName(name) != "" {
			count++
		}
	}
	reColorTag := regexp.MustCompile(`(?i)color\s*:\s*#[0-9a-f]{3,8}`)
	count += min(len(reColorTag.FindAllString(wikitext, -1)), 20)
	return count
}

// unwrapWikiLyricsWrapperTemplates 展开 {{Lyrics|Kan=...}} / {{lyricstab|...}} / {{Scroll box|content=...}} 等外层容器模板
func unwrapWikiLyricsWrapperTemplates(text string, q *VocalSearchQuery) string {
	var b strings.Builder
	i := 0
	for i < len(text) {
		if strings.HasPrefix(text[i:], "{{") {
			end := findBalancedTemplateEnd(text, i)
			if end > i {
				rawTpl := text[i+2 : end-2]
				head := rawTpl
				if barIdx := strings.IndexByte(rawTpl, '|'); barIdx >= 0 {
					head = rawTpl[:barIdx]
				}
				lowerHead := strings.ToLower(strings.TrimSpace(head))
				if lowerHead == "lyrics" || lowerHead == "lyricstab" || lowerHead == "lyrics table" || lowerHead == "tab" ||
					lowerHead == "scroll box" || lowerHead == "scrollbox" || lowerHead == "collapse" || lowerHead == "collapsed" || lowerHead == "quote" {
					if extracted := pickBestNamedLyricParam(rawTpl, q); extracted != "" {
						b.WriteString(unwrapWikiLyricsWrapperTemplates(extracted, q))
						i = end
						continue
					}
				}
			}
		}
		b.WriteByte(text[i])
		i++
	}
	return b.String()
}

func pickBestNamedLyricParam(tplBody string, _ *VocalSearchQuery) string {
	params := splitTopLevelTemplateParams(tplBody)
	if len(params) < 2 {
		return ""
	}
	lowerHead := strings.ToLower(strings.TrimSpace(params[0]))
	isContainerTpl := lowerHead == "scroll box" || lowerHead == "scrollbox" || lowerHead == "collapse" || lowerHead == "collapsed" || lowerHead == "quote" || lowerHead == "cquote"
	var japanese, romaji, other string
	for _, p := range params[1:] {
		k, v, ok := strings.Cut(p, "=")
		// 若 '=' 位于 HTML/模板/换行内部，说明实际是位置参数而非命名参数
		if ok && strings.ContainsAny(strings.TrimSpace(k), "<>{}[]\n\"'") {
			ok = false
		}
		if !ok {
			if isContainerTpl {
				if val := strings.TrimSpace(p); val != "" && len([]rune(val)) > len([]rune(other)) {
					other = val
				}
			}
			continue
		}
		key := strings.ToLower(strings.TrimSpace(k))
		val := strings.TrimSpace(v)
		if val == "" {
			continue
		}
		switch key {
		case "kan", "kanji", "japanese", "jp", "ja", "original", "lyrics", "text", "content", "1":
			if japanese == "" || estimateWikiRoleDensity(val) > estimateWikiRoleDensity(japanese) {
				japanese = val
			}
		case "rom", "romaji", "rōmaji":
			if romaji == "" {
				romaji = val
			}
		case "kanji_alt", "japanese2":
			if japanese == "" {
				japanese = val
			}
		default:
			if !strings.Contains(key, "eng") && !strings.Contains(key, "trans") && other == "" && estimateWikiRoleDensity(val) > 0 {
				other = val
			}
		}
	}
	if japanese != "" {
		// 仅当日文段完全没有声部标签且罗马音段含有声部标签时回退到罗马音段
		if estimateWikiRoleDensity(japanese) == 0 && estimateWikiRoleDensity(romaji) > 0 {
			return romaji
		}
		return japanese
	}
	if romaji != "" {
		return romaji
	}
	return other
}

// parseMirahezeColorTables 解析 Miraheze Vocaloid Lyrics Wiki 常见的表格+行内颜色歌词
func parseMirahezeColorTables(text string, legendColors map[string]string) string {
	if len(legendColors) < vocalCleanMinSingers {
		return ""
	}
	reTable := regexp.MustCompile(`(?s)\{\|(.*?)\|\}`)
	tables := reTable.FindAllStringSubmatch(text, -1)
	if len(tables) == 0 {
		return ""
	}

	var out strings.Builder
	lastRole := ""
	totalLines := 0

	appendLine := func(role, line string) {
		line = cleanLyricSegmentText(stripWikiInlineNoise(line))
		if line == "" || reCleanCreditLine.MatchString(line) {
			return
		}
		if role == "" {
			role = lastRole
		}
		if role == "" {
			return
		}
		if role != lastRole {
			if out.Len() > 0 {
				out.WriteString("\n\n")
			}
			out.WriteString("[")
			out.WriteString(role)
			out.WriteString("]:\n")
			lastRole = role
		} else {
			out.WriteByte('\n')
		}
		out.WriteString(line)
		totalLines++
	}

	for _, tbl := range tables {
		body := tbl[1]
		// 跳过纯颜色图例小表（通常不超过 12 行且不包含连续多列歌词）
		if !strings.Contains(body, "|-") {
			continue
		}
		rows := strings.Split(body, "|-")
		for _, row := range rows {
			rowTrim := strings.TrimSpace(row)
			if rowTrim == "" || strings.HasPrefix(rowTrim, "!") {
				continue
			}
			firstNL := strings.IndexByte(rowTrim, '\n')
			rowAttr := ""
			rowCellsRaw := rowTrim
			if firstNL >= 0 {
				rowAttr = rowTrim[:firstNL]
				rowCellsRaw = rowTrim[firstNL+1:]
			}
			rowRole := resolveLegendColorFromAttr(rowAttr, legendColors)

			// 仅取第一列歌词列（日文原文列），避免把罗马音/英文翻译列重复当成日文歌词
			firstCell := extractFirstWikiTableCell(rowCellsRaw)
			if strings.TrimSpace(firstCell) == "" {
				continue
			}
			// 单元格内部可能含 <br> 断行与内联 <span style="color:#...">
			firstCell = regexp.MustCompile(`(?i)<br\s*/?>`).ReplaceAllString(firstCell, "\n")
			for _, subLine := range strings.Split(firstCell, "\n") {
				subLine = strings.TrimSpace(subLine)
				if subLine == "" {
					continue
				}
				segs := extractInlineColorOrTemplateSegments(subLine, rowRole, legendColors)
				for _, seg := range segs {
					appendLine(seg.role, seg.text)
				}
			}
		}
	}

	if totalLines < 4 || countDistinctSingersInNormalized(out.String()) < vocalCleanMinSingers {
		return ""
	}
	return out.String()
}

func resolveLegendColorFromAttr(attr string, legendColors map[string]string) string {
	if attr == "" {
		return ""
	}
	if m := reCleanColorStyle.FindStringSubmatch(attr); len(m) == 2 {
		if role, ok := legendColors[canonicalColorKey(m[1])]; ok {
			return role
		}
	}
	return ""
}

func extractFirstWikiTableCell(rowCellsRaw string) string {
	lines := strings.Split(rowCellsRaw, "\n")
	for _, l := range lines {
		t := strings.TrimSpace(l)
		if t == "" || strings.HasPrefix(t, "!") || strings.HasPrefix(t, "class=") || strings.HasPrefix(t, "style=") {
			continue
		}
		if strings.HasPrefix(t, "|") {
			t = strings.TrimPrefix(t, "|")
			// 同一行可能是 `|jp || romaji || eng`
			if idx := strings.Index(t, "||"); idx >= 0 {
				t = t[:idx]
			}
			// 同一格可能有 `style="..." | text`（须避开模板 `{{...}}` 与内链 `[[...]]` 内的 `|`）
			t = stripLeadingCellAttribute(t)
			return strings.TrimSpace(t)
		}
	}
	return ""
}

func stripLeadingCellAttribute(cell string) string {
	braceDepth := 0
	bracketDepth := 0
	for i := 0; i < len(cell); i++ {
		if strings.HasPrefix(cell[i:], "{{") || strings.HasPrefix(cell[i:], "[[") {
			braceDepth++
			i++
			continue
		}
		if strings.HasPrefix(cell[i:], "}}") || strings.HasPrefix(cell[i:], "]]") {
			if braceDepth > 0 {
				braceDepth--
			}
			i++
			continue
		}
		if strings.HasPrefix(cell[i:], "<") {
			bracketDepth++
		} else if strings.HasPrefix(cell[i:], ">") && bracketDepth > 0 {
			bracketDepth--
		}
		if cell[i] == '|' && braceDepth == 0 && bracketDepth == 0 {
			prefix := strings.ToLower(strings.TrimSpace(cell[:i]))
			if strings.Contains(prefix, "style=") || strings.Contains(prefix, "class=") || strings.Contains(prefix, "colspan=") {
				return strings.TrimSpace(cell[i+1:])
			}
			break
		}
	}
	return cell
}

// parseMediaWikiRoleMarkup 遍历 wikitext 平衡花括号模板与行内标签，输出标准 `[角色]:` 块
func parseMediaWikiRoleMarkup(wikitext string, legendColors map[string]string, _ *VocalSearchQuery) string {
	text := reCleanWikiComment.ReplaceAllString(wikitext, "")
	text = reCleanWikiRef.ReplaceAllString(text, "")
	text = regexp.MustCompile(`(?is)</?poem>`).ReplaceAllString(text, "\n")
	text = regexp.MustCompile(`(?i)<br\s*/?>`).ReplaceAllString(text, "\n")
	text = strings.ReplaceAll(text, "{{!}}", "|")

	// 解包无闭合尾花括号的常见壳子如 {{CopyLyrics| 并内联剥离 {{ruby|...|...}} 避免行内注音拆行
	text = regexp.MustCompile(`(?i)\{\{CopyLyrics\|`).ReplaceAllString(text, "")
	text = stripMediaWikiRubyTemplates(text)

	type roleLine struct {
		role string
		text string
	}
	var lines []roleLine

	var emitSegments func(chunk string, chunkRole string)
	emitSegments = func(chunk string, chunkRole string) {
		i := 0
		inheritedRole := chunkRole
		var plainBuf strings.Builder
		flushPlain := func() {
			if plainBuf.Len() == 0 {
				return
			}
			raw := plainBuf.String()
			plainBuf.Reset()
			for _, ln := range strings.Split(raw, "\n") {
				cleanLn := cleanLyricSegmentText(stripWikiInlineNoise(ln))
				if cleanLn == "" || reCleanCreditLine.MatchString(cleanLn) {
					continue
				}
				if chunkRole != "" {
					lines = append(lines, roleLine{role: chunkRole, text: cleanLn})
					continue
				}
				if m := reCleanHeaderBracketLine.FindStringSubmatch(cleanLn); len(m) == 4 {
					// 兼容 `[Verse 1: Singer]`、`[Role] lyric`、`【Role】 lyric` 与纯段落标记 `[Chorus]`
					inner := strings.TrimSpace(m[1])
					if inner == "" {
						inner = strings.TrimSpace(m[2])
					}
					rest := strings.TrimSpace(strings.TrimLeft(m[3], ":： \t\u3000"))
					if parsedRole, secOnly := parseBracketRoleToken(inner); secOnly {
						if rest != "" && inheritedRole != "" {
							lines = append(lines, roleLine{role: inheritedRole, text: rest})
						}
						continue
					} else if parsedRole != "" {
						inheritedRole = parsedRole
						if rest != "" {
							lines = append(lines, roleLine{role: parsedRole, text: rest})
						}
						continue
					}
				}
				if inheritedRole != "" {
					lines = append(lines, roleLine{role: inheritedRole, text: cleanLn})
				}
			}
		}

		for i < len(chunk) {
			if strings.HasPrefix(chunk[i:], "{{") {
				end := findBalancedTemplateEnd(chunk, i)
				if end > i {
					tplBody := chunk[i+2 : end-2]
					consumed := handleMediaWikiTemplate(tplBody, inheritedRole, legendColors, &plainBuf, &flushPlain, emitSegments, func(r string) { inheritedRole = r })
					if consumed {
						i = end
						continue
					}
				}
			}
			if strings.HasPrefix(strings.ToLower(chunk[i:]), "<span") {
				if spanRole, spanInner, spanEnd, ok := parseHTMLColorSpanAt(chunk[i:], legendColors); ok {
					flushPlain()
					targetRole := spanRole
					if targetRole == "" {
						targetRole = inheritedRole
					}
					emitSegments(spanInner, targetRole)
					i += spanEnd
					continue
				}
			}
			plainBuf.WriteByte(chunk[i])
			i++
		}
		flushPlain()
	}

	emitSegments(text, "")

	if len(lines) == 0 {
		// 退化为通用括号提取（防止个别页面根本没有模板而是用 `[Role]` / `【Role】` 书写）
		plain := stripWikiInlineNoise(text)
		cleaned, _, _ := cleanBracketVocalEvidence(plain)
		return cleaned
	}

	var out strings.Builder
	lastRole := ""
	for _, item := range lines {
		txt := strings.TrimSpace(item.text)
		if txt == "" || item.role == "" {
			continue
		}
		if item.role != lastRole {
			if out.Len() > 0 {
				out.WriteString("\n\n")
			}
			out.WriteString("[")
			out.WriteString(item.role)
			out.WriteString("]:\n")
			lastRole = item.role
		} else {
			out.WriteByte('\n')
		}
		out.WriteString(txt)
	}
	return out.String()
}

func stripMediaWikiRubyTemplates(s string) string {
	if !strings.Contains(s, "{{") {
		return s
	}
	var out strings.Builder
	i := 0
	for i < len(s) {
		if strings.HasPrefix(s[i:], "{{") {
			if end := findBalancedTemplateEnd(s, i); end > i {
				tplBody := s[i+2 : end-2]
				params := splitTopLevelTemplateParams(tplBody)
				if len(params) >= 2 {
					lowerHead := strings.ToLower(strings.TrimSpace(params[0]))
					if lowerHead == "ruby" || lowerHead == "rb" || lowerHead == "photrans" || lowerHead == "ruby-ja" {
						base := params[1]
						if strings.Contains(base, "={{") || strings.HasPrefix(strings.TrimSpace(base), "1=") {
							_, base, _ = strings.Cut(base, "=")
						}
						out.WriteString(stripMediaWikiRubyTemplates(strings.TrimSpace(base)))
						i = end
						continue
					}
				}
			}
		}
		out.WriteByte(s[i])
		i++
	}
	return out.String()
}

func handleMediaWikiTemplate(
	tplBody string,
	inheritedRole string,
	legendColors map[string]string,
	plainBuf *strings.Builder,
	flushPlain *func(),
	emitSegments func(chunk string, inheritedRole string),
	setInherited func(string),
) bool {
	params := splitTopLevelTemplateParams(tplBody)
	if len(params) == 0 {
		return false
	}
	head := strings.TrimSpace(params[0])
	lowerHead := strings.ToLower(head)

	// 1) 注音模板 {{ruby|汉字|假名}} / {{rb|汉字|假名}} / {{photrans|汉字|假名}}
	if lowerHead == "ruby" || lowerHead == "rb" || lowerHead == "photrans" || lowerHead == "ruby-ja" {
		if len(params) >= 2 {
			base := params[1]
			if strings.Contains(base, "={{") || strings.HasPrefix(strings.TrimSpace(base), "1=") {
				_, base, _ = strings.Cut(base, "=")
			}
			// 直接并入当前缓冲，确保不会在行中切分换行
			plainBuf.WriteString(stripMediaWikiRubyTemplates(strings.TrimSpace(base)))
		}
		return true
	}

	// 2) Sekaipedia {{Lyrics line | japanese = ... | romaji = ... | english = ...}}
	if lowerHead == "lyrics line" || lowerHead == "lyricsline" {
		(*flushPlain)()
		var jpVal, romVal string
		for _, p := range params[1:] {
			k, v, ok := strings.Cut(p, "=")
			if !ok {
				continue
			}
			switch strings.ToLower(strings.TrimSpace(k)) {
			case "japanese", "kanji", "kan", "jp", "ja":
				jpVal = v
			case "romaji", "rōmaji", "rom":
				romVal = v
			}
		}
		chosen := jpVal
		if strings.TrimSpace(chosen) == "" || (estimateWikiRoleDensity(chosen) == 0 && estimateWikiRoleDensity(romVal) > 0) {
			if strings.TrimSpace(romVal) != "" && strings.TrimSpace(jpVal) == "" {
				chosen = romVal
			}
		}
		if chosen != "" {
			emitSegments(chosen, inheritedRole)
			emitSegments("\n", inheritedRole)
		}
		return true
	}

	// 3) Sekaipedia {{Lyric|Role|text}}
	if lowerHead == "lyric" && len(params) >= 3 {
		(*flushPlain)()
		role := normalizeVocalRoleName(params[1])
		content := strings.Join(params[2:], "|")
		// 剔除命名参数如 color=... 仅留正文
		if strings.Contains(params[len(params)-1], "=") && len(params) > 3 {
			content = params[2]
		}
		if role == "" {
			role = inheritedRole
		}
		emitSegments(content+"\n", role)
		return true
	}

	// 4) {{multiccAlt|Role1, Role2|content}} / {{multicc|c1=...|c2=...|content}}
	if lowerHead == "multiccalt" && len(params) >= 3 {
		(*flushPlain)()
		role := normalizeVocalRoleName(params[1])
		content := params[len(params)-1]
		if len(params) > 3 {
			content = strings.Join(params[2:], "|")
		}
		emitSegments(content+"\n", role)
		return true
	}
	if lowerHead == "multicc" && len(params) >= 3 {
		(*flushPlain)()
		var roles []string
		var content string
		for _, p := range params[1:] {
			if k, v, ok := strings.Cut(p, "="); ok && regexp.MustCompile(`(?i)^c\d+$`).MatchString(strings.TrimSpace(k)) {
				if r := normalizeVocalRoleName(v); r != "" {
					roles = append(roles, r)
				}
			} else {
				if content != "" {
					content += "|"
				}
				content += p
			}
		}
		combined := normalizeVocalRoleName(strings.Join(roles, " & "))
		if combined == "" {
			combined = inheritedRole
		}
		emitSegments(content+"\n", combined)
		return true
	}

	// 5) {{color|#HEX|content}} / {{coloredtext|...}}
	if (lowerHead == "color" || lowerHead == "colore" || lowerHead == "coloredtext" || lowerHead == "fontcolor") && len(params) >= 3 {
		(*flushPlain)()
		cKey := canonicalColorKey(params[1])
		role := legendColors[cKey]
		if role == "" {
			role = normalizeVocalRoleName(params[1])
		}
		if role == "" {
			role = inheritedRole
		}
		emitSegments(params[2], role)
		return true
	}

	// 6) {{Shared|text}} / {{All|text}}
	if (lowerHead == "shared" || lowerHead == "all") && len(params) >= 2 {
		(*flushPlain)()
		emitSegments(strings.Join(params[1:], "|"), "合唱")
		return true
	}

	// 7) 角色同名模板：{{Miku|text}} / {{Miku 25|text}} / {{Ichika|text}} / {{Karen|text}}
	if !isNonRoleName(head) {
		if role := normalizeVocalRoleName(head); role != "" {
			(*flushPlain)()
			if len(params) >= 2 {
				emitSegments(strings.Join(params[1:], "|"), role)
			} else {
				// 零参数模板 `{{Miku}}` 作为后续行的声部切换
				setInherited(role)
			}
			return true
		}
	}

	// 8) 非角色系统模板但可能内含歌词文本：忽略结构控制，解包/放行文本参数（仅在白名单内）
	if lowerHead == "small" || lowerHead == "big" || lowerHead == "center" || lowerHead == "b" || lowerHead == "i" ||
		lowerHead == "scroll box" || lowerHead == "scrollbox" || lowerHead == "collapse" || lowerHead == "collapsed" || lowerHead == "quote" || lowerHead == "cquote" {
		if len(params) >= 2 {
			(*flushPlain)()
			body := params[1]
			if lowerHead == "scroll box" || lowerHead == "scrollbox" || lowerHead == "collapse" || lowerHead == "collapsed" || lowerHead == "quote" || lowerHead == "cquote" {
				if extracted := pickBestNamedLyricParam(tplBody, nil); extracted != "" {
					body = extracted
				}
			}
			emitSegments(body, inheritedRole)
		}
		return true
	}

	// 丢弃已知纯元信息/布局模板（如 infobox, clear, navbox 等）避免把参数泄露进正文
	if isNonRoleName(head) || strings.HasPrefix(lowerHead, "#") || strings.Contains(lowerHead, "infobox") || strings.Contains(lowerHead, "navbox") {
		(*flushPlain)()
		return true
	}
	return false
}

func findBalancedTemplateEnd(s string, start int) int {
	depth := 0
	pos := start
	for pos < len(s) {
		if strings.HasPrefix(s[pos:], "{{") {
			depth++
			pos += 2
			continue
		}
		if strings.HasPrefix(s[pos:], "}}") {
			depth--
			pos += 2
			if depth == 0 {
				return pos
			}
			continue
		}
		pos++
	}
	return -1
}

func splitTopLevelTemplateParams(body string) []string {
	var params []string
	var cur strings.Builder
	braceDepth := 0
	bracketDepth := 0
	i := 0
	for i < len(body) {
		if strings.HasPrefix(body[i:], "{{") {
			braceDepth++
			cur.WriteString("{{")
			i += 2
			continue
		}
		if strings.HasPrefix(body[i:], "}}") {
			if braceDepth > 0 {
				braceDepth--
			}
			cur.WriteString("}}")
			i += 2
			continue
		}
		if strings.HasPrefix(body[i:], "[[") {
			bracketDepth++
			cur.WriteString("[[")
			i += 2
			continue
		}
		if strings.HasPrefix(body[i:], "]]") {
			if bracketDepth > 0 {
				bracketDepth--
			}
			cur.WriteString("]]")
			i += 2
			continue
		}
		if body[i] == '|' && braceDepth == 0 && bracketDepth == 0 {
			params = append(params, cur.String())
			cur.Reset()
			i++
			continue
		}
		cur.WriteByte(body[i])
		i++
	}
	params = append(params, cur.String())
	return params
}

func parseHTMLColorSpanAt(s string, legendColors map[string]string) (role, inner string, consumed int, ok bool) {
	openEnd := strings.IndexByte(s, '>')
	if openEnd < 0 {
		return "", "", 0, false
	}
	openTag := s[:openEnd+1]
	// 仅在包含闭合 </span> 时解析
	closeIdx := findMatchingCloseSpan(s, openEnd+1)
	if closeIdx < 0 {
		return "", "", 0, false
	}
	resolved := resolveLegendColorFromAttr(openTag, legendColors)
	if resolved == "" {
		// 尝试查看 title 属性（部分 wiki 在 wikitext 内使用 <span title="Role">）
		if m := regexp.MustCompile(`(?i)title=["']([^"']{1,40})["']`).FindStringSubmatch(openTag); len(m) == 2 {
			resolved = normalizeVocalRoleName(m[1])
		}
	}
	return resolved, s[openEnd+1 : closeIdx], closeIdx + len("</span>"), true
}

func findMatchingCloseSpan(s string, pos int) int {
	lower := strings.ToLower(s)
	depth := 1
	for pos < len(s) {
		nextOpen := strings.Index(lower[pos:], "<span")
		nextClose := strings.Index(lower[pos:], "</span>")
		if nextClose < 0 {
			return -1
		}
		if nextOpen >= 0 && nextOpen < nextClose {
			depth++
			pos += nextOpen + 5
			continue
		}
		depth--
		pos += nextClose
		if depth == 0 {
			return pos
		}
		pos += 7
	}
	return -1
}

type roleTextSegment struct {
	role string
	text string
}

func extractInlineColorOrTemplateSegments(line, defaultRole string, legendColors map[string]string) []roleTextSegment {
	// 通过轻量化解析收集一行中不同 {{模板}} 或 <span style="color:..."> 的角色归属
	var segs []roleTextSegment
	var localBuf strings.Builder
	flush := func(r string) {
		txt := cleanLyricSegmentText(stripWikiInlineNoise(localBuf.String()))
		localBuf.Reset()
		if txt == "" {
			return
		}
		if r == "" {
			r = defaultRole
		}
		segs = append(segs, roleTextSegment{role: r, text: txt})
	}

	i := 0
	for i < len(line) {
		if strings.HasPrefix(line[i:], "{{") {
			if end := findBalancedTemplateEnd(line, i); end > i {
				tplBody := line[i+2 : end-2]
				params := splitTopLevelTemplateParams(tplBody)
				if len(params) >= 2 {
					head := strings.TrimSpace(params[0])
					lowerHead := strings.ToLower(head)
					if lowerHead == "ruby" || lowerHead == "rb" || lowerHead == "photrans" {
						localBuf.WriteString(params[1])
						i = end
						continue
					}
					if lowerHead == "shared" || lowerHead == "all" {
						flush(defaultRole)
						segs = append(segs, extractInlineColorOrTemplateSegments(strings.Join(params[1:], "|"), "合唱", legendColors)...)
						i = end
						continue
					}
					if lowerHead == "color" || lowerHead == "colore" {
						flush(defaultRole)
						r := legendColors[canonicalColorKey(params[1])]
						if r == "" {
							r = defaultRole
						}
						segs = append(segs, extractInlineColorOrTemplateSegments(strings.Join(params[2:], "|"), r, legendColors)...)
						i = end
						continue
					}
					if !isNonRoleName(head) {
						if r := normalizeVocalRoleName(head); r != "" {
							flush(defaultRole)
							segs = append(segs, extractInlineColorOrTemplateSegments(strings.Join(params[1:], "|"), r, legendColors)...)
							i = end
							continue
						}
					}
				}
				i = end
				continue
			}
		}
		if strings.HasPrefix(strings.ToLower(line[i:]), "<span") {
			if r, inner, consumed, ok := parseHTMLColorSpanAt(line[i:], legendColors); ok {
				flush(defaultRole)
				if r == "" {
					r = defaultRole
				}
				segs = append(segs, extractInlineColorOrTemplateSegments(inner, r, legendColors)...)
				i += consumed
				continue
			}
		}
		localBuf.WriteByte(line[i])
		i++
	}
	flush(defaultRole)
	return segs
}

func stripWikiInlineNoise(s string) string {
	s = reCleanWikiComment.ReplaceAllString(s, "")
	s = reCleanWikiRef.ReplaceAllString(s, "")
	// 处理 <ruby>漢字<rt>かんじ</rt></ruby> 为仅保留基字
	s = regexp.MustCompile(`(?is)<r[tp][^>]*>.*?</r[tp]>`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`(?is)</?(?:ruby|rb|span|div|font|b|i|strong|em|u|s|small|big|sup|sub|p|center)[^>]*>`).ReplaceAllString(s, "")
	// 处理维基内链与加粗斜体标记
	s = reCleanWikiLink.ReplaceAllString(s, "$1")
	s = reCleanExtLink.ReplaceAllString(s, "$1")
	s = strings.ReplaceAll(s, "'''", "")
	s = strings.ReplaceAll(s, "''", "")
	s = html.UnescapeString(s)
	return s
}

func cleanLyricSegmentText(s string) string {
	s = reCleanZeroWidth.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	// 去除末尾误带入的孤立表格符号
	s = strings.TrimPrefix(s, "•")
	s = strings.TrimSpace(s)
	s = reCleanSpaceCollapse.ReplaceAllString(s, " ")
	return s
}

// ---------- HTML / 萌娘百科 DOM 解析器 ----------

func findMoegirlContentRoot(doc *nethtml.Node) *nethtml.Node {
	var found *nethtml.Node
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if found != nil {
			return
		}
		if n.Type == nethtml.ElementNode && hasHTMLClass(n, "mw-parser-output") {
			found = n
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return found
}

func hasHTMLClass(n *nethtml.Node, target string) bool {
	if n == nil || n.Type != nethtml.ElementNode {
		return false
	}
	for _, a := range n.Attr {
		if a.Key == "class" {
			for _, cls := range strings.Fields(a.Val) {
				if cls == target {
					return true
				}
			}
		}
	}
	return false
}

func getHTMLAttr(n *nethtml.Node, key string) string {
	if n == nil {
		return ""
	}
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return a.Val
		}
	}
	return ""
}

func shouldSkipHTMLNode(n *nethtml.Node) bool {
	if n == nil || n.Type != nethtml.ElementNode {
		return false
	}
	switch strings.ToLower(n.Data) {
	case "script", "style", "rt", "rp", "noscript", "nav", "header", "footer", "aside":
		return true
	}
	for _, cls := range []string{"Lyrics-translated", "template-ruby-hidden", "navbox", "infobox", "toc", "mw-editsection", "reference", "noprint"} {
		if hasHTMLClass(n, cls) {
			return true
		}
	}
	return false
}

func collectNodesByClass(root *nethtml.Node, cls string, out *[]*nethtml.Node) {
	if root == nil || shouldSkipHTMLNode(root) {
		return
	}
	if root.Type == nethtml.ElementNode && hasHTMLClass(root, cls) {
		*out = append(*out, root)
		return
	}
	for c := root.FirstChild; c != nil; c = c.NextSibling {
		collectNodesByClass(c, cls, out)
	}
}

func extractHTMLColorLegend(root *nethtml.Node) map[string]string {
	legend := make(map[string]string)
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if n == nil || shouldSkipHTMLNode(n) {
			return
		}
		if n.Type == nethtml.ElementNode {
			// 在正文非 Lyrics-original 区域搜集短色块说明（例如 <span style="color:#33CCBB">初音未来</span>）
			if !hasHTMLClass(n, "Lyrics-line") && !hasHTMLClass(n, "Lyrics-original") {
				colorKey := ""
				if m := reCleanColorStyle.FindStringSubmatch(getHTMLAttr(n, "style")); len(m) == 2 {
					colorKey = canonicalColorKey(m[1])
				} else if cAttr := getHTMLAttr(n, "color"); cAttr != "" {
					colorKey = canonicalColorKey(cAttr)
				}
				if colorKey != "" {
					txt := strings.TrimSpace(collectDirectOrShortText(n))
					addLegendEntry(legend, colorKey, txt)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return legend
}

func collectDirectOrShortText(n *nethtml.Node) string {
	var b strings.Builder
	var walk func(cur *nethtml.Node)
	walk = func(cur *nethtml.Node) {
		if cur == nil || shouldSkipHTMLNode(cur) || b.Len() > 160 {
			return
		}
		if cur.Type == nethtml.TextNode {
			b.WriteString(cur.Data)
			return
		}
		for c := cur.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return cleanLyricSegmentText(b.String())
}

func extractMoegirlOriginalLineSegments(lineNode *nethtml.Node, legendColors map[string]string) []roleTextSegment {
	var segs []roleTextSegment
	var walk func(n *nethtml.Node, curRole string)
	walk = func(n *nethtml.Node, curRole string) {
		if n == nil || shouldSkipHTMLNode(n) {
			return
		}
		if n.Type == nethtml.TextNode {
			txt := n.Data
			if strings.TrimSpace(txt) != "" {
				segs = append(segs, roleTextSegment{role: curRole, text: txt})
			}
			return
		}
		nextRole := curRole
		if n.Type == nethtml.ElementNode {
			// 1) 优先读取 span[title]（现代萌百 {{LyricsKai}} / {{Photrans}} 会打在 NoTitlebox span 上）
			if title := strings.TrimSpace(getHTMLAttr(n, "title")); title != "" && !strings.EqualFold(n.Data, "ruby") && !strings.EqualFold(n.Data, "rb") {
				if parsed := normalizeVocalRoleName(title); parsed != "" {
					nextRole = parsed
				}
			}
			// 2) 回退读取内联 style="color:#HEX"
			if nextRole == curRole {
				if m := reCleanColorStyle.FindStringSubmatch(getHTMLAttr(n, "style")); len(m) == 2 {
					if mapped, ok := legendColors[canonicalColorKey(m[1])]; ok {
						nextRole = mapped
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, nextRole)
		}
	}
	walk(lineNode, "")

	// 合并同一角色在同一行里的连续碎片文本
	var merged []roleTextSegment
	for _, seg := range segs {
		if len(merged) > 0 && merged[len(merged)-1].role == seg.role {
			merged[len(merged)-1].text += seg.text
		} else {
			merged = append(merged, seg)
		}
	}
	return merged
}

func collectMoegirlPoemOrColorBlocks(root *nethtml.Node, out *[]*nethtml.Node) {
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if n == nil || shouldSkipHTMLNode(n) {
			return
		}
		if n.Type == nethtml.ElementNode {
			if hasHTMLClass(n, "poem") || strings.EqualFold(n.Data, "p") {
				*out = append(*out, n)
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
}

func extractHTMLColorOrBracketLines(node *nethtml.Node, legendColors map[string]string) []roleTextSegment {
	var lines []roleTextSegment
	var curRole string
	var bracketRole string
	var curLine strings.Builder

	flushLine := func() {
		txt := cleanLyricSegmentText(curLine.String())
		curLine.Reset()
		if txt == "" {
			return
		}
		// 若行首是 [Role] / 【Role】，更新括号继承角色并剥离前缀；纯段落标记 `[Chorus]` 直接跳过
		if m := reCleanHeaderBracketLine.FindStringSubmatch(txt); len(m) == 4 {
			inner := strings.TrimSpace(m[1])
			if inner == "" {
				inner = strings.TrimSpace(m[2])
			}
			rest := strings.TrimSpace(strings.TrimLeft(m[3], ":： \t\u3000"))
			if parsed, secOnly := parseBracketRoleToken(inner); secOnly {
				if rest != "" && curRole != "" {
					lines = append(lines, roleTextSegment{role: curRole, text: rest})
				}
				return
			} else if parsed != "" {
				curRole = parsed
				bracketRole = parsed
				if rest != "" {
					lines = append(lines, roleTextSegment{role: parsed, text: rest})
				}
				return
			}
		}
		lines = append(lines, roleTextSegment{role: curRole, text: txt})
	}

	var walk func(n *nethtml.Node, activeRole string)
	walk = func(n *nethtml.Node, activeRole string) {
		if n == nil || shouldSkipHTMLNode(n) {
			return
		}
		if n.Type == nethtml.TextNode {
			parts := strings.Split(strings.ReplaceAll(n.Data, "\r\n", "\n"), "\n")
			for idx, part := range parts {
				if idx > 0 {
					flushLine()
				}
				if part != "" {
					if activeRole != "" {
						bracketRole = ""
						if curLine.Len() == 0 {
							curRole = activeRole
						} else if activeRole != curRole && strings.TrimSpace(part) != "" {
							flushLine()
							curRole = activeRole
						}
					} else if curLine.Len() == 0 {
						curRole = bracketRole
					}
					curLine.WriteString(part)
				}
			}
			return
		}

		nextRole := activeRole
		isBlock := false
		if n.Type == nethtml.ElementNode {
			tag := strings.ToLower(n.Data)
			if tag == "br" {
				flushLine()
				return
			}
			isBlock = tag == "p" || tag == "div" || tag == "li" || tag == "tr"
			if title := strings.TrimSpace(getHTMLAttr(n, "title")); title != "" && tag != "ruby" && tag != "rb" {
				if parsed := normalizeVocalRoleName(title); parsed != "" {
					nextRole = parsed
				}
			}
			if nextRole == activeRole {
				if m := reCleanColorStyle.FindStringSubmatch(getHTMLAttr(n, "style")); len(m) == 2 {
					if mapped, ok := legendColors[canonicalColorKey(m[1])]; ok {
						nextRole = mapped
					}
				} else if cAttr := getHTMLAttr(n, "color"); cAttr != "" {
					if mapped, ok := legendColors[canonicalColorKey(cAttr)]; ok {
						nextRole = mapped
					}
				}
			}
		}

		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, nextRole)
		}
		if isBlock {
			flushLine()
		}
	}
	walk(node, "")
	flushLine()
	return lines
}

func extractPlainTextLinesFromHTML(root *nethtml.Node) string {
	var b strings.Builder
	var walk func(n *nethtml.Node)
	walk = func(n *nethtml.Node) {
		if n == nil || shouldSkipHTMLNode(n) {
			return
		}
		if n.Type == nethtml.TextNode {
			b.WriteString(n.Data)
			return
		}
		if n.Type == nethtml.ElementNode {
			tag := strings.ToLower(n.Data)
			if tag == "br" {
				b.WriteByte('\n')
				return
			}
			isBlock := tag == "p" || tag == "div" || tag == "li" || tag == "tr" || tag == "h1" || tag == "h2" || tag == "h3" || tag == "h4"
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
			if isBlock {
				b.WriteByte('\n')
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return b.String()
}

// ---------- 后处理合并与零幻觉验证 ----------

// mergeConsecutiveVocalBlocks 合并连续相同的 `[角色名]:` 分块，清理空行与过长空白
func mergeConsecutiveVocalBlocks(text string) string {
	text = normalizeLineBreaks(reCleanZeroWidth.ReplaceAllString(text, ""))
	lines := strings.Split(text, "\n")

	type vocalBlock struct {
		role  string
		lines []string
	}
	var blocks []vocalBlock
	curIdx := -1

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if m := reCleanNormalizedBlock.FindStringSubmatch(line); len(m) == 2 {
			role := normalizeVocalRoleName(m[1])
			if role == "" {
				curIdx = -1
				continue
			}
			if curIdx >= 0 && blocks[curIdx].role == role {
				continue
			}
			blocks = append(blocks, vocalBlock{role: role})
			curIdx = len(blocks) - 1
			continue
		}
		if curIdx >= 0 && !reCleanCreditLine.MatchString(line) {
			blocks[curIdx].lines = append(blocks[curIdx].lines, line)
		}
	}

	// 二次折叠（某些空块被剔除后前后相邻块可能变为相同角色）
	var compact []vocalBlock
	for _, blk := range blocks {
		if len(blk.lines) == 0 {
			continue
		}
		if len(compact) > 0 && compact[len(compact)-1].role == blk.role {
			compact[len(compact)-1].lines = append(compact[len(compact)-1].lines, blk.lines...)
		} else {
			compact = append(compact, blk)
		}
	}

	var b strings.Builder
	for idx, blk := range compact {
		if idx > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString("[")
		b.WriteString(blk.role)
		b.WriteString("]:\n")
		b.WriteString(strings.Join(blk.lines, "\n"))
	}
	return reCleanNewlineCollapse.ReplaceAllString(b.String(), "\n\n")
}

func inspectNormalizedVocalBlocks(cleaned string) (distinctSingers int, tagSwitches int, lyricLines []string) {
	if strings.TrimSpace(cleaned) == "" {
		return 0, 0, nil
	}
	singers := make(map[string]bool)
	for _, raw := range strings.Split(cleaned, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if m := reCleanNormalizedBlock.FindStringSubmatch(line); len(m) == 2 {
			tagSwitches++
			roleTag := strings.TrimSpace(m[1])
			// 拆开联合演唱标记以确认是否真的存在 >=2 名独立歌唱角色或合唱切换
			parts := reCleanMultiSep.Split(roleTag, -1)
			addedSub := false
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if p != "" {
					singers[p] = true
					addedSub = true
				}
			}
			if !addedSub && roleTag != "" {
				singers[roleTag] = true
			}
			continue
		}
		lyricLines = append(lyricLines, line)
	}
	return len(singers), tagSwitches, lyricLines
}

func countDistinctSingersInNormalized(cleaned string) int {
	n, _, _ := inspectNormalizedVocalBlocks(cleaned)
	return n
}

func computeVocalLyricOverlap(cleanLyricLines []string, q *VocalSearchQuery) int {
	if q == nil || len(q.LyricsLines) == 0 || len(cleanLyricLines) == 0 {
		return 0
	}
	var cleanNorms []string
	for _, line := range cleanLyricLines {
		norm := normalizeLyricMatch(line)
		if len([]rune(norm)) >= vocalWebSearchMinOverlapLen {
			cleanNorms = append(cleanNorms, norm)
		}
	}
	if len(cleanNorms) == 0 {
		return 0
	}

	var trackNorms []string
	for _, line := range q.LyricsLines {
		norm := normalizeLyricMatch(line)
		if len([]rune(norm)) >= vocalWebSearchMinOverlapLen {
			trackNorms = append(trackNorms, norm)
		}
	}
	if len(trackNorms) == 0 {
		return 0
	}

	// 去重计算命中的曲目歌词行数
	sort.Strings(cleanNorms)
	matched := 0
	for _, t := range trackNorms {
		for _, c := range cleanNorms {
			if eitherContains(t, c) {
				matched++
				break
			}
		}
	}
	return matched
}

func verifyVocalLyricOverlap(cleanLyricLines []string, overlapScore, priority int, q *VocalSearchQuery) bool {
	if q == nil || len(q.LyricsLines) == 0 {
		return true
	}
	if overlapScore >= vocalSearchMinOverlapLines {
		return true
	}

	trackCJKRatio := calcCJKLineRatio(q.LyricsLines)
	cleanCJKRatio := calcCJKLineRatio(cleanLyricLines)

	// 双方均主要为同语系脚本（同为日/中文，或同为拉丁英文）时却一行都不重合 -> 必然命中同名异曲（如 Crazy ∞ nighT 误命中 CRAZY）
	if (trackCJKRatio >= 0.25 && cleanCJKRatio >= 0.25) || (trackCJKRatio < 0.10 && cleanCJKRatio < 0.10) {
		return false
	}

	// 跨脚本情况（原歌词是日文假名/汉字，Wiki 仅收录罗马音分色如 Blessing/Connecting）：
	// 仅信任已通过严格标题核验的高优先级权威 Wiki/同曲库来源（Priority >= 70），拒绝低权重公网搜索误匹配
	return priority >= 70
}

func calcCJKLineRatio(lines []string) float64 {
	if len(lines) == 0 {
		return 0
	}
	cjk := 0
	for _, l := range lines {
		if reVocalCJK.MatchString(l) {
			cjk++
		}
	}
	return float64(cjk) / float64(len(lines))
}

var pjskHumanCharacters = []string{
	"星乃一歌", "天马咲希", "天馬咲希", "望月穗波", "望月穂波", "日野森志步", "日野森志歩",
	"花里实乃里", "花里みのり", "桐谷遥", "桃井爱莉", "桃井愛莉", "日野森雫",
	"小豆泽心羽", "小豆沢こはね", "白石杏", "东云彰人", "東雲彰人", "青柳冬弥",
	"天马司", "天馬司", "凤笑梦", "鳳えむ", "草薙宁宁", "草薙寧々", "神代类", "神代類",
	"宵崎奏", "朝比奈真冬", "朝比奈まふゆ", "东云绘名", "東雲絵名", "晓山瑞希", "暁山瑞希",
}

func containsPJSKHumanCharacter(cleaned string) bool {
	for _, raw := range strings.Split(cleaned, "\n") {
		line := strings.TrimSpace(raw)
		m := reCleanNormalizedBlock.FindStringSubmatch(line)
		if len(m) != 2 {
			continue
		}
		roleHeader := m[1]
		for _, human := range pjskHumanCharacters {
			if strings.Contains(roleHeader, human) {
				return true
			}
		}
	}
	return false
}

func normalizeLineBreaks(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
}
