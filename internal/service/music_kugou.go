package service

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
	"golang.org/x/sync/singleflight"
)

// 酷狗音乐歌词（见 docs/music-player-spec.md 7.2i，接口与格式参考 StarryPlayer 的说明，代码自行编写）：
//   - 搜索：移动端搜索接口（只支持 HTTP，HTTPS 常常没有结果），按 StarryPlayer 的规则匹配同一首歌（scoreLyricCandidate）
//   - 歌词：按歌曲 hash、歌名与时长查歌词候选，再下载；逐字歌词为 KRC：「krc1」+ 与固定 16 字节密钥异或后的 zlib 数据
//   - KRC 的字时间相对行首，翻译与音译以 base64 JSON 放在 [language:] 标签中（翻译每行一句，音译与逐字对齐）。
//     后端转换为与 QQ 音乐相同的格式（逐字 QRC、LRC 翻译、逐字 QRC 音译），前端直接复用 QQ 音乐的解析

var (
	musicKugouSearchURL      = "http://mobilecdn.kugou.com/api/v3/search/song"
	musicKugouLyricSearchURL = "https://lyrics.kugou.com/search"
	musicKugouDownloadURL    = "https://lyrics.kugou.com/download"

	musicKugouCache = cache.NewLRUCacheWithSize(500, 16<<20)
	musicKugouGroup singleflight.Group

	// KRC 解密的固定密钥
	krcKey = []byte{0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69}
	// KRC 的一行：[开始,时长] 与逐字 <相对开始,时长,0>字
	krcLineRe = regexp.MustCompile(`^\[(\d+),(\d+)\](.*)$`)
	krcWordRe = regexp.MustCompile(`<(\d+),(\d+),\d+>([^<]*)`)
)

const (
	musicKugouUserAgent = "KuGou2012-9020-ExpandSearchManager"
	musicKugouSearchTag = "expand_search_manager.cpp:852736169:451"
	musicKugouPageSize  = 20
	musicKugouHitTTL    = 30 * 24 * time.Hour
	musicKugouMissTTL   = 24 * time.Hour
	// 搜索不完整（有某一路搜索出错）时「没有匹配」的缓存时长
	musicKugouDegradedMissTTL = time.Hour
)

type musicKugouCacheEntry struct {
	Lyric     dto.MusicKugouLyricDto `json:"lyric"`
	ExpiresAt int64                  `json:"expires_at"`
}

// GetKugouLyric 按网易云歌曲 id 在酷狗匹配同一首歌并取歌词；没有匹配或没有歌词时返回 404
func (s *MusicService) GetKugouLyric(ctx context.Context, id int64) (*dto.MusicKugouLyricDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	lyric, svcerr := s.cachedKugouLyric(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	if lyric.Lyric == "" {
		return nil, errs.NewNotFound("lyric_not_found")
	}
	return lyric, nil
}

func (s *MusicService) cachedKugouLyric(ctx context.Context, id int64) (*dto.MusicKugouLyricDto, *errs.ServiceError) {
	if data, ok := musicKugouCache.Get(uint(id)); ok {
		var entry musicKugouCacheEntry
		// 刷新歌词时不使用「没有匹配或没有歌词」的缓存
		if json.Unmarshal(data, &entry) == nil && time.Now().Unix() < entry.ExpiresAt && (entry.Lyric.Lyric != "" || !lyricRefreshing(ctx)) {
			return &entry.Lyric, nil
		}
		musicKugouCache.Remove(uint(id))
	}
	value, err, _ := musicKugouGroup.Do(strconv.FormatInt(id, 10), func() (any, error) {
		ctx := context.WithoutCancel(ctx)
		song, svcerr := s.GetSong(ctx, id)
		if svcerr != nil {
			return nil, svcerr
		}
		lyric, degraded, err := fetchKugouLyric(ctx, song)
		if err != nil {
			logrus.Warnf("kugou lyric request failed: %v", err)
			return nil, errs.New(http.StatusBadGateway, "music_lyric_source_failed", err)
		}
		ttl := musicKugouHitTTL
		if lyric.Lyric == "" {
			ttl = musicKugouMissTTL
			if degraded {
				ttl = musicKugouDegradedMissTTL
			}
		}
		if data, err := json.Marshal(musicKugouCacheEntry{Lyric: *lyric, ExpiresAt: time.Now().Add(ttl).Unix()}); err == nil {
			musicKugouCache.Put(uint(id), data)
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
	return value.(*dto.MusicKugouLyricDto), nil
}

// fetchKugouLyric 搜索并匹配同一首歌，取它的歌词；没有匹配时返回空结果（不是错误）。degraded 为有某一路搜索出错
func fetchKugouLyric(ctx context.Context, song *dto.MusicSongDto) (*dto.MusicKugouLyricDto, bool, error) {
	query := lyricQuery{Title: song.Name, Artists: song.Artists, Album: song.Album, Duration: float64(song.Duration) / 1000}
	best, degraded, err := searchKugouSong(ctx, query)
	if err != nil {
		return nil, true, err
	}
	if best == nil {
		return &dto.MusicKugouLyricDto{}, degraded, nil
	}
	lyric, err := fetchKugouSongLyric(ctx, best)
	if err != nil {
		return nil, true, err
	}
	lyric.Hash = best.MID
	return lyric, degraded, nil
}

// searchKugouSong 同时用「歌名 + 歌手」与「歌名」搜索，合并去重后匹配
func searchKugouSong(ctx context.Context, query lyricQuery) (*lyricCandidate, bool, error) {
	keywords := []string{query.keyword()}
	if title := strings.TrimSpace(query.Title); title != "" && title != keywords[0] {
		keywords = append(keywords, title)
	}
	results := make([][]lyricCandidate, len(keywords))
	failures := make([]error, len(keywords))
	var wg sync.WaitGroup
	for i, keyword := range keywords {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], failures[i] = searchKugouSongs(ctx, keyword)
		}()
	}
	wg.Wait()
	var merged []lyricCandidate
	seen := map[string]bool{}
	failed := 0
	for i, list := range results {
		if failures[i] != nil {
			failed++
			continue
		}
		for _, candidate := range list {
			if !seen[candidate.MID] {
				seen[candidate.MID] = true
				merged = append(merged, candidate)
			}
		}
	}
	if failed == len(keywords) {
		return nil, true, errors.Join(failures...)
	}
	return bestLyricCandidate(merged, query), failed > 0, nil
}

// searchKugouSongs 移动端歌曲搜索；MID 为歌曲文件 hash（统一为大写）
func searchKugouSongs(ctx context.Context, keyword string) ([]lyricCandidate, error) {
	params := url.Values{"keyword": {keyword}, "page": {"1"}, "pagesize": {strconv.Itoa(musicKugouPageSize)}, "format": {"json"}, "showtype": {"1"}}
	var raw struct {
		Data struct {
			Info []struct {
				Hash       string  `json:"hash"`
				SongName   string  `json:"songname"`
				SingerName string  `json:"singername"`
				AlbumName  string  `json:"album_name"`
				Duration   float64 `json:"duration"` // 秒
			} `json:"info"`
		} `json:"data"`
	}
	headers := map[string]string{"User-Agent": musicKugouUserAgent, "KG-THash": musicKugouSearchTag}
	if err := kugouGetJSON(ctx, musicKugouSearchURL, params, headers, &raw); err != nil {
		return nil, fmt.Errorf("kugou search: %w", err)
	}
	candidates := make([]lyricCandidate, 0, len(raw.Data.Info))
	for _, item := range raw.Data.Info {
		if item.Hash == "" || item.SongName == "" {
			continue
		}
		// 多位歌手以「、」连接，匹配时会拆开（见 scoreLyricCandidate）
		candidates = append(candidates, lyricCandidate{MID: strings.ToUpper(item.Hash), Title: item.SongName, Artists: []string{item.SingerName}, Album: item.AlbumName, Duration: item.Duration})
	}
	return candidates, nil
}

// fetchKugouSongLyric 按歌曲 hash 取歌词：先查歌词候选，再下载；逐字歌词转换为 QQ 音乐的格式
func fetchKugouSongLyric(ctx context.Context, song *lyricCandidate) (*dto.MusicKugouLyricDto, error) {
	var found struct {
		Candidates []struct {
			ID          json.Number `json:"id"`
			AccessKey   string      `json:"accesskey"`
			KRCType     int         `json:"krctype"`
			ContentType int         `json:"contenttype"`
		} `json:"candidates"`
	}
	params := url.Values{"ver": {"1"}, "man": {"yes"}, "client": {"pc"}, "lrctxt": {"1"}, "keyword": {song.Title}, "hash": {song.MID}, "timelength": {strconv.Itoa(int(song.Duration))}}
	if err := kugouGetJSON(ctx, musicKugouLyricSearchURL, params, nil, &found); err != nil {
		return nil, fmt.Errorf("kugou lyric search: %w", err)
	}
	if len(found.Candidates) == 0 || found.Candidates[0].ID.String() == "" || found.Candidates[0].AccessKey == "" {
		return &dto.MusicKugouLyricDto{}, nil
	}
	candidate := found.Candidates[0]
	format := "lrc"
	if candidate.KRCType == 1 && candidate.ContentType != 1 {
		format = "krc"
	}
	var file struct {
		Content string `json:"content"`
	}
	params = url.Values{"ver": {"1"}, "client": {"pc"}, "charset": {"utf8"}, "id": {candidate.ID.String()}, "accesskey": {candidate.AccessKey}, "fmt": {format}}
	if err := kugouGetJSON(ctx, musicKugouDownloadURL, params, nil, &file); err != nil {
		return nil, fmt.Errorf("kugou lyric download: %w", err)
	}
	data, err := base64.StdEncoding.DecodeString(file.Content)
	if err != nil || len(data) == 0 {
		return &dto.MusicKugouLyricDto{}, nil
	}
	if format == "lrc" {
		return &dto.MusicKugouLyricDto{Format: "lrc", Lyric: strings.TrimSpace(string(data))}, nil
	}
	text, err := decryptKRC(data)
	if err != nil {
		return nil, err
	}
	return krcToQRC(text), nil
}

// decryptKRC KRC：「krc1」+ 与固定密钥循环异或后的 zlib 数据
func decryptKRC(data []byte) (string, error) {
	if len(data) < 4 || string(data[:4]) != "krc1" {
		return "", errors.New("krc: bad magic")
	}
	body := make([]byte, len(data)-4)
	for i, b := range data[4:] {
		body[i] = b ^ krcKey[i%len(krcKey)]
	}
	reader, err := zlib.NewReader(bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("krc: %w", err)
	}
	defer reader.Close()
	text, err := io.ReadAll(io.LimitReader(reader, 4<<20))
	if err != nil {
		return "", fmt.Errorf("krc: %w", err)
	}
	return string(text), nil
}

// krcToQRC 把 KRC 转换为 QQ 音乐的格式：正文为逐字 QRC（字时间换算为绝对时间），翻译为 LRC，音译为与正文逐字对齐的 QRC
func krcToQRC(text string) *dto.MusicKugouLyricDto {
	type krcWord struct {
		start, duration int
		text            string
	}
	type krcLine struct {
		start, duration int
		words           []krcWord
	}
	var lines []krcLine
	var language string
	for _, raw := range strings.Split(text, "\n") {
		raw = strings.TrimRight(raw, "\r")
		if value, ok := strings.CutPrefix(raw, "[language:"); ok {
			language = strings.TrimSuffix(value, "]")
			continue
		}
		m := krcLineRe.FindStringSubmatch(raw)
		if m == nil {
			continue
		}
		start, _ := strconv.Atoi(m[1])
		duration, _ := strconv.Atoi(m[2])
		line := krcLine{start: start, duration: duration}
		for _, w := range krcWordRe.FindAllStringSubmatch(m[3], -1) {
			offset, _ := strconv.Atoi(w[1])
			length, _ := strconv.Atoi(w[2])
			line.words = append(line.words, krcWord{start: start + offset, duration: length, text: w[3]})
		}
		lines = append(lines, line)
	}

	// 翻译（type 1，每行一句）与音译（type 0，每个字一个音节）
	var translations [][]string
	var romanizations [][]string
	if decoded, err := base64.StdEncoding.DecodeString(language); err == nil {
		var parsed struct {
			Content []struct {
				Type         int        `json:"type"`
				LyricContent [][]string `json:"lyricContent"`
			} `json:"content"`
		}
		if json.Unmarshal(decoded, &parsed) == nil {
			for _, part := range parsed.Content {
				switch part.Type {
				case 1:
					translations = part.LyricContent
				case 0:
					romanizations = part.LyricContent
				}
			}
		}
	}

	var lyric, translation, romanization strings.Builder
	for i, line := range lines {
		fmt.Fprintf(&lyric, "[%d,%d]", line.start, line.duration)
		for _, word := range line.words {
			fmt.Fprintf(&lyric, "%s(%d,%d)", word.text, word.start, word.duration)
		}
		lyric.WriteString("\n")
		if i < len(translations) && len(translations[i]) > 0 {
			if text := strings.TrimSpace(strings.Join(translations[i], "")); text != "" {
				fmt.Fprintf(&translation, "[%02d:%02d.%02d]%s\n", line.start/60000, line.start/1000%60, line.start%1000/10, text)
			}
		}
		// 音节与字一一对应时才转换（对不齐的行不要音译）
		if i < len(romanizations) && len(romanizations[i]) == len(line.words) && len(line.words) > 0 {
			fmt.Fprintf(&romanization, "[%d,%d]", line.start, line.duration)
			for j, word := range line.words {
				fmt.Fprintf(&romanization, "%s(%d,%d)", romanizations[i][j], word.start, word.duration)
			}
			romanization.WriteString("\n")
		}
	}
	return &dto.MusicKugouLyricDto{
		Format:       "qrc",
		Lyric:        strings.TrimRight(lyric.String(), "\n"),
		Translation:  strings.TrimRight(translation.String(), "\n"),
		Romanization: strings.TrimRight(romanization.String(), "\n"),
	}
}

// kugouGetJSON 请求酷狗接口并解析 JSON；网络错误与 5xx 重试一次
func kugouGetJSON(ctx context.Context, endpoint string, params url.Values, headers map[string]string, out any) error {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		reqCtx, cancel := context.WithTimeout(ctx, musicRequestTimeout)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
		if err != nil {
			cancel()
			return err
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			lastErr = err
			continue
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		cancel()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("status %d", resp.StatusCode)
			continue
		}
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("status %d", resp.StatusCode)
		}
		// 移动端搜索可能在 JSON 前带回调包装，只取最外层对象
		start, end := bytes.IndexByte(data, '{'), bytes.LastIndexByte(data, '}')
		if start < 0 || end <= start {
			return errors.New("invalid response")
		}
		return json.Unmarshal(data[start:end+1], out)
	}
	return lastErr
}
