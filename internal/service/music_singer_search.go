package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/utils"
	nethtml "golang.org/x/net/html"
)

// vocalSearchHTTPClient 复用 safefetch 的公网 + 代理 Fake-IP 策略，避免本地透明代理拦截萌百/外部站点同时保持防 SSRF 隔离
var vocalSearchHTTPClient = utils.NewSafeHTTPClient(utils.SafeClientOptions{
	Timeout:      15 * time.Second,
	MaxRedirects: 5,
	SafeTransportOptions: utils.SafeTransportOptions{
		SafeDialOptions: utils.SafeDialOptions{
			AllowAddr: utils.IsPublicOrFakeIPAddr,
		},
	},
})

func vocalSafeFetch(ctx context.Context, rawURL string, maxBytes int64, allowedTypes ...string) (*utils.SafeFetchResult, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if err := utils.CheckSafeURL(u, utils.SafeFetchAllowPrivate, utils.IsPublicOrFakeIPAddr); err != nil {
		if errors.Is(err, utils.ErrBlockedAddress) {
			return nil, errors.New("this address is not allowed (private or reserved network)")
		}
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	// 保持 neo-blog-agent UA，萌娘百科等站对桌面浏览器 UA 触发 WAF 403
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; neo-blog-agent/1.0)")
	resp, err := vocalSearchHTTPClient.Do(req)
	if err != nil {
		if errors.Is(err, utils.ErrBlockedAddress) {
			return nil, errors.New("this address is not allowed (private or reserved network)")
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	if len(allowedTypes) > 0 {
		ok := false
		for _, t := range allowedTypes {
			if strings.HasPrefix(contentType, t) {
				ok = true
				break
			}
		}
		if !ok {
			return nil, fmt.Errorf("unsupported content type %q", contentType)
		}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	result := &utils.SafeFetchResult{ContentType: contentType, FinalURL: resp.Request.URL.String()}
	if int64(len(body)) > maxBytes {
		body = body[:maxBytes]
		result.Truncated = true
	}
	result.Body = body
	return result, nil
}

// VocalEvidenceFormat 外部声部证据的原始文本形态
type VocalEvidenceFormat string

const (
	VocalEvidenceFormatNormalized  VocalEvidenceFormat = "normalized"
	VocalEvidenceFormatWikitext    VocalEvidenceFormat = "wikitext"
	VocalEvidenceFormatMoegirlHTML VocalEvidenceFormat = "moegirl_html"
	VocalEvidenceFormatBrackets    VocalEvidenceFormat = "brackets"
	VocalEvidenceFormatHTML        VocalEvidenceFormat = "html"
)

const (
	vocalSearchTotalTimeout     = 25 * time.Second
	vocalSearchPerSiteTimeout   = 6 * time.Second
	vocalSearchPerParseTimeout  = 8 * time.Second
	vocalSearchMinOverlapLines  = 1
	vocalWebSearchMinOverlapLen = 4
)

// VocalSearchQuery 标准化后的歌曲声部检索上下文
type VocalSearchQuery struct {
	SongID               int64
	RawTitle             string
	CleanTitle           string
	TitleVariants        []string
	NormTitle            string
	HasCJK               bool // CleanTitle 本身是否含假名/汉字（控制是否跳过英文 token 标题过滤）
	HasCJKContext        bool // 标题/艺人/歌词整体是否含假名或汉字
	HasMultiArtistHint   bool // 是否具备双人/多声部/组合倾向
	PrefersVirtualSinger bool // 是否显式指向虚拟歌手原曲而非翻唱企划版
	Artists              []string
	Aliases              []string
	Album                string
	Source               string
	LyricsLines          []string
}

// VocalEvidenceCandidate 单个搜索源返回的声部候选证据（及清洗核验后的结果）
type VocalEvidenceCandidate struct {
	ProviderID      string
	SourceName      string
	Title           string
	URL             string
	Format          VocalEvidenceFormat
	RawContent      string
	CleanContent    string
	DetectedSingers int
	DetectedTags    int
	Priority        int
	OverlapScore    int
}

// VocalEvidenceProvider 可扩展的多源声部检索提供方接口；后续新增资料源只需实现该接口并注册
type VocalEvidenceProvider interface {
	ID() string
	Match(q *VocalSearchQuery) int // 返回动态优先级；< 0 表示当前曲目不适用该源
	Search(ctx context.Context, q *VocalSearchQuery) ([]VocalEvidenceCandidate, error)
}

type siblingLyricText struct {
	Source  string
	RawText string
	Lines   []string
}

type mediaWikiSite struct {
	ID       string
	Name     string
	APIBase  string
	PageBase string
	RouteRe  *regexp.Regexp
	Priority int
}

var (
	reVocalCJK                 = regexp.MustCompile(`[\x{3040}-\x{309F}\x{30A0}-\x{30FF}\x{4E00}-\x{9FFF}]`)
	reVocalFeatSuffix          = regexp.MustCompile(`(?i)\s*[\(\[（【](?:feat\.?|ft\.?|featuring|with)\b[^\)\]）】]*[\)\]）】]`)
	reVocalVerSuffix           = regexp.MustCompile(`(?i)\s*[\(\[（【][^\]\)）】]*(?:\bver\.?|\bversion|\bsize|\bedit|人ver)[\)\]）】]`)
	reVocalPlainVerSuffix      = regexp.MustCompile(`(?i)\s+[\p{L}\p{N}*・·]+ver\.?$`)
	reVocalParenInner          = regexp.MustCompile(`[\(\[（【]([^\)\]）】]{2,60})[\)\]）】]`)
	reVocalWhitespace          = regexp.MustCompile(`\s+`)
	reVocalSongParen           = regexp.MustCompile(`(?i)\s*[\(\[](?:song|single|music|cover|lyric|lyrics)[\)\]]$`)
	reVocalWikiPartIndicator   = regexp.MustCompile(`(?i)\{\{(?:[A-Z][A-Za-z0-9\s_\-]*|multiccAlt|multicc|Lyric|color|colour|歌手色标)[^\|\}]*\||lyrics table class|style="color:`)
	reVocalWikiLyricsIndicator = regexp.MustCompile(`(?i)==\s*(?:Lyrics|歌詞|歌词)\s*==|(?:Japanese|Kanji|Kan|日本語|Romaji|Rōmaji)\s*=`)

	// 已知包含较多声部分配资料的多人组合/企划关键词
	reVocalKnownGroupArtist = regexp.MustCompile(`(?i)Leo/need|25時|ナイトコード|Vivid BAD|ワンダーランズ|ショウタイム|MORE MORE JUMP|プロジェクトセカイ|プロセカ|Roselia|Poppin'?Party|Afterglow|Pastel\*?Palettes|Morfonica|RAISE A SUILEN|MyGO|Ave Mujica|バンドリ|μ's|Aqours|虹ヶ咲|Liella|蓮ノ空|ラブライブ|結束バンド|放課後ティータイム|\bHTT\b|スタァライト|hololive|ホロライブ|にじさんじ|NIJISANJI|ウマ娘|チマメ隊|IDOLM@STER|アイドルマスター`)

	// PJSK 人类组合或人类角色名：出现时说明不是纯虚拟歌手版本
	reVocalSEKAIHuman = regexp.MustCompile(`(?i)Leo/need|25時|ナイトコード|Vivid BAD|ワンダーランズ|ショウタイム|MORE MORE JUMP|プロジェクトセカイ|プロセカ|星乃一歌|天馬咲希|望月穂波|日野森志歩|花里みのり|桐谷遥|桃井愛莉|日野森雫|小豆沢こはね|白石杏|東雲彰人|青柳冬弥|天馬司|鳳えむ|草薙寧々|神代類|宵崎奏|朝比奈まふゆ|東雲絵名|暁山瑞希`)

	// 虚拟歌手及常见 V 家 / 中文 VOCALOID P 主关键词
	reVocalVirtualSingerHint = regexp.MustCompile(`(?i)初音ミク|Hatsune Miku|鏡音リン|鏡音レン|Kagamine Rin|Kagamine Len|巡音ルカ|Megurine Luka|\bKAITO\b|\bMEIKO\b|\bGUMI\b|神威がくぽ|重音テト|音街ウナ|可不|星界|洛天依|言和|乐正绫|ひとしずく|やま△|halyosy|じーざす|\bGiga\b|\bilem\b|\bCOP\b|sasakure|syudou|ハチ|米津玄師|じん`)

	vocalTitlePunctReplacer = strings.NewReplacer(
		"！", "!", "？", "?", "～", "~", "：", ":", "；", ";",
		"（", "(", "）", ")", "【", "[", "】", "]", "　", " ",
		"’", "'", "‘", "'", "“", "\"", "”", "\"", "・", " ",
	)
)

var defaultMediaWikiSites = []mediaWikiSite{
	{
		ID:       "projectsekai",
		Name:     "Project SEKAI Fandom Wiki",
		APIBase:  "https://projectsekai.fandom.com/api.php",
		PageBase: "https://projectsekai.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)Leo/need|25時|ナイトコード|Vivid BAD|ワンダーランズ|ショウタイム|MORE MORE JUMP|プロジェクトセカイ|プロセカ|星乃一歌|天馬咲希|望月穂波|日野森志歩|花里みのり|桐谷遥|桃井愛莉|日野森雫|小豆沢こはね|白石杏|東雲彰人|青柳冬弥|天馬司|鳳えむ|草薙寧々|神代類|宵崎奏|朝比奈まふゆ|東雲絵名|暁山瑞希`),
		Priority: 95,
	},
	{
		ID:       "sekaipedia",
		Name:     "Sekaipedia Wiki",
		APIBase:  "https://www.sekaipedia.org/w/api.php",
		PageBase: "https://www.sekaipedia.org/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)Leo/need|25時|ナイトコード|Vivid BAD|ワンダーランズ|ショウタイム|MORE MORE JUMP|プロジェクトセカイ|プロセカ|星乃一歌|天馬咲希|望月穂波|日野森志歩|花里みのり|桐谷遥|桃井愛莉|日野森雫|小豆沢こはね|白石杏|東雲彰人|青柳冬弥|天馬司|鳳えむ|草薙寧々|神代類|宵崎奏|朝比奈まふゆ|東雲絵名|暁山瑞希`),
		Priority: 92,
	},
	{
		ID:       "vocaloidlyrics",
		Name:     "Vocaloid Lyrics Wiki (Miraheze)",
		APIBase:  "https://vocaloidlyrics.miraheze.org/w/api.php",
		PageBase: "https://vocaloidlyrics.miraheze.org/wiki/",
		RouteRe:  reVocalVirtualSingerHint,
		Priority: 96,
	},
	{
		ID:       "bandori",
		Name:     "BanG Dream! Fandom Wiki",
		APIBase:  "https://bandori.fandom.com/api.php",
		PageBase: "https://bandori.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)Roselia|Poppin'?Party|Afterglow|Pastel\*?Palettes|Morfonica|RAISE A SUILEN|MyGO|Ave Mujica|バンドリ|BanG Dream`),
		Priority: 94,
	},
	{
		ID:       "love-live",
		Name:     "Love Live! Fandom Wiki",
		APIBase:  "https://love-live.fandom.com/api.php",
		PageBase: "https://love-live.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)μ's|Aqours|虹ヶ咲|Liella|蓮ノ空|ラブライブ|Love Live`),
		Priority: 94,
	},
	{
		ID:       "bocchi-the-rock",
		Name:     "Bocchi The Rock! Fandom Wiki",
		APIBase:  "https://bocchi-the-rock.fandom.com/api.php",
		PageBase: "https://bocchi-the-rock.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)結束バンド|ぼっち|後藤ひとり|喜多郁代|伊地知虹夏|山田リョウ`),
		Priority: 94,
	},
	{
		ID:       "k-on",
		Name:     "K-ON! Fandom Wiki",
		APIBase:  "https://k-on.fandom.com/api.php",
		PageBase: "https://k-on.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)放課後ティータイム|\bHTT\b|けいおん|K-ON`),
		Priority: 94,
	},
	{
		ID:       "revuestarlight",
		Name:     "Revue Starlight Fandom Wiki",
		APIBase:  "https://revuestarlight.fandom.com/api.php",
		PageBase: "https://revuestarlight.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)スタァライト|レヴュースタァライト|Revue Starlight`),
		Priority: 94,
	},
	{
		ID:       "virtualyoutuber",
		Name:     "Virtual YouTuber Fandom Wiki",
		APIBase:  "https://virtualyoutuber.fandom.com/api.php",
		PageBase: "https://virtualyoutuber.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)hololive|ホロライブ|にじさんじ|NIJISANJI|VTuber`),
		Priority: 93,
	},
	{
		ID:       "umamusume",
		Name:     "Umamusume Fandom Wiki",
		APIBase:  "https://umamusume.fandom.com/api.php",
		PageBase: "https://umamusume.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)ウマ娘|うまぴょい|Umamusume`),
		Priority: 93,
	},
	{
		ID:       "gochiusa",
		Name:     "Is the Order a Rabbit? Wiki",
		APIBase:  "https://gochiusa.fandom.com/api.php",
		PageBase: "https://gochiusa.fandom.com/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)ご注文はうさぎですか|ごちうさ|チマメ隊|Petit Rabbit|香風智乃|保登心愛`),
		Priority: 94,
	},
	{
		ID:       "project-imas",
		Name:     "THE IDOLM@STER Wiki",
		APIBase:  "https://project-imas.wiki/api.php",
		PageBase: "https://project-imas.wiki/wiki/",
		RouteRe:  regexp.MustCompile(`(?i)IDOLM@STER|アイドルマスター|765PRO|CINDERELLA GIRLS|MILLION LIVE|Shiny Colors`),
		Priority: 90,
	},
}

// RegisterVocalEvidenceProvider 向当前声部服务注册自定义扩展数据源；后续可接入新站点而无需改动主流水线
func (a *lyricSingerService) RegisterVocalEvidenceProvider(p VocalEvidenceProvider) {
	if p == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.providers) == 0 {
		a.providers = a.buildDefaultProviders()
	}
	a.providers = append(a.providers, p)
}

func (a *lyricSingerService) effectiveProviders() []VocalEvidenceProvider {
	a.mu.Lock()
	custom := a.providers
	a.mu.Unlock()
	if len(custom) > 0 {
		return custom
	}
	return a.buildDefaultProviders()
}

func (a *lyricSingerService) buildDefaultProviders() []VocalEvidenceProvider {
	return []VocalEvidenceProvider{
		&siblingLyricVocalProvider{svc: a},
		&mediaWikiClusterProvider{sites: defaultMediaWikiSites},
		&moegirlVocalProvider{svc: a},
		&webSearchVocalProvider{svc: a},
	}
}

func cleanSearchSongTitle(raw string) string {
	s := strings.TrimSpace(raw)
	s = reVocalFeatSuffix.ReplaceAllString(s, "")
	s = reVocalVerSuffix.ReplaceAllString(s, "")
	s = strings.TrimSpace(reVocalWhitespace.ReplaceAllString(s, " "))
	return s
}

func normalizeSearchTitle(s string) string {
	s = strings.ToLower(vocalTitlePunctReplacer.Replace(strings.TrimSpace(s)))
	var b strings.Builder
	for _, r := range s {
		if unicode.IsSpace(r) {
			continue
		}
		if strings.ContainsRune(`-_/:()[]{}""'&+∞!?.,~★☆♪♡`, r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func stripTrailingVerKeyword(s string) string {
	stripped := strings.TrimSpace(reVocalPlainVerSuffix.ReplaceAllString(strings.TrimSpace(s), ""))
	if stripped == "" {
		return s
	}
	return stripped
}

func buildVocalSearchQuery(input *lyricSingerInput) *VocalSearchQuery {
	rawTitle := strings.TrimSpace(input.Track.Name)
	cleanTitle := cleanSearchSongTitle(rawTitle)
	if cleanTitle == "" {
		cleanTitle = rawTitle
	}

	variants := make([]string, 0, 6)
	seenVariant := map[string]bool{}
	addVariant := func(v string) {
		v = strings.TrimSpace(reVocalWhitespace.ReplaceAllString(v, " "))
		if v == "" {
			return
		}
		low := strings.ToLower(v)
		if seenVariant[low] {
			return
		}
		seenVariant[low] = true
		variants = append(variants, v)
	}

	addVariant(cleanTitle)
	if strippedVer := stripTrailingVerKeyword(cleanTitle); strippedVer != cleanTitle {
		addVariant(strippedVer)
	}
	// 提取如「カチューシャ（Katyusha）」中的外文别名与主干标题，方便英文/日文双语 Wiki 互搜
	if m := reVocalParenInner.FindStringSubmatch(cleanTitle); len(m) == 2 {
		outer := strings.TrimSpace(reVocalParenInner.ReplaceAllString(cleanTitle, ""))
		inner := strings.TrimSpace(m[1])
		addVariant(outer)
		if !strings.Contains(strings.ToLower(inner), "feat") && !strings.Contains(strings.ToLower(inner), "ver") {
			addVariant(inner)
		}
	}
	// 提取如「南北组-世末歌者」连字符后的核心曲名
	if prefix, suffix, ok := strings.Cut(cleanTitle, "-"); ok {
		pTrim := strings.TrimSpace(prefix)
		sTrim := strings.TrimSpace(suffix)
		if sTrim != "" && len([]rune(pTrim)) <= 6 && len([]rune(sTrim)) >= 2 {
			addVariant(sTrim)
		}
	}
	for _, alias := range input.Track.Aliases {
		if cleanedAlias := cleanSearchSongTitle(alias); cleanedAlias != "" {
			addVariant(cleanedAlias)
		}
	}

	lyricsLines := make([]string, 0, len(input.Tasks))
	var lyricsSample strings.Builder
	for i, task := range input.Tasks {
		t := strings.TrimSpace(task.Text)
		if t == "" {
			continue
		}
		lyricsLines = append(lyricsLines, t)
		if i < 20 {
			lyricsSample.WriteByte('\n')
			lyricsSample.WriteString(t)
		}
	}

	combinedMeta := rawTitle + " " + strings.Join(input.Track.Artists, " ") + " " + strings.Join(input.Track.Aliases, " ") + " " + input.Track.Album
	hasSEKAI := reVocalSEKAIHuman.MatchString(combinedMeta)
	prefersVS := !hasSEKAI && reVocalVirtualSingerHint.MatchString(combinedMeta)

	hasMultiArtist := len(input.Track.Artists) >= 2 ||
		strings.ContainsAny(rawTitle, "&×") ||
		reVocalFeatSuffix.MatchString(rawTitle) ||
		reVocalKnownGroupArtist.MatchString(combinedMeta)
	if !hasMultiArtist {
		joinedArtists := strings.Join(input.Track.Artists, " ")
		if strings.ContainsAny(joinedArtists, "&×/／") || strings.Contains(strings.ToLower(joinedArtists), " feat") || strings.Contains(strings.ToLower(joinedArtists), " with ") {
			hasMultiArtist = true
		}
	}

	return &VocalSearchQuery{
		SongID:               input.Track.ID,
		RawTitle:             rawTitle,
		CleanTitle:           cleanTitle,
		TitleVariants:        variants,
		NormTitle:            normalizeSearchTitle(cleanTitle),
		HasCJK:               reVocalCJK.MatchString(cleanTitle),
		HasCJKContext:        reVocalCJK.MatchString(combinedMeta + lyricsSample.String()),
		HasMultiArtistHint:   hasMultiArtist,
		PrefersVirtualSinger: prefersVS,
		Artists:              input.Track.Artists,
		Aliases:              input.Track.Aliases,
		Album:                input.Track.Album,
		Source:               input.Source,
		LyricsLines:          lyricsLines,
	}
}

// searchAndCleanVocalEvidence 执行多源检索、清洗与反幻觉核验，返回最佳权威声部证据
func searchAndCleanVocalEvidence(ctx context.Context, svc *lyricSingerService, input *lyricSingerInput) *VocalEvidenceCandidate {
	if svc == nil || input == nil || input.Track == nil {
		return nil
	}
	q := buildVocalSearchQuery(input)
	if q.CleanTitle == "" || len(q.LyricsLines) == 0 {
		return nil
	}

	searchCtx, cancel := context.WithTimeout(ctx, vocalSearchTotalTimeout)
	defer cancel()

	type activeProvider struct {
		p        VocalEvidenceProvider
		priority int
	}
	var tier1, tier2 []activeProvider
	for _, p := range svc.effectiveProviders() {
		if p == nil {
			continue
		}
		prio := p.Match(q)
		if prio < 0 {
			continue
		}
		if prio >= 50 {
			tier1 = append(tier1, activeProvider{p: p, priority: prio})
		} else {
			tier2 = append(tier2, activeProvider{p: p, priority: prio})
		}
	}
	sort.SliceStable(tier1, func(i, j int) bool { return tier1[i].priority > tier1[j].priority })
	sort.SliceStable(tier2, func(i, j int) bool { return tier2[i].priority > tier2[j].priority })

	runTier := func(providers []activeProvider) []VocalEvidenceCandidate {
		if len(providers) == 0 {
			return nil
		}
		var (
			mu   sync.Mutex
			wg   sync.WaitGroup
			list []VocalEvidenceCandidate
		)
		for _, ap := range providers {
			ap := ap
			wg.Add(1)
			go func() {
				defer wg.Done()
				items, err := ap.p.Search(searchCtx, q)
				if err != nil {
					logrus.Debugf("vocal provider %s error for %q: %v", ap.p.ID(), q.CleanTitle, err)
					return
				}
				var valid []VocalEvidenceCandidate
				for _, item := range items {
					if cleanAndVerifyCandidate(&item, q) {
						if item.Priority == 0 {
							item.Priority = ap.priority
						}
						valid = append(valid, item)
					}
				}
				if len(valid) > 0 {
					mu.Lock()
					list = append(list, valid...)
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		return list
	}

	candidates := runTier(tier1)
	if len(candidates) == 0 {
		candidates = runTier(tier2)
	}
	if len(candidates) == 0 {
		return nil
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		scoreI := scoreVocalCandidate(&candidates[i])
		scoreJ := scoreVocalCandidate(&candidates[j])
		if scoreI != scoreJ {
			return scoreI > scoreJ
		}
		return candidates[i].DetectedTags > candidates[j].DetectedTags
	})

	best := candidates[0]
	return &best
}

func scoreVocalCandidate(c *VocalEvidenceCandidate) int {
	score := c.Priority*10 + c.OverlapScore*4 + min(c.DetectedSingers, 12)*5 + min(c.DetectedTags, 40)
	if reVocalCJK.MatchString(c.CleanContent) {
		score += 40
	}
	return score
}

// =========================================================================
// Provider 1: 可扩展 MediaWiki 站点集群 (Fandom / Miraheze / 独立 MediaWiki)
// =========================================================================

type mediaWikiClusterProvider struct {
	sites []mediaWikiSite
}

func (p *mediaWikiClusterProvider) ID() string { return "mediawiki_cluster" }

func (p *mediaWikiClusterProvider) hasPriorityRoute(q *VocalSearchQuery) bool {
	meta := strings.Join(q.Artists, " ") + " " + q.RawTitle + " " + strings.Join(q.Aliases, " ") + " " + q.Album
	for _, s := range p.sites {
		if s.RouteRe != nil && s.RouteRe.MatchString(meta) {
			return true
		}
	}
	return false
}

func (p *mediaWikiClusterProvider) Match(q *VocalSearchQuery) int {
	if q == nil || q.CleanTitle == "" {
		return -1
	}
	// 无明确企划路由且标题/艺人/歌词均不含中日文时，跳过 ACG 专有 Wiki 轮询
	if !p.hasPriorityRoute(q) && !q.HasCJK && !q.HasCJKContext {
		return -1
	}
	if q.PrefersVirtualSinger || p.hasPriorityRoute(q) {
		return 95
	}
	return 80
}

func (p *mediaWikiClusterProvider) orderedSites(q *VocalSearchQuery) ([]mediaWikiSite, bool) {
	meta := strings.Join(q.Artists, " ") + " " + q.RawTitle + " " + strings.Join(q.Aliases, " ") + " " + q.Album
	var routed, others []mediaWikiSite
	for _, site := range p.sites {
		matched := site.RouteRe != nil && site.RouteRe.MatchString(meta)
		if matched {
			// 纯虚拟歌手版本将 vocaloidlyrics 放在第一位，projectsekai/sekaipedia 紧随其后
			if q.PrefersVirtualSinger && site.ID == "vocaloidlyrics" {
				site.Priority += 10
			}
			routed = append(routed, site)
		} else {
			others = append(others, site)
		}
	}
	if q.PrefersVirtualSinger {
		// 若仅标了 P 主/V 家，也补充 PJSK / Sekaipedia 作为兜底（很多 V 家名曲收录在 PJSK 并含 VS 分栏）
		sort.SliceStable(routed, func(i, j int) bool { return routed[i].Priority > routed[j].Priority })
		for _, site := range others {
			if site.ID == "projectsekai" || site.ID == "sekaipedia" {
				routed = append(routed, mediaWikiSite{
					ID: site.ID, Name: site.Name, APIBase: site.APIBase, PageBase: site.PageBase, RouteRe: site.RouteRe, Priority: 78,
				})
			}
		}
		return routed, true
	}
	if len(routed) > 0 {
		sort.SliceStable(routed, func(i, j int) bool { return routed[i].Priority > routed[j].Priority })
		return routed, true
	}
	return others, false
}

func (p *mediaWikiClusterProvider) Search(ctx context.Context, q *VocalSearchQuery) ([]VocalEvidenceCandidate, error) {
	sites, hasRouted := p.orderedSites(q)
	if len(sites) == 0 {
		return nil, nil
	}

	// 已命中垂直企划/虚拟歌手路由时优先查询命中路由的 Wiki，提高准确度与速度；
	// 仅在通用 CJK 曲目时并发轮询全部分库，一旦找到首个通过清洗的高信度结果即可提前结束等待
	var (
		mu               sync.Mutex
		results          []VocalEvidenceCandidate
		wg               sync.WaitGroup
		sem              = make(chan struct{}, 5)
		innerCtx, cancel = context.WithCancel(ctx)
	)
	defer cancel()

	maxSites := len(sites)
	if hasRouted && maxSites > 4 {
		maxSites = 4
	}
	for _, site := range sites[:maxSites] {
		site := site
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-innerCtx.Done():
				return
			}
			cand := searchSingleMediaWikiSite(innerCtx, site, q)
			if cand == nil {
				return
			}
			if !cleanAndVerifyCandidate(cand, q) {
				return
			}
			mu.Lock()
			results = append(results, *cand)
			// 垂直路由命中的 Wiki 验证通过后立即取消其余低优兜底站点请求
			if hasRouted && cand.Priority >= 88 {
				cancel()
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	return results, nil
}

type mwSearchHit struct {
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
}

func searchSingleMediaWikiSite(ctx context.Context, site mediaWikiSite, q *VocalSearchQuery) *VocalEvidenceCandidate {
	maxVariants := min(2, len(q.TitleVariants))
	for vIdx := 0; vIdx < maxVariants; vIdx++ {
		variant := q.TitleVariants[vIdx]
		if len([]rune(normalizeSearchTitle(variant))) < 2 {
			continue
		}
		hits := fetchMediaWikiSearchHits(ctx, site.APIBase, variant)
		if len(hits) == 0 {
			continue
		}

		// 若曲名自身不含 '/'，剔除明显属于图库/专辑/碟片目录/分类的子页面
		var filtered []mwSearchHit
		allowSlash := strings.Contains(q.CleanTitle, "/")
		for _, h := range hits {
			low := strings.ToLower(h.Title)
			if strings.HasPrefix(low, "category:") || strings.HasPrefix(low, "template:") || strings.HasPrefix(low, "file:") {
				continue
			}
			if !allowSlash && (strings.Contains(low, "/gallery") || strings.Contains(low, "/discography") || strings.Contains(low, "/audio")) {
				continue
			}
			if !strings.Contains(strings.ToLower(q.CleanTitle), "discography") && strings.Contains(low, "discography") {
				continue
			}
			filtered = append(filtered, h)
		}
		if len(filtered) == 0 {
			continue
		}

		sort.SliceStable(filtered, func(i, j int) bool {
			return rankMediaWikiHit(filtered[i].Title, variant, q.NormTitle) < rankMediaWikiHit(filtered[j].Title, variant, q.NormTitle)
		})

		queryTokens := extractLatinSearchTokens(variant)
		normVariant := normalizeSearchTitle(variant)

		checked := 0
		for _, h := range filtered {
			if checked >= 2 {
				break
			}
			title := strings.TrimSpace(h.Title)
			baseNormTitle := normalizeSearchTitle(reVocalSongParen.ReplaceAllString(title, ""))
			snippetLower := strings.ToLower(utils.HTMLExcerpt(h.Snippet, 240))

			// CJK 曲名（如「群青讃歌」「ステラ」）在英文 Wiki 多以罗马音命名，严禁用英文 token 预过滤 title；
			// 非 CJK 曲名做严格 token 与长度比例核验，避免如「Crazy ∞ nighT」误匹配「CRAZY」
			if !reVocalCJK.MatchString(variant) {
				if len(queryTokens) > 0 {
					hasToken := false
					for _, tok := range queryTokens {
						if strings.Contains(baseNormTitle, tok) || strings.Contains(snippetLower, tok) {
							hasToken = true
							break
						}
					}
					if !hasToken && !eitherContains(baseNormTitle, normVariant) {
						continue
					}
				}
				baseLen := len([]rune(baseNormTitle))
				queryLen := len([]rune(normVariant))
				if queryLen > 0 && baseLen*100 < queryLen*75 && !strings.Contains(baseNormTitle, normVariant) {
					continue
				}
			}

			checked++
			resolvedTitle, wikitext := fetchMediaWikiParseWikitext(ctx, site.APIBase, title)
			if strings.TrimSpace(wikitext) == "" {
				continue
			}
			if resolvedTitle != "" {
				title = resolvedTitle
				baseNormTitle = normalizeSearchTitle(reVocalSongParen.ReplaceAllString(title, ""))
			}

			// 严格曲名校验：标题归一化互含 OR 正文精确出现标准曲名（支持全/半角标点归一与重定向后标题）
			foldedWiki := vocalTitlePunctReplacer.Replace(wikitext)
			titleMatch := eitherContains(baseNormTitle, q.NormTitle) || eitherContains(baseNormTitle, normVariant)
			if !reVocalCJK.MatchString(variant) && len([]rune(baseNormTitle)) < len([]rune(normVariant))*75/100 {
				titleMatch = false
			}
			contentMatch := false
			for _, tv := range q.TitleVariants {
				if len([]rune(tv)) >= 2 && strings.Contains(foldedWiki, vocalTitlePunctReplacer.Replace(tv)) {
					contentMatch = true
					break
				}
			}
			if !titleMatch && !contentMatch {
				continue
			}

			if !reVocalWikiPartIndicator.MatchString(wikitext) && !reVocalWikiLyricsIndicator.MatchString(wikitext) {
				continue
			}

			pageSlug := url.PathEscape(strings.ReplaceAll(title, " ", "_"))
			return &VocalEvidenceCandidate{
				ProviderID: "mediawiki:" + site.ID,
				SourceName: site.Name,
				Title:      title,
				URL:        strings.TrimRight(site.PageBase, "/") + "/" + pageSlug,
				Format:     VocalEvidenceFormatWikitext,
				RawContent: wikitext,
				Priority:   site.Priority,
			}
		}
	}
	return nil
}

func fetchMediaWikiSearchHits(ctx context.Context, apiBase, query string) []mwSearchHit {
	reqCtx, cancel := context.WithTimeout(ctx, vocalSearchPerSiteTimeout)
	defer cancel()

	params := url.Values{
		"action":   {"query"},
		"list":     {"search"},
		"srsearch": {query},
		"srlimit":  {"5"},
		"format":   {"json"},
	}
	res, err := vocalSafeFetch(reqCtx, appendQuery(apiBase, params), lyricSingerFetchMaxBytes, "application/json", "text/javascript")
	if err != nil {
		return nil
	}
	var parsed struct {
		Query struct {
			Search []mwSearchHit `json:"search"`
		} `json:"query"`
	}
	if err := json.Unmarshal(res.Body, &parsed); err != nil {
		return nil
	}
	return parsed.Query.Search
}

func fetchMediaWikiParseWikitext(ctx context.Context, apiBase, pageTitle string) (string, string) {
	reqCtx, cancel := context.WithTimeout(ctx, vocalSearchPerParseTimeout)
	defer cancel()

	params := url.Values{
		"action":    {"parse"},
		"page":      {pageTitle},
		"prop":      {"wikitext"},
		"redirects": {"1"},
		"format":    {"json"},
	}
	res, err := vocalSafeFetch(reqCtx, appendQuery(apiBase, params), lyricSingerFetchMaxBytes, "application/json", "text/javascript")
	if err != nil {
		return "", ""
	}
	var parsed struct {
		Parse struct {
			Title    string `json:"title"`
			Wikitext struct {
				Text string `json:"*"`
			} `json:"wikitext"`
		} `json:"parse"`
	}
	if err := json.Unmarshal(res.Body, &parsed); err != nil {
		return "", ""
	}
	return strings.TrimSpace(parsed.Parse.Title), parsed.Parse.Wikitext.Text
}

func rankMediaWikiHit(hitTitle, query, normQuery string) int {
	if strings.EqualFold(hitTitle, query) {
		return 0
	}
	baseNorm := normalizeSearchTitle(reVocalSongParen.ReplaceAllString(hitTitle, ""))
	if baseNorm == normQuery {
		return 1
	}
	low := strings.ToLower(hitTitle)
	if strings.Contains(low, "/") || strings.Contains(low, "live") || strings.Contains(low, "discography") || strings.Contains(low, "album") {
		return 10
	}
	if strings.Contains(baseNorm, normQuery) {
		return 3
	}
	return 5
}

func extractLatinSearchTokens(s string) []string {
	parts := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'))
	})
	var tokens []string
	for _, p := range parts {
		if len(p) > 2 {
			tokens = append(tokens, p)
		}
	}
	return tokens
}

// =========================================================================
// Provider 2: 萌娘百科 (OpenSearch + HTML 双模，兼容现网 anonymous API 限制)
// =========================================================================

type moegirlVocalProvider struct {
	svc      *lyricSingerService
	apiBase  string
	pageBase string
}

func (p *moegirlVocalProvider) ID() string { return "moegirl" }

func (p *moegirlVocalProvider) Match(q *VocalSearchQuery) int {
	if q == nil || q.CleanTitle == "" {
		return -1
	}
	if !q.HasCJK && !q.HasCJKContext && !q.HasMultiArtistHint {
		return -1
	}
	return 85
}

func (p *moegirlVocalProvider) Search(ctx context.Context, q *VocalSearchQuery) ([]VocalEvidenceCandidate, error) {
	// 1. 若测试注入了自定义 moegirlAPIBase 或 searchMoegirl 钩子，优先走轻量 Wikitext 路径保证兼容性
	if p.svc != nil && p.svc.searchMoegirl != nil {
		out, pageURL, err := p.svc.searchMoegirl(ctx, q.CleanTitle, "")
		if err == nil && strings.TrimSpace(out) != "" {
			return []VocalEvidenceCandidate{{
				ProviderID: "moegirl",
				SourceName: "萌娘百科 (Moegirlpedia)",
				Title:      q.CleanTitle,
				URL:        pageURL,
				Format:     VocalEvidenceFormatWikitext,
				RawContent: out,
				Priority:   88,
			}}, nil
		}
	}
	if p.svc != nil && strings.TrimSpace(p.svc.moegirlAPIBase) != "" {
		_, wikitext, err := fetchMoegirlWikitext(ctx, p.svc.moegirlAPIBase, q.CleanTitle)
		if err == nil && strings.TrimSpace(wikitext) != "" {
			return []VocalEvidenceCandidate{{
				ProviderID: "moegirl",
				SourceName: "萌娘百科 (Moegirlpedia)",
				Title:      q.CleanTitle,
				URL:        moegirlPageURL(q.CleanTitle),
				Format:     VocalEvidenceFormatWikitext,
				RawContent: wikitext,
				Priority:   88,
			}}, nil
		}
	}

	apiBase := p.apiBase
	if apiBase == "" {
		apiBase = "https://mzh.moegirl.org.cn/api.php"
	}
	pageBase := p.pageBase
	if pageBase == "" {
		pageBase = "https://mzh.moegirl.org.cn/"
	}

	var results []VocalEvidenceCandidate
	seenPage := map[string]bool{}
	maxQueries := min(2, len(q.TitleVariants))
	for i := 0; i < maxQueries; i++ {
		variant := q.TitleVariants[i]
		titles := fetchMoegirlOpenSearch(ctx, apiBase, variant)
		if len(titles) == 0 {
			continue
		}
		sort.SliceStable(titles, func(a, b int) bool {
			return rankMoegirlHit(titles[a], q.CleanTitle, q.NormTitle) < rankMoegirlHit(titles[b], q.CleanTitle, q.NormTitle)
		})

		checked := 0
		for _, title := range titles {
			if checked >= 2 || seenPage[title] {
				continue
			}
			low := strings.ToLower(title)
			if strings.Contains(low, "列表") || strings.Contains(low, "目录") || strings.Contains(low, "template:") {
				continue
			}
			seenPage[title] = true
			checked++

			reqCtx, cancel := context.WithTimeout(ctx, vocalSearchPerParseTimeout)
			pageURL := strings.TrimRight(pageBase, "/") + "/" + url.PathEscape(strings.ReplaceAll(strings.TrimSpace(title), " ", "_"))
			res, err := vocalSafeFetch(reqCtx, pageURL, lyricSingerFetchMaxBytes, "text/html", "application/xhtml")
			cancel()
			if err != nil || res == nil || len(res.Body) == 0 {
				continue
			}
			bodyStr := string(res.Body)
			if strings.Contains(bodyStr, "未授权操作") && !strings.Contains(bodyStr, "Lyrics-") {
				continue
			}
			results = append(results, VocalEvidenceCandidate{
				ProviderID: "moegirl",
				SourceName: "萌娘百科 (Moegirlpedia)",
				Title:      title,
				URL:        pageURL,
				Format:     VocalEvidenceFormatMoegirlHTML,
				RawContent: bodyStr,
				Priority:   85,
			})
			if len(results) >= 2 {
				return results, nil
			}
		}
	}
	return results, nil
}

func fetchMoegirlOpenSearch(ctx context.Context, apiBase, query string) []string {
	reqCtx, cancel := context.WithTimeout(ctx, vocalSearchPerSiteTimeout)
	defer cancel()

	params := url.Values{
		"action": {"opensearch"},
		"search": {query},
		"limit":  {"6"},
		"format": {"json"},
	}
	res, err := vocalSafeFetch(reqCtx, appendQuery(apiBase, params), lyricSingerFetchMaxBytes, "application/json", "text/javascript")
	if err != nil {
		return nil
	}
	var raw []json.RawMessage
	if err := json.Unmarshal(res.Body, &raw); err != nil || len(raw) < 2 {
		return nil
	}
	var titles []string
	_ = json.Unmarshal(raw[1], &titles)
	return titles
}

func rankMoegirlHit(title, cleanTitle, normQuery string) int {
	if strings.EqualFold(title, cleanTitle) {
		return 0
	}
	if strings.HasPrefix(strings.ToLower(title), strings.ToLower(cleanTitle)+"(") || strings.HasPrefix(strings.ToLower(title), strings.ToLower(cleanTitle)+"（") {
		return 1
	}
	if strings.Contains(normalizeSearchTitle(title), normQuery) {
		return 3
	}
	return 8
}

// =========================================================================
// Provider 3: 同曲跨源原生歌词前缀检索源 (ncm / qq / kugou 互借角色标注)
// =========================================================================

type siblingLyricVocalProvider struct {
	svc *lyricSingerService
}

func (p *siblingLyricVocalProvider) ID() string { return "sibling_lyric" }

func (p *siblingLyricVocalProvider) Match(q *VocalSearchQuery) int {
	if q == nil || q.SongID <= 0 || len(q.LyricsLines) == 0 {
		return -1
	}
	return 98
}

func (p *siblingLyricVocalProvider) Search(ctx context.Context, q *VocalSearchQuery) ([]VocalEvidenceCandidate, error) {
	if p.svc == nil || p.svc.siblingFetcher == nil {
		return nil, nil
	}
	siblings := p.svc.siblingFetcher(ctx, q.SongID, q.Source)
	var out []VocalEvidenceCandidate
	for _, sib := range siblings {
		if len(sib.Lines) == 0 {
			continue
		}
		var b strings.Builder
		cueCount := 0
		for _, line := range sib.Lines {
			t := strings.TrimSpace(line)
			if t == "" {
				continue
			}
			if hasStructuralInlineMarker(t) {
				cueCount++
			}
			b.WriteString(t)
			b.WriteByte('\n')
		}
		if cueCount < 3 {
			continue
		}
		cleaned, singers, tags := cleanBracketVocalEvidence(b.String())
		if singers < 2 || tags < 2 {
			continue
		}
		out = append(out, VocalEvidenceCandidate{
			ProviderID:      "sibling_lyric",
			SourceName:      "同曲平台原生歌词前缀 (" + sib.Source + ")",
			Title:           q.CleanTitle,
			URL:             "local://sibling_lyric/" + sib.Source,
			Format:          VocalEvidenceFormatNormalized,
			RawContent:      b.String(),
			CleanContent:    cleaned,
			DetectedSingers: singers,
			DetectedTags:    tags,
			Priority:        98,
		})
	}
	return out, nil
}

func defaultFetchSiblingLyrics(ctx context.Context, songID int64, currentSource string) []siblingLyricText {
	if songID <= 0 {
		return nil
	}
	currentKind, _, _ := strings.Cut(currentSource, "-")
	ms := NewMusicService()
	var results []siblingLyricText

	tryExtractLines := func(srcName, raw string) {
		if strings.TrimSpace(raw) == "" {
			return
		}
		timed := expandPlatformTimedLines(raw)
		if len(timed) == 0 {
			return
		}
		lines := make([]string, 0, len(timed))
		for _, item := range timed {
			if t := strings.TrimSpace(item.Text); t != "" {
				lines = append(lines, t)
			}
		}
		if len(lines) > 0 {
			results = append(results, siblingLyricText{Source: srcName, RawText: raw, Lines: lines})
		}
	}

	// 若当前使用的是 yrc/ttml/qq/kugou，优先尝试另一源（如网易云 lrc 常含 `男：/女：/合：` 标注）
	if currentSource != "ncm-lrc" {
		if res := lyricSourceFetch(ms, ctx, songID, "ncm"); res.data != nil {
			if ncm, ok := res.data.(*dto.MusicLyricDto); ok && ncm != nil && ncm.Lrc != nil {
				tryExtractLines("ncm-lrc", ncm.Lrc.Lyric)
			}
		}
	}
	if currentKind != "qq" {
		if res := lyricSourceFetch(ms, ctx, songID, "qq"); res.data != nil {
			if qq, ok := res.data.(*dto.MusicQQLyricDto); ok && qq != nil {
				tryExtractLines("qq", qq.Lyric)
			}
		}
	}
	return results
}

// =========================================================================
// Provider 4: 全网搜索兜底源 (Bing RSS / DuckDuckGo -> Atwiki / Ameba / Genius)
// =========================================================================

type webSearchVocalProvider struct {
	svc *lyricSingerService
}

func (p *webSearchVocalProvider) ID() string { return "web_search" }

func (p *webSearchVocalProvider) Match(q *VocalSearchQuery) int {
	if q == nil || q.CleanTitle == "" {
		return -1
	}
	if !q.HasCJKContext && !q.HasMultiArtistHint {
		return -1
	}
	return 30
}

func (p *webSearchVocalProvider) Search(ctx context.Context, q *VocalSearchQuery) ([]VocalEvidenceCandidate, error) {
	if p.svc != nil && p.svc.searchWeb != nil {
		raw, err := p.svc.searchWeb(ctx, fmt.Sprintf("%q パート分け", q.CleanTitle))
		if err == nil && strings.TrimSpace(raw) != "" {
			var parsed struct {
				Results []webSearchHit `json:"results"`
			}
			if json.Unmarshal([]byte(raw), &parsed) == nil && len(parsed.Results) > 0 {
				return p.fetchTopHits(ctx, parsed.Results, q), nil
			}
		}
	}

	var queries []string
	if q.HasCJKContext {
		queries = append(queries,
			fmt.Sprintf("%q パート分け 歌詞", q.CleanTitle),
			fmt.Sprintf("%q 歌割り 歌詞", q.CleanTitle),
		)
		if len(q.Artists) > 0 {
			queries = append(queries, fmt.Sprintf("%q %s 歌词 分唱 合唱", q.CleanTitle, q.Artists[0]))
		}
	} else if len(q.Artists) > 0 {
		limit := min(2, len(q.Artists))
		artistJoined := strings.Join(q.Artists[:limit], " ")
		queries = append(queries,
			fmt.Sprintf("%q %s fandom", q.CleanTitle, artistJoined),
			fmt.Sprintf("%q %s lyrics", q.CleanTitle, artistJoined),
		)
	}

	for _, query := range queries {
		hits := searchPublicWebHits(ctx, query)
		if len(hits) == 0 {
			continue
		}
		if cands := p.fetchTopHits(ctx, hits, q); len(cands) > 0 {
			return cands, nil
		}
	}
	return nil, nil
}

func (p *webSearchVocalProvider) fetchTopHits(ctx context.Context, hits []webSearchHit, q *VocalSearchQuery) []VocalEvidenceCandidate {
	type scoredHit struct {
		hit   webSearchHit
		score int
	}
	var ranked []scoredHit
	seen := map[string]bool{}
	for _, h := range hits {
		norm := normalizeEvidenceURL(h.URL)
		if norm == "" || seen[norm] {
			continue
		}
		seen[norm] = true
		score := scoreWebSearchHitURL(h.URL, h.Title+" "+h.Snippet, q)
		if score < 0 {
			continue
		}
		ranked = append(ranked, scoredHit{hit: h, score: score})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })

	limit := min(4, len(ranked))
	var out []VocalEvidenceCandidate
	for i := 0; i < limit; i++ {
		h := ranked[i].hit
		// Fandom / Miraheze / Sekaipedia URL 在未注入自定义 fetchPage 时优先直调 MediaWiki parse API 获取干净 Wikitext
		if p.svc == nil || p.svc.fetchPage == nil {
			if apiBase, pageTitle, ok := extractWikiAPIBaseAndTitle(h.URL); ok {
				resolvedTitle, wikitext := fetchMediaWikiParseWikitext(ctx, apiBase, pageTitle)
				if strings.TrimSpace(wikitext) != "" {
					if resolvedTitle == "" {
						resolvedTitle = h.Title
					}
					cand := VocalEvidenceCandidate{
						ProviderID: "web_search",
						SourceName: hostLabelFromURL(h.URL),
						Title:      resolvedTitle,
						URL:        h.URL,
						Format:     VocalEvidenceFormatWikitext,
						RawContent: wikitext,
						Priority:   35 + min(ranked[i].score, 20),
					}
					if cleanAndVerifyCandidate(&cand, q) {
						out = append(out, cand)
						break
					}
					continue
				}
			}
		}

		rawBody, finalURL, ok := p.fetchCandidatePage(ctx, h.URL)
		if !ok {
			continue
		}
		fmtType := VocalEvidenceFormatHTML
		if strings.Contains(strings.ToLower(finalURL), "moegirl.org") && strings.Contains(rawBody, "Lyrics-") {
			fmtType = VocalEvidenceFormatMoegirlHTML
		}
		cand := VocalEvidenceCandidate{
			ProviderID: "web_search",
			SourceName: hostLabelFromURL(finalURL),
			Title:      h.Title,
			URL:        finalURL,
			Format:     fmtType,
			RawContent: rawBody,
			Priority:   30 + min(ranked[i].score, 20),
		}
		if cleanAndVerifyCandidate(&cand, q) {
			out = append(out, cand)
			break
		}
	}
	return out
}

func (p *webSearchVocalProvider) fetchCandidatePage(ctx context.Context, rawURL string) (string, string, bool) {
	if p.svc != nil && p.svc.fetchPage != nil {
		out, urls, err := p.svc.fetchPage(ctx, rawURL)
		if err == nil && strings.TrimSpace(out) != "" {
			final := rawURL
			if len(urls) > 0 && urls[0] != "" {
				final = urls[len(urls)-1]
			}
			return out, final, true
		}
	}
	reqCtx, cancel := context.WithTimeout(ctx, vocalSearchPerParseTimeout)
	defer cancel()
	res, err := vocalSafeFetch(reqCtx, rawURL, lyricSingerFetchMaxBytes, "text/html", "application/xhtml", "text/plain")
	if err != nil || res == nil || len(res.Body) == 0 {
		return "", "", false
	}
	final := res.FinalURL
	if final == "" {
		final = rawURL
	}
	return string(res.Body), final, true
}

func extractWikiAPIBaseAndTitle(rawURL string) (apiBase, pageTitle string, ok bool) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Hostname() == "" {
		return "", "", false
	}
	host := strings.ToLower(u.Hostname())
	isWikiHost := strings.HasSuffix(host, ".fandom.com") ||
		strings.HasSuffix(host, ".miraheze.org") ||
		host == "sekaipedia.org" || strings.HasSuffix(host, ".sekaipedia.org")
	if !isWikiHost || !strings.HasPrefix(u.Path, "/wiki/") {
		return "", "", false
	}
	rawTitle := strings.TrimPrefix(u.Path, "/wiki/")
	if rawTitle == "" {
		return "", "", false
	}
	lowTitle := strings.ToLower(rawTitle)
	if strings.Contains(lowTitle, "special:") || strings.Contains(lowTitle, "category:") {
		return "", "", false
	}
	decoded, err := url.PathUnescape(rawTitle)
	if err != nil || strings.TrimSpace(decoded) == "" {
		return "", "", false
	}
	return u.Scheme + "://" + u.Host + "/api.php", strings.ReplaceAll(decoded, "_", " "), true
}

func searchPublicWebHits(ctx context.Context, query string) []webSearchHit {
	reqCtx, cancel := context.WithTimeout(ctx, vocalSearchPerSiteTimeout)
	defer cancel()

	var hits []webSearchHit
	if res, err := searchYahooJapanHTML(reqCtx, "https://search.yahoo.co.jp/search", query); err == nil && len(res) > 0 {
		hits = append(hits, res...)
	}
	if len(hits) >= 2 {
		return hits
	}

	for _, bingBase := range []string{"https://cn.bing.com/search", "https://www.bing.com/search"} {
		if res, err := searchBingRSS(reqCtx, bingBase, query); err == nil && len(res) > 0 {
			hits = append(hits, res...)
			if len(hits) >= 4 {
				break
			}
		}
	}
	if len(hits) < 3 {
		if res, err := searchDuckDuckGoHTML(reqCtx, "https://html.duckduckgo.com/html/", query); err == nil {
			hits = append(hits, res...)
		}
	}
	return hits
}

func searchYahooJapanHTML(ctx context.Context, endpoint, query string) ([]webSearchHit, error) {
	u := appendQuery(endpoint, url.Values{"p": {query}})
	res, err := vocalSafeFetch(ctx, u, lyricSingerFetchMaxBytes, "text/html", "application/xhtml", "text/plain")
	if err != nil {
		return nil, err
	}
	doc, err := nethtml.Parse(strings.NewReader(string(res.Body)))
	if err != nil {
		return nil, err
	}

	var hits []webSearchHit
	seen := make(map[string]bool)
	var walk func(*nethtml.Node)
	walk = func(n *nethtml.Node) {
		if len(hits) >= 8 {
			return
		}
		if n.Type == nethtml.ElementNode && n.Data == "a" {
			if rawHref := strings.TrimSpace(attrValue(n, "href")); rawHref != "" {
				if targetURL, ok := extractYahooExternalURL(rawHref); ok {
					norm := normalizeEvidenceURL(targetURL)
					title := clipRunes(nodeText(n), 120)
					if norm != "" && !seen[norm] && len([]rune(title)) >= 3 {
						seen[norm] = true
						snippet := ""
						snippetNode := n.Parent
						if snippetNode != nil && snippetNode.Parent != nil && snippetNode.Parent.Type == nethtml.ElementNode && !strings.EqualFold(snippetNode.Parent.Data, "body") {
							snippetNode = snippetNode.Parent
						}
						if snippetNode != nil {
							snippet = clipRunes(nodeText(snippetNode), 200)
						}
						hits = append(hits, webSearchHit{
							Title:   title,
							URL:     targetURL,
							Snippet: snippet,
						})
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return hits, nil
}

func extractYahooExternalURL(rawHref string) (string, bool) {
	low := strings.ToLower(strings.TrimSpace(rawHref))
	if !(strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://")) {
		return "", false
	}
	u, err := url.Parse(rawHref)
	if err != nil || u.Hostname() == "" {
		return "", false
	}
	// 解包 Yahoo 跳转链接（如 rdsig.yahoo.co.jp/.../RU=https%3A.../RK=...）
	if strings.Contains(strings.ToLower(u.Hostname()), "yahoo.co.jp") {
		if _, after, hasRU := strings.Cut(rawHref, "/RU="); hasRU {
			enc, _, _ := strings.Cut(after, "/RK=")
			if dec, err := url.QueryUnescape(enc); err == nil {
				if du, err := url.Parse(dec); err == nil && du.Hostname() != "" {
					rawHref = dec
					u = du
				}
			}
		}
	}
	host := strings.ToLower(u.Hostname())
	for _, excluded := range []string{"yahoo.co.jp", "yahoo.com", "yimg.jp", "lycorp.co.jp", "yahoo-net.jp", "line.me", "google.com", "bing.com"} {
		if host == excluded || strings.HasSuffix(host, "."+excluded) {
			return "", false
		}
	}
	if u.Path == "" || u.Path == "/" {
		return "", false
	}
	return rawHref, true
}

func scoreWebSearchHitURL(rawURL, metaText string, q *VocalSearchQuery) int {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Hostname() == "" {
		return -1
	}
	host := strings.ToLower(u.Hostname())
	// 过滤视频站、流媒体页、辞典百科与纯社交问答站点
	for _, blocked := range []string{
		"youtube.com", "youtu.be", "bilibili.com", "nicovideo.jp", "spotify.com",
		"music.163.com", "y.qq.com", "music.apple.com", "tiktok.com",
		"facebook.com", "x.com", "twitter.com", "instagram.com", "reddit.com",
		"wikipedia.org", "baike.baidu.com", "dictionary.cambridge.org", "merriam-webster.com",
		"iciba.com", "zhihu.com", "csdn.net",
	} {
		if host == blocked || strings.HasSuffix(host, "."+blocked) {
			return -1
		}
	}

	score := 0
	for _, domainScore := range []struct {
		suffix string
		bonus  int
	}{
		{"miraheze.org", 20},
		{"fandom.com", 18},
		{"sekaipedia.org", 18},
		{"moegirl.org.cn", 18},
		{"atwiki.jp", 16},
		{"hatenablog.com", 15},
		{"hatenablog.jp", 15},
		{"seesaawiki.jp", 15},
		{"wikiwiki.jp", 15},
		{"ameblo.jp", 15},
		{"genius.com", 15},
		{"fc2.com", 12},
		{"livedoor.jp", 12},
		{"note.com", 12},
		{"utaten.com", 10},
		{"uta-net.com", 8},
	} {
		if strings.HasSuffix(host, domainScore.suffix) {
			score += domainScore.bonus
			break
		}
	}
	lowerMeta := strings.ToLower(metaText)
	if strings.Contains(metaText, "パート分け") || strings.Contains(metaText, "色分け") || strings.Contains(metaText, "合唱") {
		score += 8
	}
	if strings.Contains(metaText, "歌割り") || strings.Contains(lowerMeta, "lyrics") {
		score += 5
	}
	if eitherContains(normalizeSearchTitle(metaText), q.NormTitle) {
		score += 5
	}
	compactHay := strings.ToLower(strings.ReplaceAll(metaText+" "+rawURL, " ", ""))
	for _, art := range q.Artists {
		compactArt := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(art), " ", ""))
		if len([]rune(compactArt)) >= 2 && strings.Contains(compactHay, compactArt) {
			score += 10
			break
		}
	}
	return score
}

func hostLabelFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" {
		return "web"
	}
	return u.Hostname()
}

var _ = errors.New
