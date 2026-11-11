package service

import (
	"bytes"
	"context"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 站内文件统一以稳定链接 /api/v1/file/f/<id> 保存在正文、封面、头像、配置中：
// 文件换存储只需修改 files.provider_id，修改 S3 公开地址也不用改动内容。
// 接口返回 JSON 时再把稳定链接改写为可直连存储（配置了公开地址的 S3）的直链，浏览器直接向存储请求；
// 写入时反过来把直链还原为稳定链接。改写由 middleware.UseFileLinks 统一完成。

// fileLinkPath 稳定链接的路径前缀
var fileLinkPath = constant.ApiPrefix + constant.FileUriPrefix + "/"

// fileLinkPattern 稳定链接：前面必须是引号、括号、空白等分隔符（避免误改其他站点的同名路径），可带本站域名与文件名后缀
var fileLinkPattern = regexp.MustCompile(`(^|[\s"'(=,\[>])(https?://[^\s"'<>()\\/]+)?` + regexp.QuoteMeta(fileLinkPath) + `(\d+)(?:/[^\s"'<>()\\?#]*)?`)

// FileLink 文件的稳定链接（站内相对路径）
func FileLink(id uint) string {
	return fileLinkPath + strconv.FormatUint(uint64(id), 10)
}

func fileStoragePath(hash string) string {
	return path.Join(utils.FilePath(hash))
}

// ---------- 读取：稳定链接 → 直链 ----------

// fileLoc 文件所在的存储与内容哈希；providerID 为 0 表示文件不存在，checkedAt 为当时查询的时间
type fileLoc struct {
	providerID uint
	hash       string
	checkedAt  time.Time
}

// fileLocCacheLimit 缓存条目上限，超出时整体清空（文件 ID 与哈希不变，只有迁移会改变所在存储）
const fileLocCacheLimit = 20000

// fileLocMissingTTL 「文件不存在」的结果只缓存这么久：恢复数据库备份、导入数据后同一 id 可能重新出现
const fileLocMissingTTL = time.Minute

// fileLinkChangedChannel 迁移完成后通知其他实例清空文件位置缓存
const fileLinkChangedChannel = "file_links_changed"

var (
	fileLocCache   = make(map[uint]fileLoc)
	fileLocCacheMu sync.RWMutex
)

// ResetFileLinkCache 清空本实例的文件位置缓存
func ResetFileLinkCache() {
	fileLocCacheMu.Lock()
	fileLocCache = make(map[uint]fileLoc)
	fileLocCacheMu.Unlock()
}

// fileLinksChanged 文件所在存储变化后清空本实例缓存并通知其他实例
func fileLinksChanged() {
	ResetFileLinkCache()
	sharedstate.Notify(fileLinkChangedChannel, "")
}

// ListenFileLinkChanges 订阅其他实例的迁移结果，及时清空文件位置缓存
func ListenFileLinkChanges() {
	sharedstate.OnNotify(fileLinkChangedChannel, func(string) { ResetFileLinkCache() })
}

func lookupFileLocs(ids []uint) map[uint]fileLoc {
	result := make(map[uint]fileLoc, len(ids))
	var missing []uint
	fileLocCacheMu.RLock()
	now := time.Now()
	for _, id := range ids {
		if loc, ok := fileLocCache[id]; ok && (loc.providerID != 0 || now.Sub(loc.checkedAt) < fileLocMissingTTL) {
			result[id] = loc
		} else {
			missing = append(missing, id)
		}
	}
	fileLocCacheMu.RUnlock()
	if len(missing) == 0 {
		return result
	}
	files, err := repo.File.ListLocations(missing)
	if err != nil {
		logrus.Warnf("查询文件位置失败: %v", err)
		return result
	}
	for _, id := range missing {
		result[id] = fileLoc{checkedAt: now}
	}
	for _, f := range files {
		result[f.ID] = fileLoc{providerID: f.ProviderID, hash: f.Hash}
	}
	fileLocCacheMu.Lock()
	if len(fileLocCache)+len(missing) > fileLocCacheLimit {
		fileLocCache = make(map[uint]fileLoc)
	}
	for _, id := range missing {
		fileLocCache[id] = result[id]
	}
	fileLocCacheMu.Unlock()
	return result
}

// hasDirectStorage 是否存在可直连的存储；没有时读写都不需要改写
func hasDirectStorage() bool {
	for _, provider := range storage.ListStorageProviders() {
		if !provider.IsProxy() {
			return true
		}
	}
	return false
}

// directURL 文件在可直连存储中的直链；存储需要代理时返回空字符串
func directURL(loc fileLoc) string {
	if loc.providerID == 0 {
		return ""
	}
	provider, ok := storage.GetStorageProvider(loc.providerID)
	if !ok || provider.IsProxy() {
		return ""
	}
	url, err := provider.GetURL(context.Background(), fileStoragePath(loc.hash), 0)
	if err != nil || strings.ContainsAny(url, "\"\\<>&") { // 直链原样写入 JSON 与 HTML，含需要转义的字符时不改写
		return ""
	}
	return url
}

// RewriteFileLinks 把内容中的稳定链接改写为直链，无需改动时返回 false；不在可直连存储中的文件保持稳定链接（经后端代理）
func RewriteFileLinks(data []byte) ([]byte, bool) {
	if !bytes.Contains(data, []byte(fileLinkPath)) || !hasDirectStorage() {
		return data, false
	}
	type candidate struct {
		start, end int // 链接（不含前面的分隔符）在 data 中的位置
		id         uint
	}
	origin := tools.GetBaseUrl()
	var candidates []candidate
	ids := make([]uint, 0)
	for _, m := range fileLinkPattern.FindAllSubmatchIndex(data, -1) {
		if m[4] >= 0 && !strings.EqualFold(string(data[m[4]:m[5]]), origin) {
			continue // 其他站点的链接
		}
		id, err := strconv.ParseUint(string(data[m[6]:m[7]]), 10, 64)
		if err != nil {
			continue
		}
		candidates = append(candidates, candidate{start: m[3], end: m[1], id: uint(id)})
		ids = append(ids, uint(id))
	}
	if len(candidates) == 0 {
		return data, false
	}
	locs := lookupFileLocs(ids)
	var out bytes.Buffer
	last := 0
	for _, c := range candidates {
		url := directURL(locs[c.id])
		if url == "" {
			continue
		}
		out.Write(data[last:c.start])
		out.WriteString(url)
		last = c.end
	}
	if last == 0 {
		return data, false
	}
	out.Write(data[last:])
	return out.Bytes(), true
}

// ---------- 写入：直链 → 稳定链接 ----------

// directLinkMatcher 识别某个直连存储的对象直链
type directLinkMatcher struct {
	providerID uint
	prefix     string // 直链中对象路径之前的固定部分，用于快速判断与 LIKE 粗筛
	pattern    *regexp.Regexp
}

// newDirectLinkMatcher 由存储生成对象直链的方式推导匹配规则；需要代理的存储没有直链
func newDirectLinkMatcher(providerID uint, provider storageprovider.StorageProvider) (directLinkMatcher, bool) {
	if provider.IsProxy() {
		return directLinkMatcher{}, false
	}
	const dir, hash = "{dir}", "{hash}"
	tmpl, err := provider.GetURL(context.Background(), dir+"/"+hash, 0)
	before, after, found := strings.Cut(tmpl, dir+"/"+hash)
	if err != nil || !found || before == "" {
		return directLinkMatcher{}, false
	}
	return directLinkMatcher{
		providerID: providerID,
		prefix:     before,
		pattern:    regexp.MustCompile(regexp.QuoteMeta(before) + `([0-9a-f]{4})/([0-9a-f]{64})` + regexp.QuoteMeta(after)),
	}, true
}

// currentDirectLinkMatchers 当前所有可直连存储的匹配规则；providerIDs 不为空时只取其中的存储
func currentDirectLinkMatchers(providerIDs ...uint) []directLinkMatcher {
	var matchers []directLinkMatcher
	for id, provider := range storage.ListStorageProviders() {
		if len(providerIDs) > 0 && !slices.Contains(providerIDs, id) {
			continue
		}
		if m, ok := newDirectLinkMatcher(id, provider); ok {
			matchers = append(matchers, m)
		}
	}
	return matchers
}

// normalizeFileLinks 把内容中的直链还原为稳定链接；找不到对应文件记录的直链保持原样
func normalizeFileLinks(content string, matchers []directLinkMatcher) (string, bool, error) {
	changed := false
	for _, m := range matchers {
		if !strings.Contains(content, m.prefix) {
			continue
		}
		matches := m.pattern.FindAllStringSubmatch(content, -1)
		hashes := make([]string, 0, len(matches))
		for _, match := range matches {
			if match[2][:4] == match[1] {
				hashes = append(hashes, match[2])
			}
		}
		if len(hashes) == 0 {
			continue
		}
		ids, err := repo.File.FirstIDsByHash(m.providerID, hashes)
		if err != nil {
			return content, false, err
		}
		content = m.pattern.ReplaceAllStringFunc(content, func(s string) string {
			match := m.pattern.FindStringSubmatch(s)
			if id, ok := ids[match[2]]; ok && match[2][:4] == match[1] {
				changed = true
				return FileLink(id)
			}
			return s
		})
	}
	return content, changed, nil
}

// NormalizeFileLinks 把请求内容中的存储直链还原为稳定链接、带本站域名的稳定链接改为相对路径，无需改动时返回 false
func NormalizeFileLinks(data []byte) ([]byte, bool) {
	data, relativized := relativizeOwnFileLinks(data)
	matchers := currentDirectLinkMatchers()
	if len(matchers) == 0 {
		return data, relativized
	}
	content, changed, err := normalizeFileLinks(string(data), matchers)
	if err != nil {
		logrus.Warnf("还原文件直链失败: %v", err)
		return data, relativized
	}
	return []byte(content), changed || relativized
}

// relativizeOwnFileLinks 带本站域名的稳定链接（如后台「复制链接」得到的地址）去掉协议与域名，
// 粘贴进站点图标、封面、正文后换域名也不会失效；其他站点的同名路径不动
func relativizeOwnFileLinks(data []byte) ([]byte, bool) {
	origin := tools.GetBaseUrl()
	if origin == "" || !bytes.Contains(data, []byte(fileLinkPath)) {
		return data, false
	}
	var out bytes.Buffer
	last := 0
	for _, m := range fileLinkPattern.FindAllSubmatchIndex(data, -1) {
		if m[4] < 0 || !strings.EqualFold(string(data[m[4]:m[5]]), origin) {
			continue
		}
		out.Write(data[last:m[4]])
		last = m[5]
	}
	if last == 0 {
		return data, false
	}
	out.Write(data[last:])
	return out.Bytes(), true
}

// normalizeStoredFileLinks 把已保存内容（正文、草稿、封面、头像、历史版本、配置等）中这些存储的直链还原为稳定链接，返回改动的记录数
func normalizeStoredFileLinks(matchers []directLinkMatcher) (int, error) {
	if len(matchers) == 0 {
		return 0, nil
	}
	needles := make([]string, 0, len(matchers))
	for _, m := range matchers {
		needles = append(needles, m.prefix)
	}
	var rewriteErr error
	changed, err := repo.File.RewriteFileLinkColumns(needles, func(value string) (string, bool) {
		next, ok, err := normalizeFileLinks(value, matchers)
		if err != nil {
			rewriteErr = err
		}
		return next, ok
	})
	if err != nil {
		return changed, err
	}
	if rewriteErr != nil {
		return changed, rewriteErr
	}
	// 站点配置（Logo、默认封面等）只处理字符串值
	kvs, err := repo.KV.ListKV("")
	if err != nil {
		return changed, err
	}
	for _, kv := range kvs {
		value, ok := kv.Value["value"].(string)
		if !ok {
			continue
		}
		next, ok, err := normalizeFileLinks(value, matchers)
		if err != nil {
			return changed, err
		}
		if !ok {
			continue
		}
		if err := repo.KV.SetKV(kv.Key, next); err != nil {
			return changed, fmt.Errorf("update config %s: %w", kv.Key, err)
		}
		changed++
	}
	return changed, nil
}
