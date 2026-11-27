package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const (
	misskeyFeedCacheKey       = "misskey:feed"
	misskeyRefreshLockKey     = "misskey:refresh"
	misskeyRefreshCooldownKey = "misskey:refresh_cooldown"

	misskeyCacheTTL        = 24 * time.Hour
	misskeyRefreshLockTTL  = 30 * time.Second
	misskeyFailureCooldown = 30 * time.Second
	misskeyRequestTimeout  = 10 * time.Second
	misskeyMaxResponseSize = 2 << 20  // 2 MiB 响应体硬上限
	misskeyMaxRawMFMBytes  = 32 << 10 // 单帖 MFM 清洗输入字节上限（32 KiB），防御超大文本正则开销
	misskeyMaxMFMTagLen    = 64
	misskeyMaxTextRunes    = 280
	misskeyMaxCWRunes      = 120
	misskeyMaxImagesPerRow = 4
)

// misskeyCacheEntry 存储在 sharedstate / Redis 中的内部缓存结构（含 ConfigHash，对外返回时剥离）
type misskeyCacheEntry struct {
	ConfigHash  string               `json:"config_hash"`
	FetchedAt   time.Time            `json:"fetched_at"`
	InstanceURL string               `json:"instance_url"`
	User        *dto.MisskeyUserDto  `json:"user,omitempty"`
	Notes       []dto.MisskeyNoteDto `json:"notes"`
}

type misskeyRuntimeConfig struct {
	Enabled         bool
	InstanceURL     string
	Username        string
	APIToken        string
	IntervalMinutes int
	DisplayCount    int
	ConfigHash      string
}

// misskeyHTTPClient 专用防 SSRF HTTP 客户端：
//   - 仅允许 80 / 443 公网地址（兼容代理 Fake-IP，拦截私网、回环、链路本地与云元数据，底层 Dialer Control 二次拦截 DNS 重绑定）
//   - 严禁跨源重定向，防止 POST 请求体中的可选 API Token 随 307/308 重定向泄露给第三方主机
var misskeyHTTPClient = newMisskeySafeClient()

func newMisskeySafeClient() *http.Client {
	return utils.NewSafeHTTPClient(utils.SafeClientOptions{
		SafeTransportOptions: utils.SafeTransportOptions{
			SafeDialOptions: utils.SafeDialOptions{
				AllowAddr: utils.IsPublicOrFakeIPAddr,
			},
		},
		Timeout:      misskeyRequestTimeout,
		MaxRedirects: 2,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 2 {
				return errors.New("too many redirects")
			}
			if len(via) > 0 {
				orig := via[0].URL
				if !strings.EqualFold(req.URL.Scheme, orig.Scheme) || !strings.EqualFold(req.URL.Host, orig.Host) {
					return errors.New("cross-origin redirect is not allowed")
				}
			}
			return utils.CheckSafeURL(req.URL, utils.SafeFetchAllowPrivate, utils.IsPublicOrFakeIPAddr)
		},
	})
}

// NormalizeMisskeyInstanceURL 复用配置层实例地址规范化与 SSRF 校验
func NormalizeMisskeyInstanceURL(raw string) (string, error) {
	return config.NormalizeMisskeyInstanceURL(raw)
}

// NormalizeMisskeyUsername 复用配置层本地用户名规范化与校验
func NormalizeMisskeyUsername(raw string) (string, bool) {
	return config.NormalizeMisskeyUsername(raw)
}

// SanitizeMisskeyHTTPURL 仅保留合法的公网 http:// 或 https:// 外部地址，拦截伪协议、空主机名、凭据及私网/回环图片地址
func SanitizeMisskeyHTTPURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" || len(s) > 2048 {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || u.User != nil {
		return ""
	}
	if err := utils.CheckSafeURL(u, utils.SafeFetchAllowPrivate, utils.IsPublicOrFakeIPAddr); err != nil {
		return ""
	}
	return u.String()
}

func sanitizeDisplayHandle(raw string) string {
	var b strings.Builder
	count := 0
	for _, r := range strings.TrimSpace(raw) {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			continue
		}
		b.WriteRune(r)
		count++
		if count >= 64 {
			break
		}
	}
	return b.String()
}

func computeMisskeyConfigHash(instanceURL, username, apiToken string, displayCount int) string {
	tokenDigest := ""
	if apiToken != "" {
		sum := sha256.Sum256([]byte(apiToken))
		tokenDigest = hex.EncodeToString(sum[:])
	}
	raw := strings.Join([]string{
		instanceURL,
		strings.ToLower(username),
		tokenDigest,
		strconv.Itoa(displayCount),
	}, "\n")
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func loadMisskeyRuntimeConfig() (misskeyRuntimeConfig, bool) {
	if repo.GetDB() == nil {
		return misskeyRuntimeConfig{}, false
	}
	enabled := config.Bool("misskey_enabled")
	if !enabled {
		return misskeyRuntimeConfig{Enabled: false}, false
	}
	instanceURL, err := NormalizeMisskeyInstanceURL(config.String("misskey_instance_url"))
	if err != nil {
		return misskeyRuntimeConfig{Enabled: false}, false
	}
	username, ok := NormalizeMisskeyUsername(config.String("misskey_username"))
	if !ok {
		return misskeyRuntimeConfig{Enabled: false}, false
	}
	apiToken := strings.TrimSpace(config.String("misskey_api_token"))
	interval := config.Int("misskey_fetch_interval_minutes")
	if interval < 1 {
		interval = 1
	} else if interval > 60 {
		interval = 60
	}
	count := config.Int("misskey_display_count")
	if count < 1 {
		count = 1
	} else if count > 10 {
		count = 10
	}
	return misskeyRuntimeConfig{
		Enabled:         true,
		InstanceURL:     instanceURL,
		Username:        username,
		APIToken:        apiToken,
		IntervalMinutes: interval,
		DisplayCount:    count,
		ConfigHash:      computeMisskeyConfigHash(instanceURL, username, apiToken, count),
	}, true
}

var (
	mfmPlainBlockRe = regexp.MustCompile(`(?is)<plain>(.*?)</plain>`)
	mfmCodeBlockRe  = regexp.MustCompile("(?s)```[a-zA-Z0-9_+-]*\\n?(.*?)```")
	mfmInlineCodeRe = regexp.MustCompile("`([^`\\n]+)`")
	mfmPlainTagRe   = regexp.MustCompile(`(?is)</?plain>`)
	mfmHTMLTagRe    = regexp.MustCompile(`(?is)</?(?:center|small|b|i|u|s)\b[^>]*>`)
	mfmLinkRe       = regexp.MustCompile(`\??\[([^\[\]\n]+)\]\(\s*https?://[^\s)]+\s*\)`)
	mfmQuotePrefixRe = regexp.MustCompile(`(?m)^[ \t]*>[ \t]?`)
	mfmBlankLinesRe  = regexp.MustCompile(`\n{3,}`)
	mfmMultiSpaceRe  = regexp.MustCompile(`[ \t]{2,}`)
)

func isMFMTagChar(b byte) bool {
	return (b >= 'a' && b <= 'z') ||
		(b >= 'A' && b <= 'Z') ||
		(b >= '0' && b <= '9') ||
		b == '_' || b == '.' || b == ',' || b == '=' || b == '+' || b == '-'
}

// stripNestedMFMFunctions 严格 O(N) 线性时间剥离嵌套的 MFM 特效标签（如 $[tada $[spin text]] -> text）
func stripNestedMFMFunctions(input string) string {
	if !strings.Contains(input, "$[") {
		return input
	}
	var out strings.Builder
	out.Grow(len(input))
	var bracketStack []bool

	for i := 0; i < len(input); {
		if i+2 < len(input) && input[i] == '$' && input[i+1] == '[' {
			j := i + 2
			for j < len(input) && j-(i+2) <= misskeyMaxMFMTagLen && isMFMTagChar(input[j]) {
				j++
			}
			if j > i+2 && j <= i+2+misskeyMaxMFMTagLen && j < len(input) && (input[j] == ' ' || input[j] == '\t' || input[j] == '\n') {
				bracketStack = append(bracketStack, true)
				i = j + 1
				continue
			}
		}
		if input[i] == '[' {
			bracketStack = append(bracketStack, false)
			out.WriteByte('[')
			i++
			continue
		}
		if input[i] == ']' && len(bracketStack) > 0 {
			isMFM := bracketStack[len(bracketStack)-1]
			bracketStack = bracketStack[:len(bracketStack)-1]
			i++
			if !isMFM {
				out.WriteByte(']')
			}
			continue
		}
		out.WriteByte(input[i])
		i++
	}
	return out.String()
}

func isEmojiNameChar(b byte) bool {
	return (b >= 'a' && b <= 'z') ||
		(b >= 'A' && b <= 'Z') ||
		(b >= '0' && b <= '9') ||
		b == '_' || b == '+' || b == '-'
}

func isEmojiHostChar(b byte) bool {
	return (b >= 'a' && b <= 'z') ||
		(b >= 'A' && b <= 'Z') ||
		(b >= '0' && b <= '9') ||
		b == '_' || b == '.' || b == '-'
}

// stripMFMCustomEmojis 线性扫描剥离 :emoji: / :emoji@host: 短码，保护 C++ `std::vector::iterator`、镜像标签、URL 路径与时间文本
func stripMFMCustomEmojis(input string) string {
	if !strings.Contains(input, ":") {
		return input
	}
	var out strings.Builder
	out.Grow(len(input))
	justConsumedEmoji := false

	for i := 0; i < len(input); {
		if input[i] == ':' {
			// 前一字节为 ':' 或 '/' 或字母数字（如 http://、std::vector::iterator、app:latest:arm64）且非紧跟上一枚已剥离表情时不视为起点
			prevBlocked := !justConsumedEmoji && i > 0 && (input[i-1] == ':' || input[i-1] == '/' || isEmojiNameChar(input[i-1]))
			if !prevBlocked {
				j := i + 1
				hasAlphaOrUnderscore := false
				for j < len(input) && j-(i+1) <= 64 && isEmojiNameChar(input[j]) {
					if (input[j] >= 'a' && input[j] <= 'z') || (input[j] >= 'A' && input[j] <= 'Z') || input[j] == '_' {
						hasAlphaOrUnderscore = true
					}
					j++
				}
				nameLen := j - (i + 1)
				if nameLen > 0 && hasAlphaOrUnderscore && j < len(input) && input[j] == '@' {
					k := j + 1
					for k < len(input) && k-(j+1) <= 128 && isEmojiHostChar(input[k]) {
						k++
					}
					if k > j+1 {
						j = k
					}
				}
				if nameLen > 0 && hasAlphaOrUnderscore && j < len(input) && input[j] == ':' {
					// 后一字节为 '/' 或字母数字（如 (:30:45)、Wikipedia:About:History）时不剥离；紧邻下一枚 ':neko:' 则允许继续剥离
					nextBlocked := j+1 < len(input) && (input[j+1] == '/' || isEmojiNameChar(input[j+1]))
					if !nextBlocked {
						i = j + 1
						justConsumedEmoji = true
						continue
					}
				}
			}
		}
		justConsumedEmoji = false
		out.WriteByte(input[i])
		i++
	}
	return out.String()
}

func truncateValidUTF8Bytes(s string, maxBytes int) string {
	if len(s) <= maxBytes {
		return s
	}
	cut := maxBytes
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}

func truncateMisskeyRunes(s string, maxRunes int) string {
	if maxRunes <= 0 || s == "" {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return strings.TrimSpace(string(runes[:maxRunes])) + "…"
}

// StripMisskeyMFM 将 Misskey MFM 富文本安全剥离为干净的纯文本摘要
func StripMisskeyMFM(raw string) string {
	return stripMisskeyMFMWithLimit(raw, misskeyMaxTextRunes)
}

func stripMisskeyMFMWithLimit(raw string, maxRunes int) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	s := truncateValidUTF8Bytes(raw, misskeyMaxRawMFMBytes)
	s = strings.ReplaceAll(s, "\x00", "")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")

	// 先保护 <plain>...</plain>、围栏代码块与行内代码的原文字面量，避免内部符号被后续 MFM 规则误删
	var literals []string
	stash := func(re *regexp.Regexp, src string) string {
		return re.ReplaceAllStringFunc(src, func(m string) string {
			sub := re.FindStringSubmatch(m)
			inner := m
			if len(sub) >= 2 {
				inner = sub[1]
			}
			idx := len(literals)
			literals = append(literals, inner)
			return "\x00" + strconv.Itoa(idx) + "\x00"
		})
	}
	s = stash(mfmCodeBlockRe, s)
	s = stash(mfmInlineCodeRe, s)
	s = stash(mfmPlainBlockRe, s)

	s = mfmPlainTagRe.ReplaceAllString(s, "")
	s = stripNestedMFMFunctions(s)
	s = mfmHTMLTagRe.ReplaceAllString(s, "")
	s = mfmLinkRe.ReplaceAllString(s, "$1")
	s = stripMFMCustomEmojis(s)
	s = mfmQuotePrefixRe.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "~~", "")

	// 逆序还原占位符，确保代码块包裹 <plain> 等多层嵌套时内层占位符也能完整展开且绝无 \x00 残留
	for idx := len(literals) - 1; idx >= 0; idx-- {
		s = strings.ReplaceAll(s, "\x00"+strconv.Itoa(idx)+"\x00", literals[idx])
	}
	s = strings.ReplaceAll(s, "\x00", "")

	s = mfmMultiSpaceRe.ReplaceAllString(s, " ")
	s = mfmBlankLinesRe.ReplaceAllString(s, "\n\n")
	s = strings.TrimSpace(s)
	return truncateMisskeyRunes(s, maxRunes)
}

// sanitizeMisskeyCW 清洗 CW 预警标题：若原帖确实设置了非空 CW（如仅含 `:spoiler:` 表情），清洗为空时回退 "CW" 确保折叠保护不失效
func sanitizeMisskeyCW(raw *string) string {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return ""
	}
	cleaned := stripMisskeyMFMWithLimit(*raw, misskeyMaxCWRunes)
	if cleaned == "" {
		return "CW"
	}
	return cleaned
}

// ---- Misskey 上游 API 响应结构（只解码需要的最小字段） ----

type misskeyAPIUser struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	Name      *string `json:"name"`
	AvatarURL string  `json:"avatarUrl"`
}

type misskeyAPIFile struct {
	Type         string  `json:"type"`
	URL          string  `json:"url"`
	ThumbnailURL string  `json:"thumbnailUrl"`
	Comment      *string `json:"comment"`
	Name         string  `json:"name"`
	IsSensitive  bool    `json:"isSensitive"`
}

type misskeyAPINote struct {
	ID            string           `json:"id"`
	CreatedAt     string           `json:"createdAt"`
	Text          *string          `json:"text"`
	CW            *string          `json:"cw"`
	Visibility    string           `json:"visibility"`
	LocalOnly     bool             `json:"localOnly"`
	ChannelID     *string          `json:"channelId"`
	User          misskeyAPIUser   `json:"user"`
	Files         []misskeyAPIFile `json:"files"`
	Renote        *misskeyAPINote  `json:"renote"`
	Reactions     map[string]int   `json:"reactions"`
	ReactionCount *int             `json:"reactionCount"`
	RepliesCount  int              `json:"repliesCount"`
	RenoteCount   int              `json:"renoteCount"`
}

func postMisskeyJSON(ctx context.Context, client *http.Client, endpoint string, payload map[string]any, dst any) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return err
	}
	if err := utils.CheckSafeURL(u, utils.SafeFetchAllowPrivate, utils.IsPublicOrFakeIPAddr); err != nil {
		return err
	}
	if port := u.Port(); port != "" && port != "80" && port != "443" && !utils.SafeFetchAllowPrivate {
		return utils.ErrBlockedAddress
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	reqCtx, cancel := context.WithTimeout(ctx, misskeyRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, u.String(), bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "neo-blog/1.0 (+misskey-widget)")

	httpClient := client
	if httpClient == nil {
		httpClient = misskeyHTTPClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("misskey api status %d", resp.StatusCode)
	}
	limited := io.LimitReader(resp.Body, misskeyMaxResponseSize+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return err
	}
	if len(raw) > misskeyMaxResponseSize {
		return errors.New("misskey response exceeded max size")
	}
	return json.Unmarshal(raw, dst)
}

func extractSafeNoteImages(files []misskeyAPIFile) []dto.MisskeyNoteImageDto {
	if len(files) == 0 {
		return nil
	}
	images := make([]dto.MisskeyNoteImageDto, 0, min(len(files), misskeyMaxImagesPerRow))
	for _, f := range files {
		if len(images) >= misskeyMaxImagesPerRow {
			break
		}
		if f.IsSensitive || !strings.HasPrefix(strings.ToLower(strings.TrimSpace(f.Type)), "image/") {
			continue
		}
		thumb := SanitizeMisskeyHTTPURL(f.ThumbnailURL)
		if thumb == "" {
			thumb = SanitizeMisskeyHTTPURL(f.URL)
		}
		if thumb == "" {
			continue
		}
		alt := ""
		if f.Comment != nil {
			alt = stripMisskeyMFMWithLimit(*f.Comment, 80)
		}
		images = append(images, dto.MisskeyNoteImageDto{
			ThumbnailURL: thumb,
			Alt:          alt,
		})
	}
	if len(images) == 0 {
		return nil
	}
	return images
}

func countNoteReactions(n *misskeyAPINote) int {
	if n.ReactionCount != nil && *n.ReactionCount >= 0 {
		return *n.ReactionCount
	}
	total := 0
	for _, c := range n.Reactions {
		if c > 0 {
			total += c
		}
	}
	return total
}

func isSafeNoteID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func isPublicFederatedNote(n *misskeyAPINote) bool {
	return n != nil && n.Visibility == "public" && !n.LocalOnly && n.ChannelID == nil && isSafeNoteID(n.ID)
}

// FilterAndSanitizeMisskeyNotes 严格筛选公开帖子并清洗 MFM 与媒体链接：
//   - 仅保留 visibility == "public" && !localOnly && channelId == nil 的帖子；
//   - 若包含 renote 链，每一跳 renote 也必须满足公开联合条件，否则整条跳过；
//   - 严格保留 CW 折叠保护（引用带 CW 的原帖时不展开剧透正文，表情 CW 回退为 "CW"）。
func FilterAndSanitizeMisskeyNotes(instanceURL string, rawNotes []misskeyAPINote, maxCount int) []dto.MisskeyNoteDto {
	if maxCount <= 0 {
		return []dto.MisskeyNoteDto{}
	}
	out := make([]dto.MisskeyNoteDto, 0, min(len(rawNotes), maxCount))
	for i := range rawNotes {
		if len(out) >= maxCount {
			break
		}
		note := &rawNotes[i]
		if !isPublicFederatedNote(note) {
			continue
		}
		renotePublic := true
		for cur := note.Renote; cur != nil; cur = cur.Renote {
			if !isPublicFederatedNote(cur) {
				renotePublic = false
				break
			}
		}
		if !renotePublic {
			continue
		}

		ownText := ""
		if note.Text != nil {
			ownText = StripMisskeyMFM(*note.Text)
		}
		ownCW := sanitizeMisskeyCW(note.CW)
		ownImages := extractSafeNoteImages(note.Files)

		// 纯转帖（无附言、无 CW、无自配图）：展示原帖公开内容并标注原帖作者
		isPureRenote := ownText == "" && ownCW == "" && len(ownImages) == 0 && note.Renote != nil
		target := note
		var renoteUser string
		if isPureRenote {
			target = note.Renote
			if target.User.Name != nil && strings.TrimSpace(*target.User.Name) != "" {
				renoteUser = stripMisskeyMFMWithLimit(*target.User.Name, 64)
			}
			if renoteUser == "" {
				renoteUser = sanitizeDisplayHandle(target.User.Username)
			}
		}

		text := ownText
		cw := ownCW
		images := ownImages
		if isPureRenote {
			if target.Text != nil {
				text = StripMisskeyMFM(*target.Text)
			}
			cw = sanitizeMisskeyCW(target.CW)
			images = extractSafeNoteImages(target.Files)
		} else if note.Renote != nil {
			renoteCW := sanitizeMisskeyCW(note.Renote.CW)
			var quoted string
			if renoteCW != "" {
				// 被引用原帖含有 CW 时只显示预警标题，绝不拼出隐藏正文造成剧透泄露
				quoted = "[CW] " + renoteCW
			} else if note.Renote.Text != nil {
				quoted = stripMisskeyMFMWithLimit(*note.Renote.Text, 100)
			}
			if quoted != "" {
				author := sanitizeDisplayHandle(note.Renote.User.Username)
				prefix := "RN: "
				if author != "" {
					prefix = "RN @" + author + ": "
				}
				if text != "" {
					text = truncateMisskeyRunes(text+"\n"+prefix+quoted, misskeyMaxTextRunes)
				} else {
					text = truncateMisskeyRunes(prefix+quoted, misskeyMaxTextRunes)
				}
			}
		}

		if text == "" && cw == "" && len(images) == 0 {
			continue
		}

		noteURL := SanitizeMisskeyHTTPURL(instanceURL + "/notes/" + target.ID)
		if noteURL == "" {
			continue
		}
		createdAt := strings.TrimSpace(note.CreatedAt)
		if _, err := time.Parse(time.RFC3339, createdAt); err != nil {
			createdAt = ""
		}

		out = append(out, dto.MisskeyNoteDto{
			ID:             note.ID,
			URL:            noteURL,
			Text:           text,
			CW:             cw,
			CreatedAt:      createdAt,
			IsRenote:       isPureRenote,
			RenoteUser:     renoteUser,
			Images:         images,
			ReactionsCount: countNoteReactions(target),
			RepliesCount:   max(0, target.RepliesCount),
			RenotesCount:   max(0, target.RenoteCount),
		})
	}
	return out
}

func fetchMisskeyFeedUpstream(ctx context.Context, client *http.Client, cfg misskeyRuntimeConfig) (*misskeyCacheEntry, error) {
	showPayload := map[string]any{
		"username": cfg.Username,
		"host":     nil,
	}
	if cfg.APIToken != "" {
		showPayload["i"] = cfg.APIToken
	}

	var apiUser misskeyAPIUser
	if err := postMisskeyJSON(ctx, client, cfg.InstanceURL+"/api/users/show", showPayload, &apiUser); err != nil {
		return nil, fmt.Errorf("users/show: %w", err)
	}
	if !isSafeNoteID(apiUser.ID) {
		return nil, errors.New("users/show returned invalid user id")
	}

	fetchLimit := min(max(cfg.DisplayCount*3, 15), 30)
	notesPayload := map[string]any{
		"userId":           apiUser.ID,
		"limit":            fetchLimit,
		"includeReplies":   false,
		"includeMyRenotes": true,
		"withChannelNotes": false,
	}
	if cfg.APIToken != "" {
		notesPayload["i"] = cfg.APIToken
	}

	var rawNotes []misskeyAPINote
	if err := postMisskeyJSON(ctx, client, cfg.InstanceURL+"/api/users/notes", notesPayload, &rawNotes); err != nil {
		return nil, fmt.Errorf("users/notes: %w", err)
	}

	cleanUsername := cfg.Username
	if u, ok := NormalizeMisskeyUsername(apiUser.Username); ok {
		cleanUsername = u
	}
	displayName := cleanUsername
	if apiUser.Name != nil && strings.TrimSpace(*apiUser.Name) != "" {
		if cleaned := stripMisskeyMFMWithLimit(*apiUser.Name, 64); cleaned != "" {
			displayName = cleaned
		}
	}
	profileURL := SanitizeMisskeyHTTPURL(cfg.InstanceURL + "/@" + cleanUsername)

	notes := FilterAndSanitizeMisskeyNotes(cfg.InstanceURL, rawNotes, cfg.DisplayCount)
	return &misskeyCacheEntry{
		ConfigHash:  cfg.ConfigHash,
		FetchedAt:   time.Now().UTC(),
		InstanceURL: cfg.InstanceURL,
		User: &dto.MisskeyUserDto{
			Username:   cleanUsername,
			Name:       displayName,
			AvatarURL:  SanitizeMisskeyHTTPURL(apiUser.AvatarURL),
			ProfileURL: profileURL,
		},
		Notes: notes,
	}, nil
}

var errMisskeyConfigSuperseded = errors.New("misskey config changed during refresh")

func refreshMisskeyFeedForConfig(ctx context.Context, cfg misskeyRuntimeConfig) error {
	var prev misskeyCacheEntry
	hadPrev, _ := sharedstate.GetJSON(misskeyFeedCacheKey, &prev)

	entry, err := fetchMisskeyFeedUpstream(ctx, misskeyHTTPClient, cfg)
	// 网络拉取完成后二次校验最新配置，防止飞行途中管理员已关闭开关或切到新账号导致旧数据覆盖回写
	latestCfg, stillOK := loadMisskeyRuntimeConfig()
	if !stillOK {
		_ = sharedstate.Current().Delete(misskeyFeedCacheKey, misskeyRefreshCooldownKey)
		return nil
	}
	if latestCfg.ConfigHash != cfg.ConfigHash {
		return errMisskeyConfigSuperseded
	}
	if err != nil {
		return err
	}

	if err := sharedstate.SetJSON(misskeyFeedCacheKey, entry, misskeyCacheTTL); err != nil {
		return err
	}
	if feedChanged(&prev, hadPrev, entry) {
		repo.TouchCacheTags(repo.CacheTagSite)
	}
	return nil
}

// RefreshMisskeyFeed 立即读取当前生效配置并执行一次 Misskey 上游拉取与缓存写入
func RefreshMisskeyFeed(ctx context.Context) error {
	cfg, ok := loadMisskeyRuntimeConfig()
	if !ok {
		_ = sharedstate.Current().Delete(misskeyFeedCacheKey, misskeyRefreshCooldownKey)
		return nil
	}
	err := refreshMisskeyFeedForConfig(ctx, cfg)
	if errors.Is(err, errMisskeyConfigSuperseded) {
		return nil
	}
	return err
}

func feedChanged(prev *misskeyCacheEntry, hadPrev bool, next *misskeyCacheEntry) bool {
	if !hadPrev || prev == nil {
		return true
	}
	if prev.ConfigHash != next.ConfigHash || prev.InstanceURL != next.InstanceURL {
		return true
	}
	if !reflect.DeepEqual(prev.User, next.User) || !reflect.DeepEqual(prev.Notes, next.Notes) {
		return true
	}
	return false
}

// RefreshMisskeyFeedIfDue 供定时任务每分钟调用：未开启或尚未到达配置的拉取间隔时直接跳过
func RefreshMisskeyFeedIfDue() {
	cfg, ok := loadMisskeyRuntimeConfig()
	if !ok {
		return
	}
	var cached misskeyCacheEntry
	hit, err := sharedstate.GetJSON(misskeyFeedCacheKey, &cached)
	if err == nil && hit && cached.ConfigHash == cfg.ConfigHash {
		dueAfter := time.Duration(cfg.IntervalMinutes)*time.Minute - 5*time.Second
		if time.Since(cached.FetchedAt) < dueAfter {
			return
		}
	}

	release, locked, lockErr := sharedstate.TryLock(misskeyRefreshLockKey, misskeyRefreshLockTTL)
	if lockErr != nil || !locked {
		return
	}
	defer release()

	if err := refreshMisskeyFeedForConfig(context.Background(), cfg); err != nil && !errors.Is(err, errMisskeyConfigSuperseded) {
		logrus.Warnf("misskey periodic refresh failed: %v", err)
	}
}

// OnMisskeyConfigSaved 后台保存或重置 Misskey 配置时调用：清除失败冷却并触发最新配置刷新
func OnMisskeyConfigSaved() {
	_ = sharedstate.Current().Delete(misskeyRefreshCooldownKey)
	TriggerMisskeyRefreshAsync()
}

// TriggerMisskeyRefreshAsync 后台异步触发刷新：
//   - 失败冷却按 ConfigHash 隔离，旧配置拨号失败不会阻塞管理员刚修正的新配置；
//   - 若持锁拉取期间后台又保存了新配置，持锁协程原地衔接追平最新配置（最多 3 轮），不丢失最新修改。
func TriggerMisskeyRefreshAsync() {
	cfg, ok := loadMisskeyRuntimeConfig()
	if !ok {
		_ = sharedstate.Current().Delete(misskeyFeedCacheKey, misskeyRefreshCooldownKey)
		return
	}
	if cdHash, inCooldown, _ := sharedstate.Current().Get(misskeyRefreshCooldownKey); inCooldown && cdHash == cfg.ConfigHash {
		return
	}
	release, locked, err := sharedstate.TryLock(misskeyRefreshLockKey, misskeyRefreshLockTTL)
	if err != nil || !locked {
		return
	}
	go func() {
		defer release()
		for attempt := 0; attempt < 3; attempt++ {
			targetCfg, stillOK := loadMisskeyRuntimeConfig()
			if !stillOK {
				_ = sharedstate.Current().Delete(misskeyFeedCacheKey, misskeyRefreshCooldownKey)
				return
			}
			if cdHash, inCooldown, _ := sharedstate.Current().Get(misskeyRefreshCooldownKey); inCooldown && cdHash == targetCfg.ConfigHash {
				return
			}
			err := refreshMisskeyFeedForConfig(context.Background(), targetCfg)
			if errors.Is(err, errMisskeyConfigSuperseded) {
				// 飞行途中配置再次变更，继续下一轮追平最新配置
				continue
			}
			if err != nil {
				// 仅当最新配置仍为本次失败的 targetCfg 时才记入哈希级失败冷却
				if curCfg, curOK := loadMisskeyRuntimeConfig(); curOK && curCfg.ConfigHash == targetCfg.ConfigHash {
					_ = sharedstate.Current().Set(misskeyRefreshCooldownKey, targetCfg.ConfigHash, misskeyFailureCooldown)
				}
				logrus.Warnf("misskey async refresh failed: %v", err)
			} else {
				_ = sharedstate.Current().Delete(misskeyRefreshCooldownKey)
			}
			// 检查返回瞬间是否有更新的配置写入
			nextCfg, nextOK := loadMisskeyRuntimeConfig()
			if !nextOK {
				_ = sharedstate.Current().Delete(misskeyFeedCacheKey, misskeyRefreshCooldownKey)
				return
			}
			if nextCfg.ConfigHash == targetCfg.ConfigHash {
				return
			}
		}
	}()
}

// GetMisskeyFeed 公开只读接口读取方法：
//   - 绝不在请求链路内同步请求 Misskey 实例；
//   - 未开启或配置不完整返回 { enabled: false, notes: [] }；
//   - 仅读 sharedstate.GetJSON，冷启动未命中或 ConfigHash 变更时立即返回 { enabled: true, notes: [] } 并异步唤醒一次后台刷新。
func GetMisskeyFeed(_ context.Context) (*dto.MisskeyFeedDto, *errs.ServiceError) {
	cfg, ok := loadMisskeyRuntimeConfig()
	if !ok {
		return &dto.MisskeyFeedDto{
			Enabled: false,
			Notes:   []dto.MisskeyNoteDto{},
		}, nil
	}

	var cached misskeyCacheEntry
	hit, err := sharedstate.GetJSON(misskeyFeedCacheKey, &cached)
	if err != nil {
		logrus.Warnf("read misskey feed cache failed: %v", err)
	}
	if !hit || cached.ConfigHash != cfg.ConfigHash {
		TriggerMisskeyRefreshAsync()
		return &dto.MisskeyFeedDto{
			Enabled:     true,
			InstanceURL: cfg.InstanceURL,
			Notes:       []dto.MisskeyNoteDto{},
		}, nil
	}

	if time.Since(cached.FetchedAt) >= time.Duration(cfg.IntervalMinutes)*time.Minute {
		TriggerMisskeyRefreshAsync()
	}

	notes := cached.Notes
	if notes == nil {
		notes = []dto.MisskeyNoteDto{}
	}
	fetchedAt := ""
	if !cached.FetchedAt.IsZero() {
		fetchedAt = cached.FetchedAt.UTC().Format(time.RFC3339)
	}
	return &dto.MisskeyFeedDto{
		Enabled:     true,
		FetchedAt:   fetchedAt,
		InstanceURL: cached.InstanceURL,
		User:        cached.User,
		Notes:       notes,
	}, nil
}
