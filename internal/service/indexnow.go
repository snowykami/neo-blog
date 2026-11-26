package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const (
	indexNowTimeout         = 5 * time.Second
	indexNowCoalesceWindow  = 50 * time.Millisecond
	indexNowMaxURLsPerBatch = 10000
	defaultIndexNowEndpoint = "https://api.indexnow.org/indexnow"
)

var defaultIndexNowHTTPClient = &http.Client{
	Timeout: indexNowTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// indexNowState 统一受互斥锁保护，确保多协程合并去重队列及 go test -race 并发安全
var indexNowState struct {
	mu             sync.Mutex
	endpoint       string
	client         *http.Client
	allowLocalHost bool
	enabledInTests bool
	coalesceDelay  time.Duration
	pending        []string
	pendingSet     map[string]struct{}
	draining       bool
	drainDone      chan struct{}
}

type indexNowPayload struct {
	Host        string   `json:"host"`
	Key         string   `json:"key"`
	KeyLocation string   `json:"keyLocation"`
	URLList     []string `json:"urlList"`
}

func currentIndexNowRuntime() (endpoint string, client *http.Client, allowLocalHost bool) {
	indexNowState.mu.Lock()
	defer indexNowState.mu.Unlock()
	endpoint = indexNowState.endpoint
	if endpoint == "" {
		endpoint = defaultIndexNowEndpoint
	}
	client = indexNowState.client
	if client == nil {
		client = defaultIndexNowHTTPClient
	}
	return endpoint, client, indexNowState.allowLocalHost
}

func isPublicIndexNowHost(hostname string) bool {
	h := strings.ToLower(strings.TrimSpace(hostname))
	if h == "" || h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".internal") {
		return false
	}
	if ip := net.ParseIP(h); ip != nil {
		return !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsUnspecified() && !ip.IsLinkLocalUnicast()
	}
	return strings.Contains(h, ".")
}

func postCanonicalPath(slug *string, id uint) string {
	if s := strings.TrimSpace(utils.Deref(slug)); s != "" {
		return "/p/" + url.PathEscape(s)
	}
	if id == 0 {
		return ""
	}
	return fmt.Sprintf("/p/%d", id)
}

func pageCanonicalPath(slug string, id uint) string {
	if s := strings.TrimSpace(slug); s != "" {
		return "/page/" + url.PathEscape(s)
	}
	if id == 0 {
		return ""
	}
	return fmt.Sprintf("/page/%d", id)
}

// NotifyIndexNowPost 异步向 IndexNow 提交公开文章及相关列表路径，不阻塞业务请求
func NotifyIndexNowPost(post *model.Post, extraPaths ...string) {
	if post == nil || !post.IsPublic() {
		return
	}
	if !tools.GetIndexNowConfig().Enabled() {
		return
	}
	paths := make([]string, 0, 3+len(extraPaths))
	if p := postCanonicalPath(post.Slug, post.ID); p != "" {
		paths = append(paths, p)
	}
	paths = append(paths, "/", "/a")
	paths = append(paths, extraPaths...)
	SubmitIndexNowPaths(paths)
}

// NotifyIndexNowPage 异步向 IndexNow 提交公开独立页面路径，不阻塞业务请求
func NotifyIndexNowPage(page *model.Page, extraPaths ...string) {
	if page == nil || page.IsPrivate || model.NormalizePageKind(page.Kind) == model.PageKindLink {
		return
	}
	if !tools.GetIndexNowConfig().Enabled() {
		return
	}
	paths := make([]string, 0, 1+len(extraPaths))
	if p := pageCanonicalPath(page.Slug, page.ID); p != "" {
		paths = append(paths, p)
	}
	paths = append(paths, extraPaths...)
	SubmitIndexNowPaths(paths)
}

// SubmitIndexNowPaths 将待通知的站内路径放入去重合并队列并由后台单协程批量提交（避免批量更新触发并发请求风暴或丢弃条目）
func SubmitIndexNowPaths(paths []string) {
	if len(paths) == 0 || !tools.GetIndexNowConfig().Enabled() {
		return
	}

	indexNowState.mu.Lock()
	// 单测环境下默认静默跳过异步外网推送，避免宿主机配置了 INDEXNOW_KEY 时各业务单测向外网发请求或与 t.Setenv 竞态
	if testing.Testing() && !indexNowState.enabledInTests {
		indexNowState.mu.Unlock()
		return
	}
	if indexNowState.pendingSet == nil {
		indexNowState.pendingSet = make(map[string]struct{}, len(paths))
	}
	added := false
	for _, raw := range paths {
		clean := strings.TrimSpace(raw)
		if clean == "" {
			continue
		}
		if !strings.HasPrefix(clean, "/") {
			clean = "/" + clean
		}
		if _, exists := indexNowState.pendingSet[clean]; exists {
			continue
		}
		if len(indexNowState.pending) >= indexNowMaxURLsPerBatch*2 {
			break
		}
		indexNowState.pendingSet[clean] = struct{}{}
		indexNowState.pending = append(indexNowState.pending, clean)
		added = true
	}
	if !added || indexNowState.draining {
		indexNowState.mu.Unlock()
		return
	}
	indexNowState.draining = true
	done := make(chan struct{})
	indexNowState.drainDone = done
	delay := indexNowState.coalesceDelay
	if delay == 0 && !testing.Testing() {
		delay = indexNowCoalesceWindow
	}
	indexNowState.mu.Unlock()

	go drainIndexNowQueue(delay, done)
}

func drainIndexNowQueue(coalesceDelay time.Duration, done chan struct{}) {
	defer close(done)
	if coalesceDelay > 0 {
		time.Sleep(coalesceDelay)
	}
	for {
		indexNowState.mu.Lock()
		if len(indexNowState.pending) == 0 {
			indexNowState.draining = false
			indexNowState.drainDone = nil
			indexNowState.mu.Unlock()
			return
		}
		n := min(len(indexNowState.pending), indexNowMaxURLsPerBatch)
		batch := append([]string(nil), indexNowState.pending[:n]...)
		indexNowState.pending = indexNowState.pending[n:]
		for _, item := range batch {
			delete(indexNowState.pendingSet, item)
		}
		indexNowState.mu.Unlock()

		ctx, cancel := context.WithTimeout(context.Background(), indexNowTimeout)
		err := submitIndexNowPathsSync(ctx, batch)
		cancel()
		if err != nil {
			logrus.Warnf("indexnow submit failed: %v", err)
		}
	}
}

func submitIndexNowPathsSync(ctx context.Context, paths []string) error {
	cfg := tools.GetIndexNowConfig()
	if !cfg.Enabled() {
		return nil
	}
	rawBase := strings.TrimRight(strings.TrimSpace(tools.GetBaseUrl()), "/")
	if rawBase == "" {
		return nil
	}
	parsedBase, err := url.Parse(rawBase)
	if err != nil || (parsedBase.Scheme != "https" && parsedBase.Scheme != "http") || parsedBase.Host == "" {
		return nil
	}
	endpoint, client, allowLocalHost := currentIndexNowRuntime()
	if !allowLocalHost && !isPublicIndexNowHost(parsedBase.Hostname()) {
		return nil
	}
	origin := parsedBase.Scheme + "://" + parsedBase.Host
	basePrefix := origin + strings.TrimRight(parsedBase.EscapedPath(), "/")

	seen := make(map[string]struct{}, len(paths))
	urlList := make([]string, 0, len(paths))
	for _, p := range paths {
		clean := strings.TrimSpace(p)
		if clean == "" {
			continue
		}
		if !strings.HasPrefix(clean, "/") {
			clean = "/" + clean
		}
		fullURL := basePrefix + clean
		if _, exists := seen[fullURL]; exists {
			continue
		}
		seen[fullURL] = struct{}{}
		urlList = append(urlList, fullURL)
		if len(urlList) >= indexNowMaxURLsPerBatch {
			break
		}
	}
	if len(urlList) == 0 {
		return nil
	}

	payload := indexNowPayload{
		Host:        parsedBase.Hostname(),
		Key:         cfg.Key,
		KeyLocation: fmt.Sprintf("%s/%s.txt", basePrefix, cfg.Key),
		URLList:     urlList,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("User-Agent", "neo-blog/indexnow")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	// IndexNow 规范：200 OK 与 202 Accepted 均代表提交成功
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	return nil
}
