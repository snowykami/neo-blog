package service

import (
	"net/http"
	"net/url"
	"path"
	"slices"
	"strings"

	"github.com/snowykami/neo-blog/internal/model"
	"golang.org/x/net/html"
)

const maxFriendTechItems = 12

type friendTechDef struct {
	ID       string
	Name     string
	Category string
	Priority int
}

var friendTechCatalog = map[string]friendTechDef{
	// CDN / 边缘 / WAF（category = cdn）
	"cloudflare":   {ID: "cloudflare", Name: "Cloudflare", Category: model.FriendTechCategoryCDN, Priority: 10},
	"vercel":       {ID: "vercel", Name: "Vercel", Category: model.FriendTechCategoryCDN, Priority: 11},
	"edgeone":      {ID: "edgeone", Name: "EdgeOne", Category: model.FriendTechCategoryCDN, Priority: 12},
	"netlify":      {ID: "netlify", Name: "Netlify", Category: model.FriendTechCategoryCDN, Priority: 13},
	"github-pages": {ID: "github-pages", Name: "GitHub Pages", Category: model.FriendTechCategoryCDN, Priority: 14},
	"cloudfront":   {ID: "cloudfront", Name: "CloudFront", Category: model.FriendTechCategoryCDN, Priority: 15},
	"fastly":       {ID: "fastly", Name: "Fastly", Category: model.FriendTechCategoryCDN, Priority: 16},
	"aliyun-cdn":   {ID: "aliyun-cdn", Name: "Aliyun CDN", Category: model.FriendTechCategoryCDN, Priority: 17},
	"tencent-cdn":  {ID: "tencent-cdn", Name: "Tencent CDN", Category: model.FriendTechCategoryCDN, Priority: 18},
	"deno-deploy":  {ID: "deno-deploy", Name: "Deno Deploy", Category: model.FriendTechCategoryCDN, Priority: 19},
	"zeabur":       {ID: "zeabur", Name: "Zeabur", Category: model.FriendTechCategoryCDN, Priority: 20},

	// Web 服务器（category = server）
	"openresty": {ID: "openresty", Name: "OpenResty", Category: model.FriendTechCategoryServer, Priority: 30},
	"tengine":   {ID: "tengine", Name: "Tengine", Category: model.FriendTechCategoryServer, Priority: 31},
	"nginx":     {ID: "nginx", Name: "Nginx", Category: model.FriendTechCategoryServer, Priority: 32},
	"caddy":     {ID: "caddy", Name: "Caddy", Category: model.FriendTechCategoryServer, Priority: 33},
	"traefik":   {ID: "traefik", Name: "Traefik", Category: model.FriendTechCategoryServer, Priority: 34},
	"apache":    {ID: "apache", Name: "Apache", Category: model.FriendTechCategoryServer, Priority: 35},
	"litespeed": {ID: "litespeed", Name: "LiteSpeed", Category: model.FriendTechCategoryServer, Priority: 36},
	"envoy":     {ID: "envoy", Name: "Envoy", Category: model.FriendTechCategoryServer, Priority: 37},

	// 博客 / CMS 软件（category = cms）
	"neo-blog":    {ID: "neo-blog", Name: "neo-blog", Category: model.FriendTechCategoryCMS, Priority: 50},
	"hexo":        {ID: "hexo", Name: "Hexo", Category: model.FriendTechCategoryCMS, Priority: 51},
	"hugo":        {ID: "hugo", Name: "Hugo", Category: model.FriendTechCategoryCMS, Priority: 52},
	"astro":       {ID: "astro", Name: "Astro", Category: model.FriendTechCategoryCMS, Priority: 53},
	"wordpress":   {ID: "wordpress", Name: "WordPress", Category: model.FriendTechCategoryCMS, Priority: 54},
	"halo":        {ID: "halo", Name: "Halo", Category: model.FriendTechCategoryCMS, Priority: 55},
	"typecho":     {ID: "typecho", Name: "Typecho", Category: model.FriendTechCategoryCMS, Priority: 56},
	"mix-space":   {ID: "mix-space", Name: "MixSpace", Category: model.FriendTechCategoryCMS, Priority: 57},
	"vitepress":   {ID: "vitepress", Name: "VitePress", Category: model.FriendTechCategoryCMS, Priority: 58},
	"vuepress":    {ID: "vuepress", Name: "VuePress", Category: model.FriendTechCategoryCMS, Priority: 59},
	"ghost":       {ID: "ghost", Name: "Ghost", Category: model.FriendTechCategoryCMS, Priority: 60},
	"jekyll":      {ID: "jekyll", Name: "Jekyll", Category: model.FriendTechCategoryCMS, Priority: 61},
	"gridea":      {ID: "gridea", Name: "Gridea", Category: model.FriendTechCategoryCMS, Priority: 62},
	"docusaurus":  {ID: "docusaurus", Name: "Docusaurus", Category: model.FriendTechCategoryCMS, Priority: 63},
	"notion-next": {ID: "notion-next", Name: "NotionNext", Category: model.FriendTechCategoryCMS, Priority: 64},

	// 前端框架（category = framework）
	"nextjs":    {ID: "nextjs", Name: "Next.js", Category: model.FriendTechCategoryFramework, Priority: 80},
	"nuxt":      {ID: "nuxt", Name: "Nuxt", Category: model.FriendTechCategoryFramework, Priority: 81},
	"sveltekit": {ID: "sveltekit", Name: "SvelteKit", Category: model.FriendTechCategoryFramework, Priority: 82},
	"react":     {ID: "react", Name: "React", Category: model.FriendTechCategoryFramework, Priority: 83},
	"vue":       {ID: "vue", Name: "Vue", Category: model.FriendTechCategoryFramework, Priority: 84},
	"jquery":    {ID: "jquery", Name: "jQuery", Category: model.FriendTechCategoryFramework, Priority: 85},
}

// friendTechProbeHeaderAllowlist 拨测时保留用于技术栈指纹识别的响应头白名单（避免保留无关长头）
var friendTechProbeHeaderAllowlist = []string{
	"Content-Type",
	"Server",
	"Via",
	"X-Powered-By",
	"CF-Ray",
	"Cf-Cache-Status",
	"Cf-Mitigated",
	"X-Vercel-Id",
	"X-Vercel-Cache",
	"EO-Log-UUID",
	"EO-Cache-Status",
	"X-EdgeOne-Request-Id",
	"X-NF-Request-ID",
	"Netlify-Vary",
	"X-GitHub-Request-Id",
	"X-Amz-Cf-Id",
	"X-Amz-Cf-Pop",
	"X-Fastly-Request-ID",
	"Fastly-Restarts",
	"Fastly-Debug-Digest",
	"X-Served-By",
	"X-Cache",
	"X-Timer",
	"EagleId",
	"EagleEye-TraceId",
	"Ali-Swift-Global-Savetime",
	"X-Swift-SaveTime",
	"X-Esa-Request-Id",
	"X-Nws-Log-Uuid",
	"X-Daa-Tunnel",
	"X-Deno-Ray",
	"X-Zeabur-Request-Id",
	"X-Zeabur-IP-Country",
	"X-LiteSpeed-Cache",
	"X-Turbo-Charged-By",
	"X-Envoy-Upstream-Service-Time",
	"X-Ghost-Cache-Status",
	"X-Pingback",
	"Link",
}

var friendTechAllowedHeaderMap = func() map[string]string {
	m := make(map[string]string, len(friendTechProbeHeaderAllowlist))
	for _, k := range friendTechProbeHeaderAllowlist {
		m[strings.ToLower(k)] = http.CanonicalHeaderKey(k)
	}
	return m
}()

// normalizeTechHeaders 将可能包含非规范大小写键（如 HTTP/2 小写头或 map 字面量）的 Header 归一化为标准 Canonical 键
func normalizeTechHeaders(src http.Header) http.Header {
	if len(src) == 0 {
		return nil
	}
	needsCopy := false
	for k := range src {
		if http.CanonicalHeaderKey(k) != k {
			needsCopy = true
			break
		}
	}
	if !needsCopy {
		return src
	}
	dst := make(http.Header, len(src))
	for k, vals := range src {
		ck := http.CanonicalHeaderKey(k)
		dst[ck] = append(dst[ck], vals...)
	}
	return dst
}

// cloneFriendTechHeaders 提取并脱敏拷贝指纹识别所需的响应头（兼容任意大小写键；Set-Cookie 仅保留脱敏后的 Cookie 名，不留任何凭据值）
func cloneFriendTechHeaders(src http.Header) http.Header {
	if len(src) == 0 {
		return nil
	}
	dst := make(http.Header, 8)
	cookieCount := 0
	for rawKey, vals := range src {
		lowerKey := strings.ToLower(strings.TrimSpace(rawKey))
		if lowerKey == "set-cookie" {
			for i := 0; i < len(vals) && cookieCount < 16; i++ {
				first := strings.TrimSpace(vals[i])
				if semi := strings.IndexByte(first, ';'); semi >= 0 {
					first = first[:semi]
				}
				if eq := strings.IndexByte(first, '='); eq > 0 && eq <= 96 {
					name := strings.TrimSpace(first[:eq])
					if name != "" {
						dst.Add("Set-Cookie", name+"=1")
						cookieCount++
					}
				}
			}
			continue
		}
		canonicalKey, allowed := friendTechAllowedHeaderMap[lowerKey]
		if !allowed {
			continue
		}
		for i := 0; i < len(vals) && len(dst[canonicalKey]) < 4; i++ {
			v := strings.TrimSpace(vals[i])
			if v == "" {
				continue
			}
			if len(v) > 1024 {
				v = v[:1024]
			}
			dst.Add(canonicalKey, v)
		}
	}
	return dst
}

func isHTMLOrUnknownContentType(headers http.Header) bool {
	headers = normalizeTechHeaders(headers)
	if len(headers) == 0 {
		return true
	}
	ct := strings.ToLower(strings.TrimSpace(headers.Get("Content-Type")))
	if ct == "" {
		return true
	}
	return strings.Contains(ct, "text/html") || strings.Contains(ct, "application/xhtml+xml")
}

// isLikelyWAFInterstitial 判断响应是否为常见边缘 WAF / Bot 挑战拦截页（覆盖 HTTP 401/403/405/429/468/503 与 HTTP 200 JS 盾页）
func isLikelyWAFInterstitial(status int, headers http.Header, rawHTML string) bool {
	headers = normalizeTechHeaders(headers)
	if headers != nil && headers.Get("Cf-Mitigated") != "" {
		return true
	}
	server := ""
	if headers != nil {
		server = strings.ToLower(headers.Get("Server"))
	}
	cookieNames := extractCookieNamesLower(headers)

	if status == http.StatusForbidden || status == http.StatusServiceUnavailable || status == http.StatusTooManyRequests {
		if strings.Contains(server, "cloudflare") ||
			strings.Contains(server, "edgeone") ||
			(headers != nil && (headers.Get("CF-Ray") != "" || headers.Get("EO-Log-UUID") != "" || headers.Get("X-EdgeOne-Request-Id") != "")) ||
			hasCookiePrefix(cookieNames, "__eo_bot_ssid", "sl-session", "sl-challenge") {
			return true
		}
	}
	if (status == http.StatusMethodNotAllowed || status == http.StatusForbidden) && hasCookiePrefix(cookieNames, "acw_sc__v2") {
		return true
	}
	if status == 468 && hasCookiePrefix(cookieNames, "sl-session", "sl-challenge") {
		return true
	}

	if rawHTML == "" {
		return false
	}
	headSample := rawHTML
	if len(headSample) > 16384 {
		headSample = headSample[:16384]
	}
	lowerSample := strings.ToLower(headSample)

	// Cloudflare JS / Turnstile 挑战页（含多语言标题）
	if strings.Contains(lowerSample, "id=\"challenge-error-text\"") ||
		strings.Contains(lowerSample, "window._cf_chl_opt") ||
		strings.Contains(lowerSample, "id=\"cf-chl-widget") ||
		strings.Contains(lowerSample, "<title>attention required! | cloudflare") ||
		(strings.Contains(lowerSample, "/cdn-cgi/challenge-platform/") &&
			(strings.Contains(lowerSample, "<title>just a moment") ||
				strings.Contains(lowerSample, "<title>请稍候") ||
				strings.Contains(lowerSample, "<title>請稍候") ||
				strings.Contains(lowerSample, "cf-browser-verification"))) {
		return true
	}
	// 雷池 SafeLine WAF（锚定真实标签/属性，防止自建博文正文提及 /_safeline/ 等词误判为盾页）
	if strings.Contains(lowerSample, "src=\"/_safeline/") ||
		strings.Contains(lowerSample, "src='/_safeline/") ||
		strings.Contains(lowerSample, "href=\"/_safeline/") ||
		strings.Contains(lowerSample, "href='/_safeline/") ||
		strings.Contains(lowerSample, "class=\"sl-challenge") ||
		strings.Contains(lowerSample, "id=\"sl-challenge") ||
		strings.Contains(lowerSample, "<safeline-") {
		return true
	}
	// 阿里云 WAF / ESA 动态 JS 挑战页
	if (strings.Contains(lowerSample, "acw_sc__v2") && strings.Contains(lowerSample, "var arg1=")) ||
		strings.Contains(lowerSample, "id=\"aliyunwaf_") ||
		strings.Contains(lowerSample, "src=\"/_aliyunwaf/") {
		return true
	}
	// 腾讯云 EdgeOne JS 挑战页
	if hasCookiePrefix(cookieNames, "__eo_bot_ssid") ||
		strings.Contains(lowerSample, "src=\"/__eo_bot_") ||
		strings.Contains(lowerSample, "src='/__eo_bot_") {
		return true
	}
	// Anubis PoW 挑战页（独立博客常见反爬网关）
	if strings.Contains(lowerSample, "id=\"anubis_version\"") ||
		strings.Contains(lowerSample, "src=\"/.within.website/x/cmd/anubis/") ||
		strings.Contains(lowerSample, "href=\"/.within.website/x/cmd/anubis/") ||
		(strings.Contains(lowerSample, "<title>making sure you") && strings.Contains(lowerSample, "anubis")) {
		return true
	}
	return false
}

func isASCIIAlphaNum(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9')
}

// containsWordToken 判断 lowerHaystack 中是否包含以非字母数字为边界的独立词 token（均为小写）
func containsWordToken(lowerHaystack, token string) bool {
	if lowerHaystack == "" || token == "" {
		return false
	}
	from := 0
	for from < len(lowerHaystack) {
		idx := strings.Index(lowerHaystack[from:], token)
		if idx < 0 {
			return false
		}
		abs := from + idx
		end := abs + len(token)
		leftOK := abs == 0 || !isASCIIAlphaNum(lowerHaystack[abs-1])
		rightOK := end >= len(lowerHaystack) || !isASCIIAlphaNum(lowerHaystack[end])
		if leftOK && rightOK {
			return true
		}
		from = abs + len(token)
	}
	return false
}

func extractCookieNamesLower(headers http.Header) []string {
	if len(headers) == 0 {
		return nil
	}
	rawCookies := headers.Values("Set-Cookie")
	if len(rawCookies) == 0 {
		return nil
	}
	names := make([]string, 0, len(rawCookies))
	for _, raw := range rawCookies {
		first := raw
		if semi := strings.IndexByte(first, ';'); semi >= 0 {
			first = first[:semi]
		}
		if eq := strings.IndexByte(first, '='); eq > 0 {
			name := strings.ToLower(strings.TrimSpace(first[:eq]))
			if name != "" {
				names = append(names, name)
			}
		}
	}
	return names
}

func hasCookiePrefix(cookieNames []string, prefixes ...string) bool {
	for _, name := range cookieNames {
		for _, p := range prefixes {
			if name == p || strings.HasPrefix(name, p) {
				return true
			}
		}
	}
	return false
}

type parsedTechAssetURL struct {
	pathLower    string
	isRelative   bool
	isExactHost  bool
	isSameFamily bool
}

func parseTechAssetURL(rawURL, siteHost string) (parsedTechAssetURL, bool) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.Contains(trimmed, "\\") {
		return parsedTechAssetURL{}, false
	}
	lowerTrimmed := strings.ToLower(trimmed)
	if strings.HasPrefix(lowerTrimmed, "data:") ||
		strings.HasPrefix(lowerTrimmed, "javascript:") ||
		strings.HasPrefix(lowerTrimmed, "mailto:") ||
		strings.HasPrefix(lowerTrimmed, "blob:") {
		return parsedTechAssetURL{}, false
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return parsedTechAssetURL{}, false
	}

	isRelative := u.Scheme == "" && u.Host == "" && !strings.HasPrefix(trimmed, "//")
	if !isRelative && u.Scheme != "" && u.Scheme != "http" && u.Scheme != "https" {
		return parsedTechAssetURL{}, false
	}

	rawPath := u.Path
	if rawPath == "" {
		return parsedTechAssetURL{}, false
	}
	hadTrailingSlash := strings.HasSuffix(rawPath, "/")
	cleaned := path.Clean("/" + rawPath)
	if hadTrailingSlash && cleaned != "/" {
		cleaned += "/"
	}
	pathLower := strings.ToLower(cleaned)

	if isRelative {
		return parsedTechAssetURL{
			pathLower:    pathLower,
			isRelative:   true,
			isExactHost:  true,
			isSameFamily: true,
		}, true
	}

	candHost := u.Hostname()
	if siteHost == "" || candHost == "" {
		return parsedTechAssetURL{
			pathLower:  pathLower,
			isRelative: false,
		}, true
	}

	normSite := normalizeASCIIHost(siteHost)
	normCand := normalizeASCIIHost(candHost)
	exact := normSite != "" && normSite == normCand
	sameFamily := exact || sameFriendSiteFamily(siteHost, candHost)
	return parsedTechAssetURL{
		pathLower:    pathLower,
		isRelative:   false,
		isExactHost:  exact,
		isSameFamily: sameFamily,
	}, true
}

func isExecutableInlineScriptType(scriptType string) bool {
	if scriptType == "" {
		return true
	}
	if semi := strings.IndexByte(scriptType, ';'); semi >= 0 {
		scriptType = strings.TrimSpace(scriptType[:semi])
	}
	switch scriptType {
	case "text/javascript", "application/javascript", "application/x-javascript",
		"text/ecmascript", "application/ecmascript", "module":
		return true
	default:
		return false
	}
}

func isVueScopedAttr(attrLower string) bool {
	if attrLower == "data-v-app" {
		return true
	}
	if !strings.HasPrefix(attrLower, "data-v-") {
		return false
	}
	hash := attrLower[len("data-v-"):]
	if len(hash) < 6 || len(hash) > 12 {
		return false
	}
	for i := 0; i < len(hash); i++ {
		c := hash[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func matchesJQueryAssetPath(pathLower string) bool {
	if !strings.Contains(pathLower, "jquery") || !strings.HasSuffix(pathLower, ".js") {
		return false
	}
	base := pathLower
	if slash := strings.LastIndexByte(base, '/'); slash >= 0 {
		base = base[slash+1:]
	}
	if !strings.HasPrefix(base, "jquery") {
		return false
	}
	rest := strings.TrimPrefix(base, "jquery")
	if rest == ".js" || rest == ".min.js" || rest == ".slim.js" || rest == ".slim.min.js" {
		return true
	}
	if len(rest) > 1 && (rest[0] == '-' || rest[0] == '.') && rest[1] >= '0' && rest[1] <= '9' {
		return true
	}
	return false
}

func matchesExplicitFrameworkAsset(pathLower, pkg string) bool {
	if !strings.HasSuffix(pathLower, ".js") && !strings.HasSuffix(pathLower, ".mjs") {
		return false
	}
	base := pathLower
	if slash := strings.LastIndexByte(base, '/'); slash >= 0 {
		base = base[slash+1:]
	}
	switch pkg {
	case "react":
		return base == "react.js" ||
			base == "react.min.js" ||
			strings.HasPrefix(base, "react.production.") ||
			strings.HasPrefix(base, "react.development.") ||
			strings.HasPrefix(base, "react-dom.")
	case "vue":
		return base == "vue.js" ||
			base == "vue.min.js" ||
			strings.HasPrefix(base, "vue.global.") ||
			strings.HasPrefix(base, "vue.runtime.") ||
			strings.HasPrefix(base, "vue.esm-browser.")
	default:
		return false
	}
}

func detectCDNTechs(headers http.Header, cookieNames []string, add func(string)) {
	if len(headers) == 0 {
		return
	}
	server := strings.ToLower(strings.Join(headers.Values("Server"), " "))
	via := strings.ToLower(strings.Join(headers.Values("Via"), " "))

	if headers.Get("CF-Ray") != "" ||
		headers.Get("Cf-Cache-Status") != "" ||
		headers.Get("Cf-Mitigated") != "" ||
		containsWordToken(server, "cloudflare") ||
		hasCookiePrefix(cookieNames, "__cf_bm", "cf_clearance", "__cfduid") {
		add("cloudflare")
	}
	if headers.Get("X-Vercel-Id") != "" ||
		headers.Get("X-Vercel-Cache") != "" ||
		containsWordToken(server, "vercel") {
		add("vercel")
	}
	if headers.Get("EO-Log-UUID") != "" ||
		headers.Get("EO-Cache-Status") != "" ||
		headers.Get("X-EdgeOne-Request-Id") != "" ||
		containsWordToken(server, "edgeone") {
		add("edgeone")
	}
	if headers.Get("X-NF-Request-ID") != "" ||
		headers.Get("Netlify-Vary") != "" ||
		containsWordToken(server, "netlify") {
		add("netlify")
	}
	if headers.Get("X-GitHub-Request-Id") != "" ||
		strings.Contains(server, "github.com") {
		add("github-pages")
	}
	if headers.Get("X-Amz-Cf-Id") != "" ||
		headers.Get("X-Amz-Cf-Pop") != "" ||
		strings.Contains(via, "cloudfront") ||
		containsWordToken(server, "cloudfront") {
		add("cloudfront")
	}
	if headers.Get("X-Fastly-Request-ID") != "" ||
		headers.Get("Fastly-Restarts") != "" ||
		headers.Get("Fastly-Debug-Digest") != "" ||
		(strings.Contains(strings.ToLower(headers.Get("X-Served-By")), "cache-") &&
			headers.Get("X-Cache") != "" &&
			headers.Get("X-Timer") != "") {
		add("fastly")
	}
	if headers.Get("EagleId") != "" ||
		headers.Get("EagleEye-TraceId") != "" ||
		headers.Get("Ali-Swift-Global-Savetime") != "" ||
		headers.Get("X-Swift-SaveTime") != "" ||
		headers.Get("X-Esa-Request-Id") != "" ||
		containsWordToken(via, "kunlun") ||
		containsWordToken(server, "esa") {
		add("aliyun-cdn")
	}
	if headers.Get("X-Nws-Log-Uuid") != "" ||
		headers.Get("X-Daa-Tunnel") != "" ||
		containsWordToken(server, "nws") ||
		containsWordToken(via, "nws") {
		add("tencent-cdn")
	}
	if headers.Get("X-Deno-Ray") != "" ||
		strings.Contains(server, "deno/") ||
		containsWordToken(server, "deno") {
		add("deno-deploy")
	}
	if headers.Get("X-Zeabur-Request-Id") != "" ||
		headers.Get("X-Zeabur-IP-Country") != "" ||
		containsWordToken(server, "zeabur") {
		add("zeabur")
	}
}

func detectServerTechs(headers http.Header, add func(string)) {
	if len(headers) == 0 {
		return
	}
	server := strings.ToLower(strings.Join(headers.Values("Server"), " "))
	via := strings.ToLower(strings.Join(headers.Values("Via"), " "))
	turbo := strings.ToLower(headers.Get("X-Turbo-Charged-By"))

	if containsWordToken(server, "openresty") {
		add("openresty")
	}
	if containsWordToken(server, "tengine") {
		add("tengine")
	}
	if containsWordToken(server, "nginx") {
		add("nginx")
	}
	if containsWordToken(server, "caddy") || containsWordToken(via, "caddy") {
		add("caddy")
	}
	if containsWordToken(server, "traefik") || containsWordToken(via, "traefik") {
		add("traefik")
	}
	if containsWordToken(server, "apache") {
		add("apache")
	}
	if containsWordToken(server, "litespeed") || headers.Get("X-LiteSpeed-Cache") != "" || containsWordToken(turbo, "litespeed") {
		add("litespeed")
	}
	if containsWordToken(server, "envoy") || headers.Get("X-Envoy-Upstream-Service-Time") != "" {
		add("envoy")
	}
}

func matchGeneratorMeta(genLower string, add func(string)) {
	if genLower == "" {
		return
	}
	if strings.Contains(genLower, "neo-blog") {
		add("neo-blog")
	}
	if containsWordToken(genLower, "hexo") {
		add("hexo")
	}
	if containsWordToken(genLower, "hugo") {
		add("hugo")
	}
	if containsWordToken(genLower, "astro") {
		add("astro")
	}
	if strings.Contains(genLower, "wordpress") {
		add("wordpress")
	}
	if containsWordToken(genLower, "halo") {
		add("halo")
	}
	if containsWordToken(genLower, "typecho") {
		add("typecho")
	}
	if strings.Contains(genLower, "mixspace") || strings.Contains(genLower, "mix-space") || containsWordToken(genLower, "mix space") {
		add("mix-space")
	}
	if containsWordToken(genLower, "vitepress") {
		add("vitepress")
	}
	if containsWordToken(genLower, "vuepress") {
		add("vuepress")
	}
	if containsWordToken(genLower, "ghost") {
		add("ghost")
	}
	if containsWordToken(genLower, "jekyll") {
		add("jekyll")
	}
	if containsWordToken(genLower, "gridea") {
		add("gridea")
	}
	if containsWordToken(genLower, "docusaurus") {
		add("docusaurus")
	}
	if strings.Contains(genLower, "notionnext") || strings.Contains(genLower, "notion-next") {
		add("notion-next")
	}
	if strings.Contains(genLower, "next.js") {
		add("nextjs")
	}
	if containsWordToken(genLower, "nuxt") {
		add("nuxt")
	}
	if containsWordToken(genLower, "sveltekit") {
		add("sveltekit")
	}
}

func inspectAssetURLForTech(rawURL, siteHost, tag string, add func(string)) {
	parsed, ok := parseTechAssetURL(rawURL, siteHost)
	if !ok || parsed.pathLower == "" {
		return
	}
	pathLower := parsed.pathLower

	// 1. <img> / <source> 以及 neo-blog 文件接口必须限定为相对路径或完全同主机，严防友链页展示其他博友头像（含本站头像）造成跨站假阳性
	if parsed.isExactHost && (pathLower == "/api/site-icon" || strings.HasPrefix(pathLower, "/api/v1/file/f/")) {
		add("neo-blog")
	}
	if tag == "img" || tag == "source" {
		if !parsed.isExactHost {
			return
		}
		if strings.Contains(pathLower, "/wp-content/") || strings.Contains(pathLower, "/wp-includes/") {
			add("wordpress")
		}
		if strings.Contains(pathLower, "/usr/themes/") || strings.Contains(pathLower, "/usr/plugins/") {
			add("typecho")
		}
		if strings.Contains(pathLower, "/_astro/") || strings.HasPrefix(pathLower, "/_astro/") {
			add("astro")
		}
		return
	}

	// 2. 结构化框架/CMS 构建产物路径仅信任相对路径或同一可注册根域家族（如 cdn.example.com），拦截 giscus.app / wp.com 等第三方挂件污染
	if parsed.isSameFamily {
		if strings.Contains(pathLower, "/_next/static/") || strings.HasPrefix(pathLower, "/_next/") {
			add("nextjs")
		}
		if strings.Contains(pathLower, "/_nuxt/") || strings.HasPrefix(pathLower, "/_nuxt/") {
			add("nuxt")
		}
		if strings.Contains(pathLower, "/_astro/") || strings.HasPrefix(pathLower, "/_astro/") {
			add("astro")
		}
		if strings.Contains(pathLower, "/_app/immutable/") {
			add("sveltekit")
		}
		if strings.Contains(pathLower, "/wp-content/") || strings.Contains(pathLower, "/wp-includes/") {
			add("wordpress")
		}
		if strings.Contains(pathLower, "/usr/themes/") || strings.Contains(pathLower, "/usr/plugins/") {
			add("typecho")
		}
		if strings.Contains(pathLower, "/apis/api.halo.run/") || strings.HasSuffix(pathLower, "/halo-tracker.js") {
			add("halo")
		}
		if strings.Contains(pathLower, "/media/gridea-search/") {
			add("gridea")
		}
	}

	// 3. 显式前端运行时脚本包（如公共 CDN 上的 jquery.min.js / vue.global.prod.js）在 <script src> 上允许跨源识别
	if tag == "script" {
		if matchesJQueryAssetPath(pathLower) {
			add("jquery")
		}
		if matchesExplicitFrameworkAsset(pathLower, "react") {
			add("react")
		}
		if matchesExplicitFrameworkAsset(pathLower, "vue") {
			add("vue")
		}
	}
}

func finalizeTechList(hitSet map[string]struct{}) []model.FriendTechItem {
	if len(hitSet) == 0 {
		return []model.FriendTechItem{}
	}
	// 框架蕴含推导（Next.js / Docusaurus -> React；Nuxt / VitePress / VuePress -> Vue）
	if _, ok := hitSet["nextjs"]; ok {
		hitSet["react"] = struct{}{}
	}
	if _, ok := hitSet["docusaurus"]; ok {
		hitSet["react"] = struct{}{}
	}
	if _, ok := hitSet["notion-next"]; ok {
		hitSet["nextjs"] = struct{}{}
		hitSet["react"] = struct{}{}
	}
	if _, ok := hitSet["nuxt"]; ok {
		hitSet["vue"] = struct{}{}
	}
	if _, ok := hitSet["vitepress"]; ok {
		hitSet["vue"] = struct{}{}
	}
	if _, ok := hitSet["vuepress"]; ok {
		hitSet["vue"] = struct{}{}
	}

	defs := make([]friendTechDef, 0, len(hitSet))
	for id := range hitSet {
		if def, ok := friendTechCatalog[id]; ok {
			defs = append(defs, def)
		}
	}
	slices.SortFunc(defs, func(a, b friendTechDef) int {
		if a.Priority != b.Priority {
			return a.Priority - b.Priority
		}
		return strings.Compare(a.ID, b.ID)
	})
	if len(defs) > maxFriendTechItems {
		defs = defs[:maxFriendTechItems]
	}
	out := make([]model.FriendTechItem, 0, len(defs))
	for _, d := range defs {
		out = append(out, model.FriendTechItem{
			ID:       d.ID,
			Name:     d.Name,
			Category: d.Category,
		})
	}
	return out
}

// DetectFriendTechStack 基于单次拨测返回的响应头与 HTML 片段执行纯内存技术栈指纹识别（零额外网络请求）。
// 当 isWAF == true 时仅识别 CDN / 边缘层，避免把挑战拦截页的 HTML 误判为目标站点的框架或 CMS。
func DetectFriendTechStack(headers http.Header, rawHTML string, isWAF bool) []model.FriendTechItem {
	return DetectFriendTechStackWithHost("", headers, rawHTML, isWAF)
}

// DetectFriendTechStackWithHost 在指定目标站点主机名的上下文中识别技术栈，过滤跨站友链头像与第三方脚本挂件污染。
func DetectFriendTechStackWithHost(siteHost string, headers http.Header, rawHTML string, isWAF bool) []model.FriendTechItem {
	headers = normalizeTechHeaders(headers)
	hits := make(map[string]struct{}, 8)
	add := func(id string) {
		hits[id] = struct{}{}
	}

	cookieNames := extractCookieNamesLower(headers)
	detectCDNTechs(headers, cookieNames, add)
	if isWAF {
		return finalizeTechList(hits)
	}

	detectServerTechs(headers, add)

	if len(headers) > 0 {
		poweredBy := strings.ToLower(strings.Join(headers.Values("X-Powered-By"), " "))
		if strings.Contains(poweredBy, "next.js") {
			add("nextjs")
		}
		if containsWordToken(poweredBy, "nuxt") {
			add("nuxt")
		}
		if strings.Contains(poweredBy, "mix space") || strings.Contains(poweredBy, "mix-space") || strings.Contains(poweredBy, "mixspace") {
			add("mix-space")
		}
		if headers.Get("X-Ghost-Cache-Status") != "" {
			add("ghost")
		}
		if strings.HasSuffix(strings.ToLower(strings.TrimSpace(headers.Get("X-Pingback"))), "/xmlrpc.php") ||
			strings.Contains(strings.ToLower(strings.Join(headers.Values("Link"), " ")), "https://api.w.org/") {
			add("wordpress")
		}
	}
	if hasCookiePrefix(cookieNames, "halo_session") {
		add("halo")
	}
	if hasCookiePrefix(cookieNames, "wordpress_", "wp-settings-") {
		add("wordpress")
	}
	if hasCookiePrefix(cookieNames, "__typecho_") {
		add("typecho")
	}

	if rawHTML == "" {
		return finalizeTechList(hits)
	}

	// 使用 HTML Tokenizer 仅扫描真实标签、属性、注释与内联脚本特征，完全忽略正文纯文本（避免博文标题提及技术词造成假阳性）
	z := html.NewTokenizer(strings.NewReader(rawHTML))
	inScript := false
	hasVPContent := false
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		switch tt {
		case html.CommentToken:
			commentLower := strings.ToLower(string(z.Text()))
			if strings.Contains(commentLower, "hexo injector") {
				add("hexo")
			}

		case html.StartTagToken, html.SelfClosingTagToken:
			tn, hasAttr := z.TagName()
			tag := string(tn)
			if tag == "astro-island" || tag == "astro-slot" {
				add("astro")
			}
			if !hasAttr {
				if tag == "script" && tt == html.StartTagToken {
					inScript = true
				}
				continue
			}

			var metaName, metaContent, linkRel, linkHref, srcVal, scriptType, idVal, classVal string
			for {
				k, v, more := z.TagAttr()
				key := string(k)
				val := string(v)

				if strings.HasPrefix(key, "data-astro-") {
					add("astro")
				} else if key == "data-reactroot" || key == "data-reactid" {
					add("react")
				} else if isVueScopedAttr(key) || (key == "data-server-rendered" && val == "true") {
					add("vue")
				} else if strings.HasPrefix(key, "data-sveltekit-") {
					add("sveltekit")
				} else if key == "data-ghost" {
					add("ghost")
				}

				switch key {
				case "name":
					if tag == "meta" {
						metaName = strings.ToLower(strings.TrimSpace(val))
					}
				case "content":
					if tag == "meta" {
						metaContent = strings.ToLower(strings.TrimSpace(val))
					}
				case "rel":
					if tag == "link" {
						linkRel = strings.ToLower(strings.TrimSpace(val))
					}
				case "href":
					if tag == "link" {
						linkHref = val
					}
				case "src":
					if tag == "script" || tag == "img" || tag == "source" {
						srcVal = val
					}
				case "type":
					if tag == "script" {
						scriptType = strings.ToLower(strings.TrimSpace(val))
					}
				case "id":
					idVal = val
				case "class":
					classVal = val
				}
				if !more {
					break
				}
			}

			if tag == "script" && tt == html.StartTagToken {
				inScript = srcVal == "" && isExecutableInlineScriptType(scriptType)
			}

			if tag == "meta" && metaName == "generator" && metaContent != "" {
				matchGeneratorMeta(metaContent, add)
			}
			if idVal != "" {
				switch idVal {
				case "__NEXT_DATA__":
					if tag == "script" {
						add("nextjs")
					}
				case "__NUXT_DATA__":
					if tag == "script" {
						add("nuxt")
					}
				case "__nuxt":
					add("nuxt")
				case "__docusaurus":
					add("docusaurus")
				case "notion-next":
					add("notion-next")
				case "VPContent":
					hasVPContent = true
				}
			}
			if classVal != "" && strings.Contains(classVal, "friend-card-adaptive") {
				add("neo-blog")
			}
			if tag == "link" {
				if linkRel == "https://api.w.org/" {
					add("wordpress")
				} else if linkHref != "" && (strings.Contains(linkRel, "stylesheet") ||
					strings.Contains(linkRel, "preload") ||
					strings.Contains(linkRel, "icon")) {
					inspectAssetURLForTech(linkHref, siteHost, "link", add)
				}
			}
			if srcVal != "" {
				inspectAssetURLForTech(srcVal, siteHost, tag, add)
			}

		case html.EndTagToken:
			tn, _ := z.TagName()
			if string(tn) == "script" {
				inScript = false
			}

		case html.TextToken:
			if !inScript {
				continue
			}
			scriptBody := string(z.Text())
			if strings.Contains(scriptBody, "self.__next_f") || strings.Contains(scriptBody, "__NEXT_DATA__") {
				add("nextjs")
			}
			if strings.Contains(scriptBody, "window.__NUXT__") || strings.Contains(scriptBody, "__NUXT_DATA__") {
				add("nuxt")
			}
			if strings.Contains(scriptBody, "__sveltekit_") {
				add("sveltekit")
			}
			if strings.Contains(scriptBody, "window.__INITIAL_DATA__") && strings.Contains(scriptBody, "mx-space") {
				add("mix-space")
			}
		}
	}

	if hasVPContent {
		add("vitepress")
	}

	return finalizeTechList(hits)
}

// MergeFriendTechStack 合并最新拨测识别出的技术栈与历史记录：
// - 完整 HTML 正常访问（preserveNonCDN == false）：以最新探测结果为准；
// - 命中 WAF 挑战页、异常状态码或空/非 HTML 响应（preserveNonCDN == true）：按层更新新识别出的 CDN / Server，同时完整保留历史记录中的 CMS / Framework（及未重新暴露的 Server / CDN），防止盾页或截断流抹除原有技术栈。
func MergeFriendTechStack(detected []model.FriendTechItem, existing []model.FriendTechItem, preserveNonCDN bool) []model.FriendTechItem {
	if !preserveNonCDN {
		if detected == nil {
			return []model.FriendTechItem{}
		}
		return detected
	}

	hits := make(map[string]struct{}, len(detected)+len(existing))
	hasNewCDN := false
	hasNewServer := false
	for _, item := range detected {
		switch item.Category {
		case model.FriendTechCategoryCDN:
			hits[item.ID] = struct{}{}
			hasNewCDN = true
		case model.FriendTechCategoryServer:
			hits[item.ID] = struct{}{}
			hasNewServer = true
		}
	}
	for _, item := range existing {
		if item.Category == model.FriendTechCategoryCDN && hasNewCDN {
			continue
		}
		if item.Category == model.FriendTechCategoryServer && hasNewServer {
			continue
		}
		hits[item.ID] = struct{}{}
	}

	merged := finalizeTechList(hits)
	// 兼容可能存在的未入内置目录的历史自定义/扩展标签
	seen := make(map[string]struct{}, len(merged))
	for _, m := range merged {
		seen[m.ID] = struct{}{}
	}
	for _, item := range existing {
		if item.Category == model.FriendTechCategoryCDN && hasNewCDN {
			continue
		}
		if item.Category == model.FriendTechCategoryServer && hasNewServer {
			continue
		}
		if _, ok := seen[item.ID]; !ok && model.IsValidFriendTechCategory(item.Category) && item.ID != "" && item.Name != "" && len(merged) < maxFriendTechItems {
			merged = append(merged, item)
			seen[item.ID] = struct{}{}
		}
	}
	return merged
}
