package service

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"hash/fnv"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
	"golang.org/x/sync/singleflight"
)

// TTML 歌词来源（见 docs/music-player-spec.md 2.6、7.2，规则参考 StarryPlayer）：
// - 自定义源：环境变量 MUSIC_TTML_URL_PREFIX 或后台配置 music_ttml_url_template（环境变量优先）的地址（含 {id} 的模板，或静态目录前缀 {prefix}/{网易云歌曲 id}.ttml），
//   优先级最高，命中即采用
// - AMLL TTML DB：按网易云歌曲 id 取 ncm-lyrics/{id}.ttml；多个镜像并发请求，先返回有效结果的采用。
//   在 QQ 音乐匹配到同一首歌后，还会按 QQ 歌曲 mid 取 qq-lyrics/{mid}.ttml（见 music_qq.go）
// 两个来源并发探测；只把「确定没有」（3xx / 404 / 410、正文不是 TTML）记为未命中并缓存，超时与网络错误不缓存

const (
	musicTTMLSourceCustom = "custom"
	musicTTMLSourceAMLL   = "amll"

	musicTTMLTimeout  = 8 * time.Second
	musicTTMLMaxBytes = 1 << 20
	// 命中长期有效（只受 LRU 淘汰），确定未命中 72 小时内不再探测
	musicTTMLMissTTL = 72 * time.Hour
	// 各镜像是同一仓库的副本：这么多个镜像确定未命中时即可断定没有，不再等其余镜像
	// （amlldb.bikonoo.com 对不存在的文件约 5～8 秒后才返回 302，等它会拖慢每一首没有 TTML 的歌）
	musicTTMLMissQuorum = 2
)

// AMLL TTML DB 镜像（仓库 amll-dev/amll-ttml-db），按顺序列出，实际并发请求
var musicTTMLMirrors = []string{
	"https://amlldb.bikonoo.com",
	"https://cdn.jsdelivr.net/gh/amll-dev/amll-ttml-db@main",
	"https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main",
}

var (
	musicTTMLCache = cache.NewLRUCacheWithSize(1000, 32<<20)
	// 按 QQ 音乐歌曲 mid 收录的 TTML，键为 mid 的哈希
	musicQQTTMLCache = cache.NewLRUCacheWithSize(500, 16<<20)
	musicTTMLGroup   singleflight.Group
	// 不跟随重定向：重定向一律视为未命中
	musicTTMLClient = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
)

// ttmlProbe 一次探测的结果：命中（TTML 正文）、确定未命中、或出错（不缓存）
type ttmlProbe struct {
	ttml string
	miss bool
}

// musicTTMLCacheEntry 缓存条目：TTML 为空表示确定未命中，MissUntil 之后重新探测
type musicTTMLCacheEntry struct {
	TTML      string `json:"ttml"`
	MissUntil int64  `json:"miss_until,omitempty"`
}

// customTTMLURL 自定义源中这首歌的地址：配置中含 {id}（或 {song_id}）时把它替换为网易云歌曲 id（支持任意链接风格，
// 如 https://cdn.example.com/lyrics/{id}.ttml、https://example.com/ttml?id={id}），否则视为目录前缀，拼接为 {前缀}/{id}.ttml。
// 只接受 http(s) 绝对地址；未配置或无效时为空（跳过自定义源）
func customTTMLURL(id int64) string {
	pattern, _ := tools.GetMusicTTMLURLTemplate()
	if pattern == "" {
		return ""
	}
	songID := strconv.FormatInt(id, 10)
	raw := strings.TrimRight(pattern, "/") + "/" + songID + ".ttml"
	if strings.Contains(pattern, "{id}") || strings.Contains(pattern, "{song_id}") {
		raw = strings.NewReplacer("{id}", songID, "{song_id}", songID).Replace(pattern)
	}
	if u, err := url.Parse(raw); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return raw
}

// GetTTMLLyric 按网易云歌曲 id 取 TTML 歌词。source 为空时自动选择（自定义源优先），也可只取某一来源（用于手动切换）
func (s *MusicService) GetTTMLLyric(ctx context.Context, id int64, source string) (*dto.MusicTTMLDto, *errs.ServiceError) {
	if id <= 0 || (source != "" && source != musicTTMLSourceCustom && source != musicTTMLSourceAMLL) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	sources := []string{musicTTMLSourceCustom, musicTTMLSourceAMLL}
	if source != "" {
		sources = []string{source}
	}
	lyric, _ := probeTTMLSources(ctx, id, sources)
	if lyric == nil {
		return nil, errs.NewNotFound("lyric_not_found")
	}
	return lyric, nil
}

// probeTTMLSources 各来源并发探测（每个来源自己带缓存与同 id 请求合并），按优先级取第一个命中（未配置的自定义源跳过）；
// 没有命中时 outcome 区分「都确定没有」与「有来源出错」（全站歌词版本据此判断能否换掉已选的 TTML，见 music_lyric_version.go）
func probeTTMLSources(ctx context.Context, id int64, sources []string) (*dto.MusicTTMLDto, lyricOutcome) {
	if customTTMLURL(id) == "" {
		sources = slices.DeleteFunc(slices.Clone(sources), func(src string) bool { return src == musicTTMLSourceCustom })
	}
	results := make([]chan *ttmlProbe, len(sources))
	for i, src := range sources {
		results[i] = make(chan *ttmlProbe, 1)
		go func(src string, out chan<- *ttmlProbe) {
			out <- probeTTMLSource(ctx, src, id)
		}(src, results[i])
	}
	outcome := lyricOutcomeMiss
	for i, src := range sources {
		// 优先级高的来源命中后直接返回，不等后面的来源
		result := <-results[i]
		if result != nil && result.ttml != "" {
			return &dto.MusicTTMLDto{Source: src, TTML: result.ttml}, lyricOutcomeHit
		}
		if result == nil {
			outcome = lyricOutcomeFailed
		}
	}
	return nil, outcome
}

// probeTTMLSource 探测一个来源（按网易云歌曲 id）
func probeTTMLSource(ctx context.Context, source string, id int64) *ttmlProbe {
	name := strconv.FormatInt(id, 10) + ".ttml"
	if source == musicTTMLSourceAMLL {
		return probeTTML(ctx, musicTTMLCache, ttmlCacheKey(source, id), source+":"+name, amllTTMLURLs("ncm-lyrics/"+name))
	}
	// 自定义源按完整地址缓存：后台改了地址后立即按新地址探测，不受旧地址「确定未命中」缓存的影响
	address := customTTMLURL(id)
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(address))
	return probeTTML(ctx, musicTTMLCache, uint(hash.Sum64()), source+":"+address, []string{address})
}

// probeQQTTML AMLL TTML DB 中按 QQ 音乐歌曲 mid 收录的歌词（qq-lyrics/{mid}.ttml），mid 由 QQ 音乐匹配得到
func probeQQTTML(ctx context.Context, mid string) *ttmlProbe {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(mid))
	return probeTTML(ctx, musicQQTTMLCache, uint(hash.Sum64()), "qq:"+mid, amllTTMLURLs("qq-lyrics/"+mid+".ttml"))
}

// amllTTMLURLs 同一文件在 AMLL TTML DB 各镜像上的地址
func amllTTMLURLs(path string) []string {
	urls := make([]string, 0, len(musicTTMLMirrors))
	for _, mirror := range musicTTMLMirrors {
		urls = append(urls, mirror+"/"+path)
	}
	return urls
}

// probeTTML 先查缓存，再合并同一文件的并发请求；出错时返回 nil
func probeTTML(ctx context.Context, store *cache.LRUCache, key uint, flight string, urls []string) *ttmlProbe {
	if data, ok := store.Get(key); ok {
		var entry musicTTMLCacheEntry
		if json.Unmarshal(data, &entry) == nil {
			if entry.TTML != "" {
				return &ttmlProbe{ttml: entry.TTML}
			}
			// 刷新歌词时不信任「确定未命中」的缓存，重新探测
			if time.Now().Unix() < entry.MissUntil && !lyricRefreshing(ctx) {
				return &ttmlProbe{miss: true}
			}
		}
		store.Remove(key)
	}

	value, _, _ := musicTTMLGroup.Do(flight, func() (any, error) {
		// 请求合并后由多个调用方共享结果，不随第一个调用方的请求取消
		probe := fetchTTMLURLs(context.WithoutCancel(ctx), urls)
		switch {
		case probe == nil:
		case probe.ttml != "":
			storeTTMLCache(store, key, musicTTMLCacheEntry{TTML: probe.ttml})
		case probe.miss:
			storeTTMLCache(store, key, musicTTMLCacheEntry{MissUntil: time.Now().Add(musicTTMLMissTTL).Unix()})
		}
		return probe, nil
	})
	probe, _ := value.(*ttmlProbe)
	return probe
}

func storeTTMLCache(store *cache.LRUCache, key uint, entry musicTTMLCacheEntry) {
	if data, err := json.Marshal(entry); err == nil {
		store.Put(key, data)
	}
}

// ttmlCacheKey LRU 以无符号整数为键：最低位区分来源
func ttmlCacheKey(source string, id int64) uint {
	key := uint(id) << 1
	if source == musicTTMLSourceAMLL {
		key |= 1
	}
	return key
}

// fetchTTMLURLs 并发请求同一文件的各个地址（自定义源只有一个，AMLL 为各镜像）：任一命中即采用；
// 全部（或 musicTTMLMissQuorum 个）确定未命中即算未命中，其余请求取消；否则视为出错
func fetchTTMLURLs(ctx context.Context, urls []string) *ttmlProbe {
	ctx, cancel := context.WithTimeout(ctx, musicTTMLTimeout)
	defer cancel()
	results := make(chan *ttmlProbe, len(urls))
	for _, u := range urls {
		go func(u string) {
			probe, err := fetchTTML(ctx, u)
			if err != nil {
				logrus.Debugf("ttml request failed: %s: %v", u, err)
			}
			results <- probe
		}(u)
	}
	misses := 0
	for range urls {
		probe := <-results
		if probe == nil {
			continue
		}
		if probe.ttml != "" {
			return probe
		}
		misses++
		if misses >= min(musicTTMLMissQuorum, len(urls)) {
			return &ttmlProbe{miss: true}
		}
	}
	return nil
}

// fetchTTML 请求单个地址：200 且正文为合法 TTML 时命中；3xx / 404 / 410、正文不是 TTML 时确定未命中；其余为出错
func fetchTTML(ctx context.Context, u string) (*ttmlProbe, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "neo-blog")
	resp, err := musicTTMLClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode >= 300 && resp.StatusCode < 400, resp.StatusCode == http.StatusNotFound, resp.StatusCode == http.StatusGone:
		return &ttmlProbe{miss: true}, nil
	case resp.StatusCode != http.StatusOK:
		return nil, errors.New(resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, musicTTMLMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > musicTTMLMaxBytes || !isTTMLDocument(data) {
		return &ttmlProbe{miss: true}, nil
	}
	return &ttmlProbe{ttml: string(bytes.TrimSpace(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))}, nil
}

// isTTMLDocument 正文以 < 开头、是格式正确的 XML，且根元素为 tt（防止把整页 HTML 等当作歌词）
func isTTMLDocument(data []byte) bool {
	data = bytes.TrimSpace(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
	if len(data) == 0 || data[0] != '<' {
		return false
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = true
	root := ""
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return root == "tt"
		}
		if err != nil {
			return false
		}
		if start, ok := token.(xml.StartElement); ok && root == "" {
			root = start.Name.Local
			if root != "tt" {
				return false
			}
		}
	}
}
