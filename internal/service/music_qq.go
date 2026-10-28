package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
	"golang.org/x/sync/singleflight"
)

// QQ 音乐歌词（见 docs/music-player-spec.md 2.4，规则参考 StarryPlayer 的 QQ 音乐歌词插件与候选匹配）：
// - 网易云歌曲在 QQ 音乐没有对应 id：以「歌名 歌手」搜索（客户端签名搜索没有结果或失败时，再用歌名与联想搜索 + 曲目详情），再按歌名、歌手、专辑、时长打分，选出同一首歌（宁缺勿错）
// - 取 QRC 逐字歌词、翻译（LRC）与音译（QRC）；正文与音译是加密的（见 music_qrc.go）
// - 匹配到的歌曲还会按 mid 查 AMLL TTML DB 的 qq-lyrics 目录
// - 前端只在需要时请求（网易云没有逐字歌词，或读者固定了 QQ 音乐）；结果按网易云歌曲 id 缓存：
//   有歌词 30 天，没有匹配或没有歌词 1 天，出错不缓存

var (
	musicQQSmartboxURL = "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg"
	// 歌词、曲目详情等 CGI 的统一入口
	musicQQLyricURL = "https://u.y.qq.com/cgi-bin/musicu.fcg"
)

const (
	musicQQReferer        = "https://y.qq.com/"
	musicQQUserAgent      = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
	musicQQKeywordMaxRune = 100
	musicQQHitTTL         = 30 * 24 * time.Hour
	musicQQMissTTL        = 24 * time.Hour
	// 搜索不完整（有某一路搜索出错）时「没有匹配」的缓存时长
	musicQQDegradedMissTTL = time.Hour
)

var (
	musicQQCache = cache.NewLRUCacheWithSize(500, 16<<20)
	musicQQGroup singleflight.Group
	// QRC 的行头：[开始毫秒,时长毫秒]
	qrcLineRe = regexp.MustCompile(`(?m)^\[\d+,\d+\]`)
)

// musicQQCacheEntry 缓存条目：Lyric.Lyric 为空表示没有匹配或没有歌词（仍可能有 mid，用于查 TTML）
type musicQQCacheEntry struct {
	Lyric     dto.MusicQQLyricDto `json:"lyric"`
	ExpiresAt int64               `json:"expires_at"`
}

// GetQQLyric 按网易云歌曲 id 在 QQ 音乐匹配同一首歌并取歌词；没有匹配、也没有歌词时返回 404
func (s *MusicService) GetQQLyric(ctx context.Context, id int64) (*dto.MusicQQLyricDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lyric, svcerr := s.cachedQQLyric(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	result := *lyric
	if result.SongMID != "" {
		if probe := probeQQTTML(ctx, result.SongMID); probe != nil {
			result.TTML = probe.ttml
		}
	}
	if result.Lyric == "" && result.TTML == "" {
		return nil, errs.NewNotFound("lyric_not_found")
	}
	return &result, nil
}

// cachedQQLyric 先查缓存，再合并同一首歌的并发请求
func (s *MusicService) cachedQQLyric(ctx context.Context, id int64) (*dto.MusicQQLyricDto, *errs.ServiceError) {
	if data, ok := musicQQCache.Get(uint(id)); ok {
		var entry musicQQCacheEntry
		// 刷新歌词时不使用「没有匹配或没有歌词」的缓存
		if json.Unmarshal(data, &entry) == nil && time.Now().Unix() < entry.ExpiresAt && (entry.Lyric.Lyric != "" || !lyricRefreshing(ctx)) {
			return &entry.Lyric, nil
		}
		musicQQCache.Remove(uint(id))
	}

	value, err, _ := musicQQGroup.Do(strconv.FormatInt(id, 10), func() (any, error) {
		// 请求合并后由多个调用方共享结果，不随第一个调用方的请求取消
		ctx := context.WithoutCancel(ctx)
		song, svcerr := s.GetSong(ctx, id)
		if svcerr != nil {
			return nil, svcerr
		}
		lyric, degraded, err := fetchQQLyric(ctx, song)
		if err != nil {
			logrus.Warnf("qq music lyric request failed: %v", err)
			return nil, errs.New(http.StatusBadGateway, "music_lyric_source_failed", err)
		}
		ttl := musicQQHitTTL
		if lyric.Lyric == "" {
			ttl = musicQQMissTTL
			// 有某一路搜索出错时「没有匹配」可能只是没搜全，只短暂缓存
			if degraded {
				ttl = musicQQDegradedMissTTL
			}
		}
		if data, err := json.Marshal(musicQQCacheEntry{Lyric: *lyric, ExpiresAt: time.Now().Add(ttl).Unix()}); err == nil {
			musicQQCache.Put(uint(id), data)
		}
		return lyric, nil
	})
	if err != nil {
		var svcerr *errs.ServiceError
		if errors.As(err, &svcerr) {
			return nil, svcerr
		}
		return nil, errs.New(http.StatusBadGateway, "music_lyric_source_failed", err)
	}
	return value.(*dto.MusicQQLyricDto), nil
}

// fetchQQLyric 搜索并匹配同一首歌，取它的歌词；没有匹配时返回空结果（不是错误）。
// degraded 为有某一路搜索出错（搜索可能不全），此时「没有匹配」只短暂缓存
func fetchQQLyric(ctx context.Context, song *dto.MusicSongDto) (lyric *dto.MusicQQLyricDto, degraded bool, err error) {
	query := lyricQuery{Title: song.Name, Artists: song.Artists, Album: song.Album, Duration: float64(song.Duration) / 1000}
	best, degraded, err := searchQQSong(ctx, query)
	if err != nil {
		return nil, true, err
	}
	if best == nil {
		return &dto.MusicQQLyricDto{}, degraded, nil
	}
	// 同时预热按 mid 收录的 TTML（结果进缓存，GetQQLyric 随后直接取用）
	go probeQQTTML(ctx, best.MID)
	lyric, err = fetchQQSongLyric(ctx, best)
	if err != nil {
		return nil, true, err
	}
	lyric.SongMID = best.MID
	return lyric, degraded, nil
}

// qqRequest 请求 QQ 音乐接口并解析 JSON；code 不为 0 时视为失败
func qqRequest(ctx context.Context, method, endpoint string, body []byte, out any) error {
	ctx, cancel := context.WithTimeout(ctx, musicRequestTimeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Referer", musicQQReferer)
	req.Header.Set("User-Agent", musicQQUserAgent)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	var status struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(data, &status); err != nil {
		return errors.New("invalid response")
	}
	if status.Code != 0 {
		return fmt.Errorf("code %d", status.Code)
	}
	return json.Unmarshal(data, out)
}

// searchQQSong 在 QQ 音乐搜索并匹配同一首歌（匹配规则见 scoreLyricCandidate），分两轮：
//  1. 客户端签名搜索（歌名 + 歌手），一次返回完整结果，大多数歌在这一轮匹配到
//  2. 第一轮出错或没有匹配时，并发进行：签名搜索（只用歌名）、联想搜索（三种关键词），合并去重后再匹配
//     （网页公开搜索 client_search_cp 与签名搜索的数据相同，但现在基本只返回 500、且常要 5 秒才返回，所以不再使用）
//
// degraded 为有某一路搜索出错；所有搜索都出错时返回错误
func searchQQSong(ctx context.Context, query lyricQuery) (best *lyricCandidate, degraded bool, err error) {
	keyword := query.keyword()
	candidates, firstErr := searchQQSongsDesktop(ctx, keyword)
	if firstErr == nil {
		if best := bestLyricCandidate(candidates, query); best != nil {
			return best, false, nil
		}
	} else {
		logrus.Debugf("qq music desktop search failed: %v", firstErr)
	}

	type search struct {
		name string
		run  func() ([]lyricCandidate, error)
	}
	title := strings.TrimSpace(query.Title)
	searches := []search{
		{"desktop-title", func() ([]lyricCandidate, error) { return searchQQSongsDesktop(ctx, title) }},
	}
	for _, key := range qqSmartboxKeywords(query) {
		searches = append(searches, search{"smartbox:" + key, func() ([]lyricCandidate, error) { return searchQQSongsSmartbox(ctx, key) }})
	}
	results := make([][]lyricCandidate, len(searches))
	errs := make([]error, len(searches))
	var wg sync.WaitGroup
	for i, item := range searches {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = item.run()
		}()
	}
	wg.Wait()

	failed := 0
	if firstErr != nil {
		failed++
	}
	merged := candidates
	seen := map[string]bool{}
	for _, candidate := range candidates {
		seen[candidate.MID] = true
	}
	for i, list := range results {
		if errs[i] != nil {
			failed++
			logrus.Debugf("qq music search %s failed: %v", searches[i].name, errs[i])
			continue
		}
		for _, candidate := range list {
			if !seen[candidate.MID] {
				seen[candidate.MID] = true
				merged = append(merged, candidate)
			}
		}
	}
	if failed == len(searches)+1 {
		return nil, true, errors.Join(append([]error{firstErr}, errs...)...)
	}
	return bestLyricCandidate(merged, query), failed > 0, nil
}

// qqSmartboxKeywords 联想搜索的关键词：联想搜索只给几条结果，关键词越长越容易漏，所以同时用歌名、歌名 + 第一位歌手、歌名 + 全部歌手
func qqSmartboxKeywords(query lyricQuery) []string {
	title := strings.TrimSpace(query.Title)
	keywords := []string{title}
	if len(query.Artists) > 0 {
		keywords = append(keywords, strings.TrimSpace(title+" "+query.Artists[0]))
	}
	if full := query.keyword(); !slices.Contains(keywords, full) {
		keywords = append(keywords, full)
	}
	return slices.DeleteFunc(slices.Compact(keywords), func(key string) bool { return key == "" })
}

// qqMusicuBody musicu.fcg 的请求体：一个 CGI 请求
func qqMusicuBody(module, method string, param map[string]any) []byte {
	body, _ := json.Marshal(map[string]any{
		"comm": map[string]any{"ct": "19", "cv": "1859", "uin": "0"},
		"req":  map[string]any{"module": module, "method": method, "param": param},
	})
	return body
}

// searchQQSongsSmartbox 联想搜索（只有 mid、歌名与歌手）+ 曲目详情（时长、专辑、歌手）
func searchQQSongsSmartbox(ctx context.Context, keyword string) ([]lyricCandidate, error) {
	var box struct {
		Data struct {
			Song struct {
				ItemList []struct {
					MID string `json:"mid"`
				} `json:"itemlist"`
			} `json:"song"`
		} `json:"data"`
	}
	params := url.Values{"format": {"json"}, "key": {keyword}}
	if err := qqRequest(ctx, http.MethodGet, musicQQSmartboxURL+"?"+params.Encode(), nil, &box); err != nil {
		return nil, fmt.Errorf("smartbox: %w", err)
	}
	mids := make([]string, 0, len(box.Data.Song.ItemList))
	for _, item := range box.Data.Song.ItemList {
		if item.MID != "" {
			mids = append(mids, item.MID)
		}
	}
	if len(mids) == 0 {
		return nil, nil
	}

	types := make([]int, len(mids))
	var info struct {
		Req struct {
			Code int `json:"code"`
			Data struct {
				Tracks []struct {
					MID      string  `json:"mid"`
					Name     string  `json:"name"`
					Interval float64 `json:"interval"` // 秒
					Album    struct {
						Name string `json:"name"`
					} `json:"album"`
					Singer []struct {
						Name string `json:"name"`
					} `json:"singer"`
				} `json:"tracks"`
			} `json:"data"`
		} `json:"req"`
	}
	body := qqMusicuBody("music.trackInfo.UniformRuleCtrl", "CgiGetTrackInfo", map[string]any{"mids": mids, "types": types})
	if err := qqRequest(ctx, http.MethodPost, musicQQLyricURL, body, &info); err != nil {
		return nil, fmt.Errorf("track info: %w", err)
	}
	if info.Req.Code != 0 {
		return nil, fmt.Errorf("track info: code %d", info.Req.Code)
	}
	candidates := make([]lyricCandidate, 0, len(info.Req.Data.Tracks))
	for _, track := range info.Req.Data.Tracks {
		if track.MID == "" || track.Name == "" {
			continue
		}
		artists := make([]string, 0, len(track.Singer))
		for _, singer := range track.Singer {
			artists = append(artists, singer.Name)
		}
		candidates = append(candidates, lyricCandidate{MID: track.MID, Title: track.Name, Artists: artists, Album: track.Album.Name, Duration: track.Interval})
	}
	return candidates, nil
}

// fetchQQSongLyric 取一首 QQ 音乐歌曲的歌词：正文、翻译、音译（均可能为空）
func fetchQQSongLyric(ctx context.Context, song *lyricCandidate) (*dto.MusicQQLyricDto, error) {
	body := qqMusicuBody("music.musichallSong.PlayLyricInfo", "GetPlayLyricInfo", map[string]any{
		"songMID":  song.MID,
		"interval": int(song.Duration),
		"crypt":    1,
		"ct":       19,
		"cv":       1859,
		"type":     0,
		"qrc":      1,
		"trans":    1,
		"roma":     1,
		"lrc_t":    0,
		"qrc_t":    0,
		"trans_t":  0,
		"roma_t":   0,
	})
	var raw struct {
		Req struct {
			Code int `json:"code"`
			Data struct {
				Lyric string `json:"lyric"`
				Trans string `json:"trans"`
				Roma  string `json:"roma"`
			} `json:"data"`
		} `json:"req"`
	}
	if err := qqRequest(ctx, http.MethodPost, musicQQLyricURL, body, &raw); err != nil {
		return nil, fmt.Errorf("lyric: %w", err)
	}
	if raw.Req.Code != 0 {
		return nil, fmt.Errorf("lyric: code %d", raw.Req.Code)
	}

	lyric, err := decodeQQLyricField(raw.Req.Data.Lyric)
	if err != nil {
		return nil, fmt.Errorf("lyric: %w", err)
	}
	result := &dto.MusicQQLyricDto{Lyric: lyric}
	if lyric != "" {
		result.Format = "lrc"
		if qrcLineRe.MatchString(lyric) {
			result.Format = "qrc"
		}
	}
	// 翻译与音译解不出来时不影响正文
	if result.Translation, err = decodeQQLyricField(raw.Req.Data.Trans); err != nil {
		logrus.Debugf("qq music translation decode failed: %v", err)
	}
	if result.Romanization, err = decodeQQLyricField(raw.Req.Data.Roma); err != nil {
		logrus.Debugf("qq music romanization decode failed: %v", err)
	}
	return result, nil
}

// decodeQQLyricField 歌词字段：十六进制为加密的歌词，否则为 base64 明文；QRC 去掉 XML 外壳
func decodeQQLyricField(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	var text string
	if isHexString(value) {
		decrypted, err := decryptQRC(value)
		if err != nil {
			return "", err
		}
		text = decrypted
	} else {
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return "", err
		}
		text = string(decoded)
	}
	return strings.TrimSpace(unwrapQRC(text)), nil
}

func isHexString(value string) bool {
	if len(value)%2 != 0 {
		return false
	}
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

// unwrapQRC 取第一个 Lyric_N 元素的 LyricContent 属性；不是 XML 时原样返回。
// 歌词里可能有未转义的引号，因此属性以 "/> 结束
func unwrapQRC(text string) string {
	const attr = `LyricContent="`
	start := strings.Index(text, attr)
	if start < 0 {
		return text
	}
	rest := text[start+len(attr):]
	end := strings.Index(rest, `"/>`)
	if end < 0 {
		end = strings.LastIndex(rest, `"`)
	}
	if end < 0 {
		end = len(rest)
	}
	return html.UnescapeString(rest[:end])
}

// lyricQuery 要在其他平台匹配的歌曲；Duration 单位为秒，0 表示未知
type lyricQuery struct {
	Title    string
	Artists  []string
	Album    string
	Duration float64
}

// keyword 搜索关键词：歌名与歌手，以空格连接
func (q lyricQuery) keyword() string {
	parts := make([]string, 0, len(q.Artists)+1)
	for _, part := range append([]string{q.Title}, q.Artists...) {
		if part = strings.TrimSpace(part); part != "" {
			parts = append(parts, part)
		}
	}
	keyword := strings.Join(parts, " ")
	if utf8.RuneCountInString(keyword) > musicQQKeywordMaxRune {
		keyword = string([]rune(keyword)[:musicQQKeywordMaxRune])
	}
	return keyword
}

// lyricCandidate 搜索结果中的一首歌；Duration 单位为秒
type lyricCandidate struct {
	MID      string
	Title    string
	Artists  []string
	Album    string
	Duration float64
}

// bestLyricCandidate 得分最高的候选（同分取靠前的）；没有合格的候选时返回 nil
func bestLyricCandidate(candidates []lyricCandidate, query lyricQuery) *lyricCandidate {
	var best *lyricCandidate
	bestScore := 0
	for i := range candidates {
		if score, ok := scoreLyricCandidate(candidates[i], query); ok && score > bestScore {
			best, bestScore = &candidates[i], score
		}
	}
	return best
}

// scoreLyricCandidate 候选与歌曲的匹配得分（规则参考 StarryPlayer）：
//   - 歌名须相同，或一方包含另一方且较短的一方不少于较长一方的 34%
//   - 时长都已知时相差不能超过 20 秒，5 秒内为「时长接近」
//   - 有歌手时须有一位歌手相同或互相包含（至少 2 个字）；歌名不同时还须歌手匹配或时长接近
//   - 得分：歌名相同 10 / 包含 4，歌手相同 +5 / 包含 +2，专辑相同 +2，时长接近 +3
func scoreLyricCandidate(candidate lyricCandidate, query lyricQuery) (int, bool) {
	title, candidateTitle := normalizeLyricMatch(query.Title), normalizeLyricMatch(candidate.Title)
	if title == "" || candidateTitle == "" {
		return 0, false
	}
	titleEqual := title == candidateTitle
	if !titleEqual {
		if !eitherContains(title, candidateTitle) {
			return 0, false
		}
		a, b := utf8.RuneCountInString(title), utf8.RuneCountInString(candidateTitle)
		if float64(min(a, b))/float64(max(a, b)) < 0.34 {
			return 0, false
		}
	}

	durationKnown := query.Duration > 0 && candidate.Duration > 0
	delta := math.Abs(query.Duration - candidate.Duration)
	if durationKnown && delta > 20 {
		return 0, false
	}
	durationClose := durationKnown && delta <= 5

	var queryArtists, candidateArtists []string
	for _, artist := range query.Artists {
		if artist = normalizeLyricMatch(artist); artist != "" {
			queryArtists = append(queryArtists, artist)
		}
	}
	for _, artist := range candidate.Artists {
		for _, part := range strings.FieldsFunc(artist, func(r rune) bool { return strings.ContainsRune("、&;，,/|·・", r) }) {
			if part = normalizeLyricMatch(part); part != "" {
				candidateArtists = append(candidateArtists, part)
			}
		}
	}
	candidateFull := normalizeLyricMatch(strings.Join(candidate.Artists, ""))
	artistEqual, artistContained := false, false
	for _, artist := range queryArtists {
		for _, other := range append([]string{candidateFull}, candidateArtists...) {
			if artist == other {
				artistEqual = true
			} else if utf8.RuneCountInString(artist) >= 2 && eitherContains(other, artist) {
				artistContained = true
			}
		}
	}
	if artistEqual {
		artistContained = false
	}
	if len(queryArtists) > 0 && !artistEqual && !artistContained {
		return 0, false
	}
	if !titleEqual && !artistEqual && !artistContained && !durationClose {
		return 0, false
	}

	score := 4
	if titleEqual {
		score = 10
	}
	if artistEqual {
		score += 5
	} else if artistContained {
		score += 2
	}
	if album := normalizeLyricMatch(query.Album); album != "" && album == normalizeLyricMatch(candidate.Album) {
		score += 2
	}
	if durationClose {
		score += 3
	}
	return score, true
}

// normalizeLyricMatch 匹配用的归一化：小写，去掉空白、标点与符号
func normalizeLyricMatch(text string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(text) {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func eitherContains(a, b string) bool {
	return a != "" && b != "" && (strings.Contains(a, b) || strings.Contains(b, a))
}
