package agentrunner

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/dto"
)

// 评论的后处理，减少「一眼就是 AI」的痕迹，参考 AstrBot 的拟人化插件（wanna_be_human、AngelHeart、group_chat_plus）：
//   - 本地清理格式上的痕迹：Markdown、整段包着的引号、破折号、多余空行；按设定里的示例决定是否保留句号和 emoji；
//   - 检查常见的 AI 腔（客套、总结、固定句式、元叙述、先肯定再转折、过长），命中时让模型按设定重写一次

var (
	markdownEmphasis = regexp.MustCompile(`\*\*(.+?)\*\*|__(.+?)__`)
	markdownCode     = regexp.MustCompile("`([^`]*)`")
	listMarker       = regexp.MustCompile(`(?m)^[ \t]*(?:[-*•]|\d+[.、)）])[ \t]+`)
	headingMarker    = regexp.MustCompile(`(?m)^[ \t]*#{1,6}[ \t]+`)
	blankLines       = regexp.MustCompile(`\n[ \t]*\n+`)
	emojiPattern     = regexp.MustCompile(`[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B50}\x{2B55}\x{FE0F}\x{200D}]`)
	quotePairs       = [][2]string{{"“", "”"}, {"\"", "\""}, {"「", "」"}, {"『", "』"}, {"‘", "’"}, {"'", "'"}}
)

type toneTell struct {
	name string
	re   *regexp.Regexp
}

// aiToneTells 常见的 AI 腔；名称会原样告诉模型。清单参考 op7418/humanizer-zh（MIT，源自 blader/humanizer），
// 只取能稳定用正则判定、误伤少的那几条；命中只是线索，不是修改命令（见 rewritePrompt）
var aiToneTells = []toneTell{
	{"客套话", regexp.MustCompile(`感谢(你的|您的|楼主|博主|作者)?分享|学到了|受益(匪浅|良多)|(写|讲|总结|分析)得(真|很|非常|太|好)?(好|棒|到位|清晰|透彻|详细)([^听]|$)`)},
	{"总结和强调用语", regexp.MustCompile(`值得(一提|注意)的是|需要(注意|指出)的是|不难发现|归根结底|一言以蔽之|总的来说|总而言之|综上所述|总之[，,]`)},
	{"固定句式（不仅……而且、不是……而是、一方面……另一方面）", regexp.MustCompile(`不仅[^。！？\n]{1,24}而且|不仅[^，。！？\n]{1,20}(还|更)|不是[^，。！？\n]{1,12}而是|一方面[^。！？\n]*另一方面|首先[^。！？\n]*其次`)},
	{"讲道理的腔调（从……角度来看、让人深思）", regexp.MustCompile(`从[^，。！？\n]{1,12}(角度|层面|维度)(来看|而言|出发|看)|让人(深思|反思|感慨|动容)|这让我(想到|想起)`)},
	{"元叙述（看完这篇、作为一个）", regexp.MustCompile(`(看|读)完(这篇|文章|你的|了这篇)|作为一(个|名)|我注意到`)},
	{"客套收尾（希望、期待、加油）", regexp.MustCompile(`希望[^，。！？\n]{0,20}(帮助|有用|继续)|期待(更多|后续|下一篇|你的)|加油[！!～~]*$`)},
	{"先肯定再转折", regexp.MustCompile(`^[^，。！？\n]{0,16}(挺|很|真|确实|非常)(对|好|有道理|实用|到位|中肯|准确)[的啊呀]?[，,](不过|但是?|只是)`)},
	{"拔高和宣传语（标志着、彰显、堪称）", regexp.MustCompile(`彰显|堪称|被誉为|前所未有|里程碑(式|性)?的?|标志(着|了)[^。！？\n]{0,12}(时代|阶段|新篇|里程碑|转折|开端)|奠定(了)?[^。！？\n]{0,6}基础|完美的?(结合|诠释|演绎|融合)`)},
	{"起跑式铺垫（让我们、下面来看看）", regexp.MustCompile(`让我们(一起)?(深入|来看|看看|聊聊)|下面(是|我们|你)(需要|要)?(了解|知道|看看|聊聊)|接下来(我们)?(一起)?(看看|聊聊|说说)`)},
	{"时代背景开场（随着……的发展）", regexp.MustCompile(`^(随着|在当今|在这个)[^，。！？\n]{0,20}(发展|时代|背景)`)},
	{"客服腔开头（好问题、问得好）", regexp.MustCompile(`^(好问题|这个问题问得好|问得好|很好的问题)`)},
	{"公文腔（进行测试、进行优化）", regexp.MustCompile(`进行(全面|系统|深入|详细)?(的)?(测试|优化|调整|分析|评估|梳理|改造|处理)`)},
	{"借权威（专家认为、研究表明）", regexp.MustCompile(`(专家|学者|研究人员|业界)(认为|指出|表示|发现)|研究表明|数据显示[^，。！？\n]{0,8}(证明|充分)`)},
	{"免责式收尾（仅供参考、资料有限）", regexp.MustCompile(`仅(供|作)参考|仅供参考|资料(有限|不全)|以上(内容)?仅(供|作)参考`)},
}

// cleanComment 清理评论里格式上的 AI 痕迹；samples 为设定里的示例评论，用来判断这个人平时用不用句号和 emoji
func cleanComment(content string, samples []string) string {
	s := unwrapQuotes(strings.TrimSpace(content))
	s = markdownEmphasis.ReplaceAllString(s, "$1$2")
	s = markdownCode.ReplaceAllString(s, "$1")
	s = headingMarker.ReplaceAllString(s, "")
	s = listMarker.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "——", "，")
	s = strings.ReplaceAll(s, "，，", "，")
	s = blankLines.ReplaceAllString(s, "\n")
	if !anySample(samples, emojiPattern.MatchString) {
		s = emojiPattern.ReplaceAllString(s, "")
	}
	s = strings.TrimSpace(strings.TrimRight(strings.TrimSpace(s), "，,"))
	if !usesFullStop(samples) {
		s = strings.TrimSuffix(s, "。")
	}
	return strings.TrimSpace(s)
}

func unwrapQuotes(s string) string {
	for _, q := range quotePairs {
		inner := strings.TrimSuffix(strings.TrimPrefix(s, q[0]), q[1])
		if len(inner) < len(s)-len(q[0])-len(q[1])+1 && !strings.Contains(inner, q[0]) && !strings.Contains(inner, q[1]) {
			return strings.TrimSpace(inner)
		}
	}
	return s
}

func anySample(samples []string, match func(string) bool) bool {
	for _, s := range samples {
		if match(s) {
			return true
		}
	}
	return false
}

// usesFullStop 示例里多数以句号结尾时保留句号；没有示例时按网友的常见习惯去掉
func usesFullStop(samples []string) bool {
	count := 0
	for _, s := range samples {
		if strings.HasSuffix(strings.TrimSpace(s), "。") {
			count++
		}
	}
	return count*2 > len(samples)
}

// toneIssues 评论命中的 AI 腔；专业型允许写得长一些
func toneIssues(content, tier string) []string {
	var issues []string
	for _, t := range aiToneTells {
		if t.re.MatchString(content) {
			issues = append(issues, t.name)
		}
	}
	limit := 100
	if tier == "expert" {
		limit = 200
	}
	if n := utf8.RuneCountInString(content); n > limit {
		issues = append(issues, fmt.Sprintf("太长（%d 字），像在写短文", n))
	}
	return issues
}

// humanizeActions 清理评论与回复；清理后为空的不再发表。返回仍带有 AI 腔的评论，供模型重写
func humanizeActions(actions []dto.AgentActionDto, samples []string, tier string) ([]dto.AgentActionDto, []string) {
	kept := actions[:0]
	var issues []string
	for _, a := range actions {
		if a.Type == "comment" || a.Type == "reply" {
			a.Content = cleanComment(a.Content, samples)
			if a.Content == "" {
				continue
			}
			if found := toneIssues(a.Content, tier); len(found) > 0 {
				issues = append(issues, fmt.Sprintf("- %s：%s（问题：%s）", a.Target, a.Content, strings.Join(found, "、")))
			}
		}
		kept = append(kept, a)
	}
	return kept, issues
}

// rewritePrompt 要求模型按设定重写带 AI 腔的评论。命中只是线索：humanizer-zh 的「单个词不是修改理由」同样适用，
// 否则正则会把作者真实的夸奖与判断一起删掉
func rewritePrompt(issues []string) string {
	return "下面这些评论 AI 味太重，读者一眼就能看出不是真人写的：\n" + strings.Join(issues, "\n") +
		"\n按你的设定重写这些评论：只说一个点，更短、更随意，去掉客套、总结和固定句式；觉得没什么可说，也可以把它从 actions 里删掉。" +
		"命中只是线索：原文本来就这么说、或者这句读着自然时不要改，也不要为了去掉痕迹删掉真实的信息和判断。" +
		"其他动作保持不变，仍然只输出任务说明里的那个 JSON 对象。"
}
