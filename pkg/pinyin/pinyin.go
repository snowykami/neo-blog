package pinyin

import (
	"slices"
	"strings"
	"unicode"

	gopinyin "github.com/mozillazg/go-pinyin"
)

const (
	// maxInputRunes 参与拼音转换的最大字符数（拼音只用于标题、昵称、分类、标签等短字段）
	maxInputRunes = 120
	// maxInitialVariants 多音字首字母最多保留的组合数，防止多音字排列组合膨胀
	maxInitialVariants = 4
	// suffixWindowTokens 滑动连写窗口最大词元数：利用 Meilisearch 前缀检索覆盖标题中间任意词组连写（如搜 chongqing / huancun）
	suffixWindowTokens = 6
)

var (
	normalArgs = func() gopinyin.Args {
		a := gopinyin.NewArgs()
		a.Style = gopinyin.Normal
		return a
	}()
	heteronymArgs = func() gopinyin.Args {
		a := gopinyin.NewArgs()
		a.Style = gopinyin.Normal
		a.Heteronym = true
		return a
	}()
)

type token struct {
	isHan     bool
	syllables []string // isHan=true 时为该字可能的无调拼音（去重后，首个为默认读音）；isHan=false 时仅一项为连续字母数字词
}

// Derive 为包含汉字的短文本生成拼音检索字段：
//   - full：空格分隔的全拼 + 紧凑连写全拼（如「Neo博客」→「neo bo ke neoboke」），便于前缀搜索与分词匹配
//   - initials：拼音首字母缩写（含中英混合整体首字母与纯汉字首字母，短文本兼容常见多音字首字母，如「重庆」→「zq cq」）
//
// 不含汉字的纯英文 / 数字文本返回空字符串，避免产生冗余的二字母缩写噪音。
func Derive(text string) (full string, initials string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", ""
	}
	runes := []rune(text)
	if len(runes) > maxInputRunes {
		runes = runes[:maxInputRunes]
	}

	tokens, hasHan := tokenize(runes)
	if !hasHan || len(tokens) == 0 {
		return "", ""
	}

	// 1. 全拼：空格分词形式 + 整句紧凑连写 + 滑动后缀连写（含常见多音字读音，支持从标题任意词组开头输入连写拼音）
	primaryParts := make([]string, 0, len(tokens))
	for _, tk := range tokens {
		primaryParts = append(primaryParts, tk.syllables[0])
	}
	spaced := strings.Join(primaryParts, " ")
	compact := strings.Join(primaryParts, "")
	fullVariants := []string{spaced}
	if compact != spaced && len(primaryParts) > 1 {
		fullVariants = append(fullVariants, compact)
	}
	// 补充多音字备选单字读音（支持空格分词查询如 "chong qing"）
	for _, tk := range tokens {
		for _, alt := range tk.syllables[1:] {
			if !slices.Contains(primaryParts, alt) && !slices.Contains(fullVariants, alt) {
				fullVariants = append(fullVariants, alt)
			}
		}
	}
	// 纯汉字部分单独连写（中英混排标题如「Go语言实战」搜「yuyanshizhan」也能前缀命中）
	var hanOnlyParts []string
	hasNonHan := false
	for _, tk := range tokens {
		if tk.isHan {
			hanOnlyParts = append(hanOnlyParts, tk.syllables[0])
		} else {
			hasNonHan = true
		}
	}
	if hasNonHan && len(hanOnlyParts) > 1 {
		hanCompact := strings.Join(hanOnlyParts, "")
		if !slices.Contains(fullVariants, hanCompact) {
			fullVariants = append(fullVariants, hanCompact)
		}
	}
	// 滑动后缀连写窗口：让句中词组（如「深入理解重庆分布式缓存」中的 chongqing / fenbushi / huancun）都能被前缀匹配命中
	for _, w := range buildCompactWindows(tokens) {
		if !slices.Contains(fullVariants, w) {
			fullVariants = append(fullVariants, w)
		}
	}
	full = strings.Join(fullVariants, " ")

	// 2. 首字母：整体首字母（支持有限多音字展开）+ 纯汉字首字母 + 句中词组后缀首字母（至少 3 字母，避免二字母噪音）
	initSet := buildInitialVariants(tokens)
	if hasNonHan && len(hanOnlyParts) >= 2 {
		hanTokens := make([]token, 0, len(hanOnlyParts))
		for _, tk := range tokens {
			if tk.isHan {
				hanTokens = append(hanTokens, tk)
			}
		}
		for _, v := range buildInitialVariants(hanTokens) {
			if !slices.Contains(initSet, v) && len(initSet) < maxInitialVariants+2 {
				initSet = append(initSet, v)
			}
		}
	}
	for i := 1; i < len(tokens) && len(tokens)-i >= 3; i++ {
		end := min(len(tokens), i+suffixWindowTokens)
		for _, v := range buildInitialVariants(tokens[i:end]) {
			if len(v) >= 3 && !slices.Contains(initSet, v) {
				initSet = append(initSet, v)
			}
		}
	}
	// 过滤掉单字符首字母（单字不靠首字母缩写检索，防止单字母泛匹配）
	filteredInit := initSet[:0]
	for _, v := range initSet {
		if len(v) >= 2 {
			filteredInit = append(filteredInit, v)
		}
	}
	initials = strings.Join(filteredInit, " ")
	return full, initials
}

// DeriveSlice 为一组短文本（如标签列表）合并生成去重后的全拼与首字母文本
func DeriveSlice(items []string) (full string, initials string) {
	var fullParts, initParts []string
	for _, item := range items {
		f, ini := Derive(item)
		if f != "" && !slices.Contains(fullParts, f) {
			fullParts = append(fullParts, f)
		}
		if ini != "" && !slices.Contains(initParts, ini) {
			initParts = append(initParts, ini)
		}
	}
	return strings.Join(fullParts, " "), strings.Join(initParts, " ")
}

func tokenize(runes []rune) ([]token, bool) {
	var tokens []token
	var asciiBuf strings.Builder
	hasHan := false

	flushASCII := func() {
		if asciiBuf.Len() > 0 {
			tokens = append(tokens, token{isHan: false, syllables: []string{asciiBuf.String()}})
			asciiBuf.Reset()
		}
	}

	for _, r := range runes {
		if unicode.Is(unicode.Han, r) {
			flushASCII()
			pys := hanSyllables(r)
			if len(pys) > 0 {
				hasHan = true
				tokens = append(tokens, token{isHan: true, syllables: pys})
			}
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			asciiBuf.WriteRune(unicode.ToLower(r))
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			asciiBuf.WriteRune(unicode.ToLower(r))
		} else {
			flushASCII()
		}
	}
	flushASCII()
	return tokens, hasHan
}

func hanSyllables(r rune) []string {
	primary := gopinyin.SinglePinyin(r, normalArgs)
	all := gopinyin.SinglePinyin(r, heteronymArgs)
	var out []string
	for _, p := range append(primary, all...) {
		p = strings.ToLower(strings.TrimSpace(p))
		if p != "" && !slices.Contains(out, p) {
			out = append(out, p)
		}
		if len(out) >= 3 {
			break
		}
	}
	return out
}

func buildInitialVariants(tokens []token) []string {
	variants := []string{""}
	for _, tk := range tokens {
		var heads []byte
		for _, s := range tk.syllables {
			if len(s) == 0 {
				continue
			}
			b := s[0]
			if !slices.Contains(heads, b) {
				heads = append(heads, b)
			}
			if len(heads) >= 2 {
				break
			}
		}
		if len(heads) == 0 {
			continue
		}
		next := make([]string, 0, min(len(variants)*len(heads), maxInitialVariants))
		for _, prefix := range variants {
			for _, h := range heads {
				if len(next) >= maxInitialVariants {
					break
				}
				cand := prefix + string(h)
				if !slices.Contains(next, cand) {
					next = append(next, cand)
				}
			}
		}
		variants = next
	}
	return variants
}

// buildCompactWindows 为每个起始位置生成至多 suffixWindowTokens 长的连写拼音，首二词元展开常见多音字
func buildCompactWindows(tokens []token) []string {
	if len(tokens) < 2 {
		return nil
	}
	var out []string
	for i := 0; i < len(tokens)-1; i++ {
		end := min(len(tokens), i+suffixWindowTokens)
		win := tokens[i:end]
		cands := []string{""}
		for pos, tk := range win {
			limit := 1
			if pos < 2 && len(tk.syllables) > 1 {
				limit = min(len(tk.syllables), 2)
			}
			next := make([]string, 0, len(cands)*limit)
			for _, prefix := range cands {
				for _, syl := range tk.syllables[:limit] {
					next = append(next, prefix+syl)
				}
			}
			cands = next
		}
		for _, c := range cands {
			if !slices.Contains(out, c) {
				out = append(out, c)
			}
		}
	}
	return out
}
