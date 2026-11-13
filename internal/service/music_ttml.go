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
	"strconv"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/errs"
	"golang.org/x/sync/singleflight"
)

// TTML 歌词来源（见 docs/music-player-spec.md 2.6、7.2，规则参考 StarryPlayer）：
// - 自定义源：环境变量 MUSIC_TTML_URL_PREFIX 或后台配置 music_ttml_sources（环境变量优先）中的各个源（地址为含 {id} 的模板，
//   或静态目录前缀 {prefix}/{网易云歌曲 id}.ttml），优先级最高，按列表顺序先命中的采用
// - AMLL TTML DB：按网易云歌曲 id 取 ncm-lyrics/{id}.ttml；多个镜像并发请求，先返回有效结果的采用。
//   在 QQ 音乐匹配到同一首歌后，还会按 QQ 歌曲 mid 取 qq-lyrics/{mid}.ttml（见 music_qq.go）
// 各来源并发探测；只把「确定没有」（3xx / 404 / 410、正文不是 TTML）记为未命中并缓存，超时与网络错误不缓存。
// 命中的缓存在复核时按整个文件的正文摘要比较（上游只改某个字的时间轴也算改动），见 lyricRevalidateInterval

const (
	musicTTMLSourceCustom = "custom"
	musicTTMLSourceAMLL   = "amll"

	musicTTMLTimeout  = 8 * time.Second
	musicTTMLMaxBytes = 1 << 20
	// 命中缓存 30 天，确定未命中 72 小时内不再探测；命中期间按 lyricRevalidateInterval 与上游复核
	musicTTMLHitTTL  = 30 * 24 * time.Hour
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
	musicTTMLCache = cache.NewIDCache("music:ttml", 1000, 32<<20)
	// 按 QQ 音乐歌曲 mid 收录的 TTML，键为 mid 的哈希
	musicQQTTMLCache = cache.NewIDCache("music:qq-ttml", 500, 16<<20)
	musicTTMLGroup   singleflight.Group
	// 不跟随重定向：重定向一律视为未命中
	musicTTMLClient = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
)

// ttmlProbe 一次探测的结果：命中（TTML 正文）、确定未命中、或出错（不缓存）
type ttmlProbe struct {
	ttml string
	miss bool
}

// musicTTMLCacheEntry 缓存条目：TTML 为空表示确定未命中，MissUntil 之后重新探测；
// TTML 有内容时 Hash 为整个文件正文的摘要（sha256），CheckedAt 为上次与上游核对一致的时间
type musicTTMLCacheEntry struct {
	TTML      string `json:"ttml"`
	Hash      string `json:"hash,omitempty"`
	CheckedAt int64  `json:"checked_at,omitempty"`
	MissUntil int64  `json:"miss_until,omitempty"`
}

// ttmlTarget 要探测的一个 TTML 来源：自定义源（各有名称与这首歌的地址）或 AMLL TTML DB
type ttmlTarget struct {
	source string
	name   string
	url    string
}

// ttmlTargets 按优先级展开要探测的来源：custom 展开为后台配置的各个自定义源（按列表顺序，地址无效的跳过），amll 为 AMLL TTML DB
func ttmlTargets(id int64, sources []string) []ttmlTarget {
	var targets []ttmlTarget
	for _, src := range sources {
		if src == musicTTMLSourceAMLL {
			targets = append(targets, ttmlTarget{source: src})
			continue
		}
		for _, custom := range tools.GetMusicTTMLSources() {
			if address := custom.SongURL(id); address != "" {
				targets = append(targets, ttmlTarget{source: src, name: custom.Name, url: address})
			}
		}
	}
	return targets
}

// ClearTTMLCache 清空所有 TTML 探测缓存（含 72 小时确定未命中的负缓存与 QQ 歌曲 TTML 缓存），多副本同步失效
func (s *MusicService) ClearTTMLCache() {
	musicTTMLCache.Clear()
	musicQQTTMLCache.Clear()
}

// GetTTMLLyric 按网易云歌曲 id 取 TTML 歌词。source 为空时自动选择（自定义源优先），也可只取某一来源（用于手动切换，custom 为全部自定义源）
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

// probeTTMLSources 各来源并发探测（每个来源自己带缓存与同 id 请求合并），按优先级取第一个命中（没有配置自定义源时跳过）；
// 没有命中时 outcome 区分「都确定没有」与「有来源出错」（全站歌词版本据此判断能否换掉已选的 TTML，见 music_lyric_version.go）
func probeTTMLSources(ctx context.Context, id int64, sources []string) (*dto.MusicTTMLDto, lyricOutcome) {
	targets := ttmlTargets(id, sources)
	results := make([]chan *ttmlProbe, len(targets))
	for i, target := range targets {
		results[i] = make(chan *ttmlProbe, 1)
		go func(target ttmlTarget, out chan<- *ttmlProbe) {
			out <- probeTTMLTarget(ctx, target, id)
		}(target, results[i])
	}
	outcome := lyricOutcomeMiss
	for i, target := range targets {
		// 优先级高的来源命中后直接返回，不等后面的来源
		result := <-results[i]
		if result != nil && result.ttml != "" {
			return &dto.MusicTTMLDto{Source: target.source, Name: target.name, TTML: result.ttml}, lyricOutcomeHit
		}
		if result == nil {
			outcome = lyricOutcomeFailed
		}
	}
	return nil, outcome
}

// probeTTMLTarget 探测一个来源（按网易云歌曲 id）
func probeTTMLTarget(ctx context.Context, target ttmlTarget, id int64) *ttmlProbe {
	if target.source == musicTTMLSourceAMLL {
		name := strconv.FormatInt(id, 10) + ".ttml"
		return probeTTML(ctx, musicTTMLCache, ttmlCacheKey(target.source, id), target.source+":"+name, amllTTMLURLs("ncm-lyrics/"+name))
	}
	// 自定义源按完整地址缓存：后台改了地址后立即按新地址探测，不受旧地址「确定未命中」缓存的影响
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(target.url))
	return probeTTML(ctx, musicTTMLCache, uint(hash.Sum64()), target.source+":"+target.url, []string{target.url})
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

// ttmlCachedEntry 缓存里的条目（ok 为 false 表示没有或无法解析）
type ttmlCachedEntry struct {
	entry musicTTMLCacheEntry
	ok    bool
}

// probeTTML 先查缓存：命中的缓存立即返回，到了复核时间在后台与上游复核；没有缓存或刷新时才同步请求。出错时返回 nil
func probeTTML(ctx context.Context, store cache.IDCache, key uint, flight string, urls []string) *ttmlProbe {
	cached := loadTTMLCacheEntry(store, key)
	// 管理员强制复核时连有效期也不信，直接从上游重新探测
	if cached.ok && !lyricForced(ctx) {
		if cached.entry.TTML == "" {
			// 刷新歌词时不信任「确定未命中」的缓存，重新探测
			if time.Now().Unix() < cached.entry.MissUntil && !lyricRefreshing(ctx) {
				return &ttmlProbe{miss: true}
			}
		} else {
			// 命中的歌词立即返回，到了复核时间就在后台与上游核对（不让读者等上游）
			if ttmlNeedsRevalidate(&cached.entry) {
				revalidateLyricInBackground("ttml:"+flight, func(ctx context.Context) error {
					if refetchTTML(ctx, store, key, flight, urls, cached) == nil {
						return errors.New("ttml request failed")
					}
					return nil
				})
			}
			return &ttmlProbe{ttml: cached.entry.TTML}
		}
	}

	// 请求合并后由多个调用方共享结果，不随第一个调用方的请求取消
	probe := refetchTTML(context.WithoutCancel(ctx), store, key, flight, urls, cached)
	// 强制复核时出错：继续用缓存里的歌词，不让上游的临时故障把歌词换掉
	if probe == nil && cached.ok && cached.entry.TTML != "" {
		return &ttmlProbe{ttml: cached.entry.TTML}
	}
	return probe
}

// refetchTTML 向上游重新探测并写入缓存（出错不写缓存，返回 nil）；同一文件的并发请求（前台获取与后台复核）合并为一次
func refetchTTML(ctx context.Context, store cache.IDCache, key uint, flight string, urls []string, cached ttmlCachedEntry) *ttmlProbe {
	value, _, _ := musicTTMLGroup.Do(flight, func() (any, error) {
		probe := fetchTTMLURLs(ctx, urls)
		switch {
		case probe == nil:
			// 出错不写缓存；命中过缓存的继续用旧内容，退避后再复核
		case probe.ttml != "":
			entry := ttmlCacheEntryOf(probe.ttml)
			storeTTMLCache(store, key, entry)
			// 缓存里已有内容且摘要不同：上游改了文件（可能只改了时间轴）
			if cached.ok && cached.entry.Hash != "" && cached.entry.Hash != entry.Hash {
				logrus.Infof("ttml changed upstream, cache updated: %s", flight)
			} else {
				logrus.Debugf("ttml revalidated: %s", flight)
			}
		case probe.miss:
			storeTTMLCache(store, key, musicTTMLCacheEntry{MissUntil: time.Now().Add(musicTTMLMissTTL).Unix()})
		}
		return probe, nil
	})
	probe, _ := value.(*ttmlProbe)
	return probe
}

// loadTTMLCacheEntry 读缓存条目；没有或无法解析时 ok 为 false
func loadTTMLCacheEntry(store cache.IDCache, key uint) ttmlCachedEntry {
	data, found := store.Get(key)
	if !found {
		return ttmlCachedEntry{}
	}
	var entry musicTTMLCacheEntry
	if json.Unmarshal(data, &entry) != nil {
		return ttmlCachedEntry{}
	}
	return ttmlCachedEntry{entry: entry, ok: true}
}

// ttmlNeedsRevalidate 命中的缓存是否该在后台与上游复核（隔 lyricRevalidateInterval 一次）
func ttmlNeedsRevalidate(entry *musicTTMLCacheEntry) bool {
	return lyricCacheStale(entry.CheckedAt, entry.Hash != "")
}

// ttmlCacheEntryOf 按这次取到的正文生成缓存条目：摘要用于与上次比较（相同表示上游没改，只是把核对时间往后推）
func ttmlCacheEntryOf(ttml string) musicTTMLCacheEntry {
	return musicTTMLCacheEntry{TTML: ttml, Hash: lyricContentDigest(ttml), CheckedAt: time.Now().Unix()}
}

func storeTTMLCache(store cache.IDCache, key uint, entry musicTTMLCacheEntry) {
	ttl := musicTTMLHitTTL
	if entry.TTML == "" {
		ttl = time.Until(time.Unix(entry.MissUntil, 0))
	}
	if data, err := json.Marshal(entry); err == nil {
		store.Put(key, data, ttl)
	}
}

// ttmlCacheKey 缓存以无符号整数为键：最低位区分来源
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
