package service

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // 容器镜像可能没有系统时区数据，内置一份用于计算时区偏移

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/ipregion"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 访问一致性检测：交叉比对浏览器信号、请求头与 IP 归属地，判断 IP 是否可信、浏览器环境是否被伪装，并推断真实地区。
// 结果只依赖访问记录本身保存的字段，写入时计算一次用于筛选和统计，后台详情再按同样的规则重算出完整过程。

const (
	sevHigh   = "high"
	sevMedium = "medium"
	sevLow    = "low"
	sevInfo   = "info"

	ruleHit  = "hit"
	rulePass = "pass"
	ruleSkip = "skip"

	ruleCatLocation = "location" // 位置可信度
	ruleCatEnv      = "env"      // 浏览器环境
	ruleCatAuto     = "auto"     // 自动化

	trustWeightIP   = 1 // 地区推断中 IP 的权重，机房 IP 为 0
	trustWeightTZ   = 2 // 代理改不了系统时区，权重最高
	trustWeightLang = 1
)

var (
	sevRank    = map[string]int{sevInfo: 0, sevLow: 1, sevMedium: 2, sevHigh: 3}
	sevPenalty = map[string]int{sevInfo: 0, sevLow: 6, sevMedium: 20, sevHigh: 45}

	// 无地区子标签时语言可能对应的国家；英语过于通用，不参与判断
	langCountries = map[string][]string{
		"zh": {"CN", "TW", "HK", "MO", "SG", "MY"}, "ja": {"JP"}, "ko": {"KR"}, "de": {"DE", "AT", "CH"},
		"fr": {"FR", "BE", "CH", "CA"}, "ru": {"RU", "UA"}, "es": {"ES", "MX", "AR"}, "pt": {"PT", "BR"},
		"it": {"IT", "CH"}, "nl": {"NL", "BE"}, "th": {"TH"}, "vi": {"VN"}, "tr": {"TR"}, "pl": {"PL"}, "sv": {"SE"},
	}
	// 无地区子标签时用于推断的国家，只给以单一地区为主的语言
	langPrimary = map[string]string{"ja": "JP", "ko": "KR", "th": "TH", "vi": "VN", "tr": "TR", "pl": "PL", "sv": "SE"}

	// 运营商名称命中即视为机房 / 云服务网段
	datacenterISPPattern = regexp.MustCompile(`(?i)阿里|腾讯|华为云|百度云|金山云|京东云|UCloud|Alibaba|Tencent|Huawei Cloud|Amazon|AWS|Google|Microsoft|Azure|DigitalOcean|Vultr|Choopa|Linode|Akamai|OVH|Hetzner|Cloudflare|G-Core|Gcore|M247|Oracle|Contabo|DMIT|Leaseweb|Hostinger`)

	// UA 系统名与 Sec-CH-UA-Platform 的对应关系
	chPlatforms = map[string][]string{
		"macOS": {"macos"}, "Windows": {"windows"}, "Android": {"android"}, "Linux": {"linux"}, "ChromeOS": {"chrome os", "chromeos"},
		"HarmonyOS": {"harmonyos", "openharmony", "android"}, "iOS": {"ios"}, "iPadOS": {"ios", "ipados"},
	}
)

// regionCountry 归属地的国家代码：ip2region 把港澳台记为 CN，这里按省份单独区分，便于与时区、语言比对
func regionCountry(r ipregion.Region) string {
	if r.Reserved {
		return ""
	}
	if strings.EqualFold(r.CountryCode, "CN") || r.Country == "中国" {
		switch {
		case strings.HasPrefix(r.Province, "香港"):
			return "HK"
		case strings.HasPrefix(r.Province, "澳门"):
			return "MO"
		case strings.HasPrefix(r.Province, "台湾"):
			return "TW"
		}
		return "CN"
	}
	return strings.ToUpper(r.CountryCode)
}

func isDatacenterISP(isp string) bool {
	return isp != "" && datacenterISPPattern.MatchString(isp)
}

var (
	locationCache    sync.Map // 时区名 -> *time.Location，无法识别时为 nil
	countryZonesOnce sync.Once
	countryZones     map[string][]string // 国家 -> 时区列表
)

func loadLocation(tz string) *time.Location {
	if cached, ok := locationCache.Load(tz); ok {
		loc, _ := cached.(*time.Location)
		return loc
	}
	var loc *time.Location
	if tz != "" && tz != "Local" {
		loc, _ = time.LoadLocation(tz)
	}
	locationCache.Store(tz, loc)
	return loc
}

// tzOffsetAt 时区在指定时刻的 UTC 偏移（分钟）
func tzOffsetAt(tz string, at time.Time) (int, bool) {
	loc := loadLocation(tz)
	if loc == nil {
		return 0, false
	}
	_, seconds := at.In(loc).Zone()
	return seconds / 60, true
}

// countryOffsets 一个国家各时区在指定时刻的偏移，从小到大去重
func countryOffsets(cc string, at time.Time) []int {
	countryZonesOnce.Do(func() {
		countryZones = map[string][]string{}
		for tz, country := range tzCountry {
			countryZones[country] = append(countryZones[country], tz)
		}
	})
	seen := map[int]bool{}
	offsets := []int{}
	for _, tz := range countryZones[cc] {
		if offset, ok := tzOffsetAt(tz, at); ok && !seen[offset] {
			seen[offset] = true
			offsets = append(offsets, offset)
		}
	}
	sort.Ints(offsets)
	return offsets
}

func joinInts(values []int) string {
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = strconv.Itoa(v)
	}
	return strings.Join(parts, ",")
}

// isPrivacyTimeZone 防指纹模式（Tor、Firefox resistFingerprinting 等）会统一报告 UTC
func isPrivacyTimeZone(tz string) bool {
	for _, prefix := range []string{"UTC", "GMT", "Etc/", "Universal", "Zulu"} {
		if strings.HasPrefix(tz, prefix) {
			return true
		}
	}
	return tz == ""
}

func baseLanguage(tag string) string {
	base, _, _ := strings.Cut(strings.TrimSpace(tag), "-")
	return strings.ToLower(base)
}

// languageCountries 语言可能对应的国家与用于推断的首选国家：zh-CN → CN；zh / zh-Hans 以中国为主；英语不参与
func languageCountries(tag string) (countries []string, primary string, ok bool) {
	parts := strings.Split(tag, "-")
	base := strings.ToLower(parts[0])
	if base == "" || base == "en" {
		return nil, "", false
	}
	script := ""
	for _, p := range parts[1:] {
		switch len(p) {
		case 2:
			region := strings.ToUpper(p)
			return []string{region}, region, true
		case 4:
			script = strings.ToLower(p)
		}
	}
	if base == "zh" {
		if script == "hant" {
			return []string{"TW", "HK", "MO"}, "", true
		}
		return []string{"CN", "SG", "MY"}, "CN", true
	}
	if list, found := langCountries[base]; found {
		return list, langPrimary[base], true
	}
	return nil, "", false
}

func parseScreen(screen string) (int, int) {
	w, h, _ := strings.Cut(screen, "x")
	width, _ := strconv.Atoi(w)
	height, _ := strconv.Atoi(h)
	return width, height
}

// trustContext 一次访问的检测上下文：从访问记录派生出各规则共用的中间结果
type trustContext struct {
	log         *model.VisitLog
	languages   []string
	ipCountry   string
	tzPrivacy   bool
	tzCountry   string
	tzKnown     bool // 时区可以识别并算出偏移
	tzOffset    int  // 该时区在访问时刻应有的偏移
	offsetBad   bool // 浏览器时钟偏移与时区不符
	langList    []string
	langPrimary string
	langKnown   bool
}

func newTrustContext(log *model.VisitLog) *trustContext {
	c := &trustContext{log: log, languages: log.LanguageList(), ipCountry: log.IPCountry}
	if !log.HasSignals {
		return c
	}
	c.tzPrivacy = isPrivacyTimeZone(log.TimeZone)
	if !c.tzPrivacy {
		c.tzCountry = tzCountry[log.TimeZone]
		c.tzOffset, c.tzKnown = tzOffsetAt(log.TimeZone, log.CreatedAt)
		c.offsetBad = c.tzKnown && log.UTCOffset != nil && abs(*log.UTCOffset-c.tzOffset) >= 15
	}
	if len(c.languages) > 0 {
		c.langList, c.langPrimary, c.langKnown = languageCountries(c.languages[0])
	}
	return c
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

type ruleOutcome struct {
	status   string
	severity string
	reason   string
	params   map[string]string
}

func outcome(status, severity, reason string, kv []string) ruleOutcome {
	params := map[string]string{}
	for i := 0; i+1 < len(kv); i += 2 {
		params[kv[i]] = kv[i+1]
	}
	return ruleOutcome{status: status, severity: severity, reason: reason, params: params}
}
func skipRule(reason string, kv ...string) ruleOutcome { return outcome(ruleSkip, "", reason, kv) }
func passRule(reason string, kv ...string) ruleOutcome { return outcome(rulePass, "", reason, kv) }
func hitRule(severity, reason string, kv ...string) ruleOutcome {
	return outcome(ruleHit, severity, reason, kv)
}

type trustRule struct {
	id       string
	category string
	check    func(c *trustContext) ruleOutcome
}

// trustRules 一致性规则，文案见前端 Console.visits.trust
var trustRules = []trustRule{
	// 时区与 IP 所在地不符：代理只改出口 IP，不改系统时区
	{"tz_vs_ip", ruleCatLocation, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals:
			return skipRule("no_signals")
		case c.ipCountry == "":
			return skipRule("no_ip")
		case c.tzPrivacy:
			return skipRule("tz_hidden")
		case c.offsetBad:
			return skipRule("offset_conflict")
		case c.tzCountry == "":
			return skipRule("tz_unknown", "tz", c.log.TimeZone)
		case c.tzCountry == c.ipCountry:
			return passRule("tz_ip_match", "country", c.ipCountry)
		}
		offsets := countryOffsets(c.ipCountry, c.log.CreatedAt)
		same := len(offsets) == 0
		for _, o := range offsets {
			if c.log.UTCOffset != nil && o == *c.log.UTCOffset {
				same = true
			}
		}
		severity, reason := sevHigh, "tz_ip_mismatch"
		if same {
			severity, reason = sevMedium, "tz_ip_mismatch_same_offset"
		}
		return hitRule(severity, reason, "tz", c.log.TimeZone, "tz_country", c.tzCountry, "offset", strconv.Itoa(c.tzOffset), "ip_country", c.ipCountry, "ip_offsets", joinInts(offsets))
	}},
	// 语言与 IP 所在地不符：单独不符多是海外用户，与时区同时不符说明 IP 不是真实位置
	{"lang_vs_ip", ruleCatLocation, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals:
			return skipRule("no_signals")
		case c.ipCountry == "":
			return skipRule("no_ip")
		case len(c.languages) == 0:
			return skipRule("no_languages")
		case !c.langKnown:
			return skipRule("lang_universal", "lang", c.languages[0])
		}
		for _, cc := range c.langList {
			if cc == c.ipCountry {
				return passRule("lang_ip_match", "lang", c.languages[0], "country", c.ipCountry)
			}
		}
		params := []string{"lang", c.languages[0], "countries", strings.Join(c.langList, ","), "ip_country", c.ipCountry}
		if c.tzCountry != "" && !c.offsetBad && c.tzCountry != c.ipCountry {
			return hitRule(sevMedium, "lang_ip_mismatch_tz", params...)
		}
		return hitRule(sevLow, "lang_ip_mismatch_local", params...)
	}},
	// 机房 / 云服务商 IP：家庭和手机网络很少直接使用
	{"datacenter_ip", ruleCatLocation, func(c *trustContext) ruleOutcome {
		switch {
		case c.log.Location == "" || c.ipCountry == "":
			return skipRule("no_ip")
		case c.log.ISP == "":
			return skipRule("no_isp")
		case c.log.Datacenter:
			return hitRule(sevMedium, "isp_datacenter", "isp", c.log.ISP)
		}
		return passRule("isp_normal", "isp", c.log.ISP)
	}},
	// 同一访客的 IP 国家突变而时区没变：多半是切换了代理节点
	{"ip_jump", ruleCatLocation, func(c *trustContext) ruleOutcome {
		prev := c.log.PrevCountry
		switch {
		case prev == "":
			return skipRule("no_history")
		case c.ipCountry == "":
			return skipRule("no_ip")
		case prev == c.ipCountry:
			return passRule("ip_same", "country", c.ipCountry)
		case c.tzCountry != "" && c.tzCountry == prev:
			return hitRule(sevLow, "ip_jump", "from", prev, "to", c.ipCountry, "tz", c.log.TimeZone)
		case c.tzCountry == c.ipCountry:
			return passRule("ip_back", "from", prev, "to", c.ipCountry)
		}
		return passRule("ip_moved", "from", prev, "to", c.ipCountry)
	}},
	// 时区被隐藏为 UTC：防指纹模式，时区不参与推断
	{"tz_hidden", ruleCatLocation, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals:
			return skipRule("no_signals")
		case c.tzPrivacy:
			return hitRule(sevLow, "tz_utc", "tz", c.log.TimeZone)
		}
		return passRule("tz_ok", "tz", c.log.TimeZone)
	}},
	// UTC 偏移与时区不符：两者来自同一项设置，不一致说明有脚本只改了其中一个
	{"offset_vs_tz", ruleCatEnv, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals:
			return skipRule("no_signals")
		case c.tzPrivacy:
			return skipRule("tz_hidden")
		case !c.tzKnown || c.log.UTCOffset == nil:
			return skipRule("tz_unknown", "tz", c.log.TimeZone)
		case c.offsetBad:
			return hitRule(sevHigh, "offset_mismatch", "tz", c.log.TimeZone, "expected", strconv.Itoa(c.tzOffset), "offset", strconv.Itoa(*c.log.UTCOffset))
		}
		return passRule("offset_ok", "tz", c.log.TimeZone, "offset", strconv.Itoa(c.tzOffset))
	}},
	// UA 系统与 Client Hints 不符：UA 切换插件通常只改 UA 字符串
	{"ua_vs_ch_platform", ruleCatEnv, func(c *trustContext) ruleOutcome {
		switch {
		case c.log.CHPlatform == "":
			return skipRule("no_ch")
		case c.log.OS == "":
			return skipRule("no_os")
		}
		for _, p := range chPlatforms[c.log.OS] {
			if strings.EqualFold(p, c.log.CHPlatform) {
				return passRule("platform_ok", "os", c.log.OS, "platform", c.log.CHPlatform)
			}
		}
		return hitRule(sevHigh, "platform_mismatch", "os", c.log.OS, "platform", c.log.CHPlatform)
	}},
	// UA 设备类型与 Client Hints 不符
	{"ua_vs_ch_mobile", ruleCatEnv, func(c *trustContext) ruleOutcome {
		if c.log.CHMobile == nil {
			return skipRule("no_ch")
		}
		uaMobile := c.log.DeviceType == utils.DeviceMobile
		switch {
		case uaMobile == *c.log.CHMobile:
			return passRule("mobile_ok")
		case uaMobile:
			return hitRule(sevHigh, "mobile_mismatch_ua")
		}
		return hitRule(sevHigh, "mobile_mismatch_ch")
	}},
	// UA 浏览器与内核不符：只有 Chromium 会发送 Client Hints
	{"ua_engine_vs_ch", ruleCatEnv, func(c *trustContext) ruleOutcome {
		browser := c.log.Browser
		switch browser {
		case "Safari", "Firefox":
			if c.log.CHBrands != "" {
				return hitRule(sevHigh, "engine_fake", "browser", browser, "brands", c.log.CHBrands)
			}
			return passRule("engine_no_ch_ok", "browser", browser)
		case "Chrome", "Edge", "Opera":
			if c.log.OS == "iOS" || c.log.OS == "iPadOS" {
				return skipRule("ios_chrome")
			}
			if c.log.CHBrands == "" {
				return hitRule(sevMedium, "engine_missing_ch", "browser", browser)
			}
			return passRule("engine_ch_ok", "brands", c.log.CHBrands)
		}
		return skipRule("browser_unchecked", "browser", browser)
	}},
	// 自称移动设备却没有触控
	{"mobile_no_touch", ruleCatEnv, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals || c.log.TouchPoints == nil:
			return skipRule("no_signals")
		case c.log.DeviceType != utils.DeviceMobile && c.log.DeviceType != utils.DeviceTablet:
			return skipRule("not_mobile")
		case *c.log.TouchPoints > 0:
			return passRule("touch_ok", "points", strconv.Itoa(*c.log.TouchPoints))
		}
		return hitRule(sevMedium, "no_touch", "device", c.log.DeviceType, "pointer", c.log.Pointer)
	}},
	// 自称手机但屏幕是桌面尺寸
	{"mobile_large_screen", ruleCatEnv, func(c *trustContext) ruleOutcome {
		if !c.log.HasSignals {
			return skipRule("no_signals")
		}
		if c.log.DeviceType != utils.DeviceMobile {
			return skipRule("not_phone")
		}
		w, h := parseScreen(c.log.Screen)
		switch {
		case w == 0 || h == 0:
			return skipRule("screen_zero_skip")
		case min(w, h) < 600:
			return passRule("screen_ok", "screen", c.log.Screen)
		}
		return hitRule(sevLow, "screen_large", "screen", c.log.Screen)
	}},
	// 请求头语言与浏览器语言不符：通常是代理、插件或脚本改写了其中一个
	{"accept_lang_vs_nav", ruleCatEnv, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals:
			return skipRule("no_signals")
		case c.log.AcceptLanguage == "":
			return skipRule("no_accept_language")
		case len(c.languages) == 0:
			return skipRule("no_languages")
		}
		header, _, _ := strings.Cut(c.log.AcceptLanguage, ",")
		header, _, _ = strings.Cut(header, ";")
		header = strings.TrimSpace(header)
		if baseLanguage(header) == baseLanguage(c.languages[0]) {
			return passRule("accept_lang_ok", "lang", baseLanguage(header))
		}
		return hitRule(sevMedium, "accept_lang_mismatch", "header", header, "lang", c.languages[0])
	}},
	// macOS UA 带多点触控：iPadOS 的 Safari 默认请求桌面版网页，按平板统计，不算伪装
	{"ipad_desktop_ua", ruleCatEnv, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals || c.log.TouchPoints == nil:
			return skipRule("no_signals")
		case c.log.OS != "macOS":
			return skipRule("not_macos")
		case *c.log.TouchPoints > 1:
			return hitRule(sevInfo, "ipad", "points", strconv.Itoa(*c.log.TouchPoints))
		}
		return passRule("mac_no_touch")
	}},
	// 浏览器处于 WebDriver 控制下
	{"webdriver", ruleCatAuto, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals:
			return skipRule("no_signals")
		case c.log.Webdriver:
			return hitRule(sevHigh, "webdriver_on")
		}
		return passRule("webdriver_off")
	}},
	// 语言列表为空：多见于无头浏览器
	{"no_languages", ruleCatAuto, func(c *trustContext) ruleOutcome {
		switch {
		case !c.log.HasSignals:
			return skipRule("no_signals")
		case len(c.languages) == 0:
			return hitRule(sevMedium, "languages_empty")
		}
		return passRule("languages_ok", "languages", strings.Join(c.languages, ", "))
	}},
	// 屏幕尺寸为 0：无头浏览器常见
	{"zero_screen", ruleCatAuto, func(c *trustContext) ruleOutcome {
		if !c.log.HasSignals {
			return skipRule("no_signals")
		}
		if w, h := parseScreen(c.log.Screen); w == 0 || h == 0 {
			return hitRule(sevMedium, "screen_zero", "screen", c.log.Screen)
		}
		return passRule("screen_ok", "screen", c.log.Screen)
	}},
}

// analyzeVisitTrust 对一次访问执行全部规则，得出可信度结论、得分与推断地区
func analyzeVisitTrust(log *model.VisitLog) *dto.VisitTrustDto {
	c := newTrustContext(log)
	result := &dto.VisitTrustDto{Verdict: constant.VisitTrustTrusted, Rules: make([]dto.VisitRuleResultDto, 0, len(trustRules))}
	score := 100
	worst := map[string]int{} // 各类别命中的最高严重度
	for _, rule := range trustRules {
		o := rule.check(c)
		result.Rules = append(result.Rules, dto.VisitRuleResultDto{ID: rule.id, Category: rule.category, Status: o.status, Severity: o.severity, Reason: o.reason, Params: o.params})
		if o.status == ruleHit {
			score -= sevPenalty[o.severity]
			worst[rule.category] = max(worst[rule.category], sevRank[o.severity])
		}
	}
	switch {
	case !log.HasSignals:
		result.Verdict = constant.VisitTrustUnknown
	case worst[ruleCatAuto] >= sevRank[sevMedium]:
		result.Verdict = constant.VisitTrustBot
	case worst[ruleCatEnv] >= sevRank[sevMedium]:
		result.Verdict = constant.VisitTrustSpoofed
	case worst[ruleCatLocation] >= sevRank[sevMedium]:
		result.Verdict = constant.VisitTrustProxy
	}
	if log.HasSignals {
		score = max(score, 0)
		result.Score = &score
	}
	inferVisitCountry(c, result)
	return result
}

// inferVisitCountry 地区推断：IP、时区、语言按权重投票，票数相同时依次信任时区、IP、语言
func inferVisitCountry(c *trustContext, result *dto.VisitTrustDto) {
	log := c.log
	ip := dto.VisitTrustSourceDto{Key: "ip", Value: log.Location, Country: c.ipCountry}
	switch {
	case c.ipCountry == "" && log.Location == "局域网":
		ip.Note = "reserved"
	case c.ipCountry == "":
		ip.Note = "no_region"
	case log.Datacenter:
		ip.Note = "datacenter"
	default:
		ip.Weight = trustWeightIP
	}
	tz := dto.VisitTrustSourceDto{Key: "tz", Value: log.TimeZone, Country: c.tzCountry}
	switch {
	case !log.HasSignals:
		tz.Note = "no_signals"
	case c.tzPrivacy:
		tz.Note = "tz_hidden"
	case c.offsetBad:
		tz.Note = "offset_conflict"
	case c.tzCountry == "":
		tz.Note = "tz_unknown"
	default:
		tz.Weight = trustWeightTZ
	}
	lang := dto.VisitTrustSourceDto{Key: "lang", Value: strings.Join(c.languages, ", "), Country: c.langPrimary}
	switch {
	case !log.HasSignals:
		lang.Note = "no_signals"
	case len(c.languages) == 0:
		lang.Note = "no_languages"
	case !c.langKnown:
		lang.Note = "lang_universal"
	case c.langPrimary == "":
		lang.Note = "lang_ambiguous"
	default:
		lang.Weight = trustWeightLang
	}

	// 按信任顺序（时区、IP、语言）累计票数，同票时先出现的胜出
	ordered := []*dto.VisitTrustSourceDto{&tz, &ip, &lang}
	votes := map[string]int{}
	var order []string
	for _, s := range ordered {
		if s.Weight == 0 {
			continue
		}
		if _, ok := votes[s.Country]; !ok {
			order = append(order, s.Country)
		}
		votes[s.Country] += s.Weight
	}
	best, second := "", 0
	for _, cc := range order {
		if best == "" || votes[cc] > votes[best] {
			if best != "" {
				second = max(second, votes[best])
			}
			best = cc
		} else {
			second = max(second, votes[cc])
		}
	}
	for _, s := range ordered {
		if s.Weight > 0 {
			agree := s.Country == best
			s.Agree = &agree
		}
	}
	result.Sources = []dto.VisitTrustSourceDto{ip, tz, lang}
	if best == "" {
		return
	}
	result.Country = best
	result.IPTrusted = ip.Weight > 0 && c.ipCountry == best
	switch score := votes[best]; {
	case score >= 3 && score-second >= 2:
		result.Confidence = "high"
	case score >= 2 && score > second:
		result.Confidence = "medium"
	default:
		result.Confidence = "low"
	}
}

// applyVisitTrust 写入访问记录前计算一致性结果，保存结论、得分、推断国家与命中的规则
func applyVisitTrust(log *model.VisitLog) {
	trust := analyzeVisitTrust(log)
	log.Trust = trust.Verdict
	log.TrustScore = trust.Score
	log.InferredCountry = trust.Country
	hits := make([]dto.VisitRuleResultDto, 0)
	for _, r := range trust.Rules {
		if r.Status == ruleHit {
			hits = append(hits, r)
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return sevRank[hits[i].Severity] > sevRank[hits[j].Severity] })
	flags := make([]string, len(hits))
	for i, r := range hits {
		flags[i] = r.ID + ":" + r.Severity
		// UA 与 Mac 相同的 iPad 按平板统计
		if r.ID == "ipad_desktop_ua" {
			log.DeviceType = utils.DeviceTablet
		}
	}
	log.TrustFlags = utils.Truncate(strings.Join(flags, ","), 512)
}

var (
	chBrandPattern     = regexp.MustCompile(`"([^"]*)"\s*;\s*v="([^"]*)"`)
	timeZonePattern    = regexp.MustCompile(`^[A-Za-z0-9_+\-/]{1,64}$`)
	screenPattern      = regexp.MustCompile(`^\d{1,5}x\d{1,5}$`)
	languageTagPattern = regexp.MustCompile(`^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8}){0,3}$`)
)

// parseCHBrands 解析 Sec-CH-UA，去掉占位品牌：Chromium 152 · Google Chrome 152
func parseCHBrands(header string) string {
	var brands []string
	for _, m := range chBrandPattern.FindAllStringSubmatch(header, -1) {
		if strings.Contains(strings.ToLower(m[1]), "brand") {
			continue
		}
		brands = append(brands, m[1]+" "+m[2])
	}
	return strings.Join(brands, " · ")
}

// parseCHMobile 解析 Sec-CH-UA-Mobile：?1 为手机，?0 为非手机
func parseCHMobile(header string) *bool {
	switch strings.TrimSpace(header) {
	case "?1":
		mobile := true
		return &mobile
	case "?0":
		mobile := false
		return &mobile
	}
	return nil
}

// fillVisitSignals 把请求头与浏览器上报的信号写入访问记录，非法值直接丢弃
func fillVisitSignals(log *model.VisitLog, signals *dto.VisitSignals, client VisitClient) {
	log.AcceptLanguage = utils.Truncate(strings.TrimSpace(client.AcceptLanguage), 128)
	log.CHPlatform = utils.Truncate(strings.Trim(strings.TrimSpace(client.CHUAPlatform), `"`), 32)
	log.CHMobile = parseCHMobile(client.CHUAMobile)
	log.CHBrands = utils.Truncate(parseCHBrands(client.CHUA), 255)
	if signals == nil {
		return
	}
	log.HasSignals = true
	if timeZonePattern.MatchString(signals.TimeZone) {
		log.TimeZone = signals.TimeZone
	}
	if o := signals.UTCOffset; o != nil && *o >= -14*60 && *o <= 14*60 {
		log.UTCOffset = o
	}
	languages := make([]string, 0, 3)
	for _, tag := range signals.Languages {
		if len(languages) < 3 && languageTagPattern.MatchString(tag) {
			languages = append(languages, tag)
		}
	}
	log.Languages = strings.Join(languages, ",")
	if screenPattern.MatchString(signals.Screen) {
		log.Screen = signals.Screen
	}
	if signals.DPR > 0 && signals.DPR <= 10 {
		log.DPR = signals.DPR
	}
	if t := signals.TouchPoints; t != nil && *t >= 0 && *t <= 32 {
		log.TouchPoints = t
	}
	if signals.Pointer == "fine" || signals.Pointer == "coarse" {
		log.Pointer = signals.Pointer
	}
	if signals.ColorScheme == "light" || signals.ColorScheme == "dark" {
		log.ColorScheme = signals.ColorScheme
	}
	log.Webdriver = signals.Webdriver
}
