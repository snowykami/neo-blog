package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/errs"
	"golang.org/x/sync/singleflight"
)

// GitHub 仓库信息：供文章内的仓库卡展示，只请求公开的仓库接口，不携带凭据
// 未认证的 GitHub API 每小时仅 60 次，因此按仓库缓存，请求失败（如触发限流）时返回过期的旧数据

const (
	githubRepoTTL         = time.Hour        // 仓库信息缓存时间
	githubNotFoundTTL     = 10 * time.Minute // 不存在的仓库缓存时间，避免反复请求
	githubRequestTimeout  = 10 * time.Second
	githubRepoCacheMaxLen = 500
)

// githubAPIBaseURL GitHub API 地址（测试中替换为本地服务）
var githubAPIBaseURL = "https://api.github.com"

var (
	// GitHub 用户名：字母数字与连字符，最长 39；仓库名：字母数字、点、下划线与连字符
	githubOwnerPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)
	githubRepoPattern  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)
)

type githubRepoEntry struct {
	repo      *dto.GithubRepoDto // 为 nil 表示仓库不存在
	fetchedAt time.Time
}

var githubRepoCache = struct {
	sync.Mutex
	entries map[string]githubRepoEntry
}{entries: map[string]githubRepoEntry{}}

// 同一仓库同时只请求一次
var githubFetchGroup singleflight.Group

type GithubService struct{}

func NewGithubService() *GithubService {
	return &GithubService{}
}

// ValidGithubRepoName 校验仓库所有者与仓库名，防止拼接出其他 API 路径
func ValidGithubRepoName(owner, repo string) bool {
	return githubOwnerPattern.MatchString(owner) && githubRepoPattern.MatchString(repo) && repo != "." && repo != ".."
}

// GetRepo 获取仓库公开信息，带缓存
func (s *GithubService) GetRepo(ctx context.Context, owner, repo string) (*dto.GithubRepoDto, *errs.ServiceError) {
	if !ValidGithubRepoName(owner, repo) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	key := strings.ToLower(owner + "/" + repo)

	githubRepoCache.Lock()
	cached, ok := githubRepoCache.entries[key]
	githubRepoCache.Unlock()
	if ok && time.Since(cached.fetchedAt) < githubEntryTTL(cached) {
		return githubRepoResult(cached.repo)
	}

	// 请求不随单个访客的请求取消，结果供所有等待者使用
	value, err, _ := githubFetchGroup.Do(key, func() (any, error) {
		return fetchGithubRepo(context.WithoutCancel(ctx), owner, repo)
	})
	if err != nil {
		logrus.Warnf("github request failed: %v", err)
		// 请求失败时返回过期的旧数据
		if ok {
			return githubRepoResult(cached.repo)
		}
		return nil, errs.New(http.StatusBadGateway, "github_request_failed", err)
	}
	entry := githubRepoEntry{repo: value.(*dto.GithubRepoDto), fetchedAt: time.Now()}
	storeGithubRepo(key, entry)
	return githubRepoResult(entry.repo)
}

func githubEntryTTL(entry githubRepoEntry) time.Duration {
	if entry.repo == nil {
		return githubNotFoundTTL
	}
	return githubRepoTTL
}

func githubRepoResult(repo *dto.GithubRepoDto) (*dto.GithubRepoDto, *errs.ServiceError) {
	if repo == nil {
		return nil, errs.NewNotFound("github_repo_not_found")
	}
	return repo, nil
}

// storeGithubRepo 写入缓存；超出上限时先清理过期条目，仍超出则任意淘汰一条
func storeGithubRepo(key string, entry githubRepoEntry) {
	githubRepoCache.Lock()
	defer githubRepoCache.Unlock()
	entries := githubRepoCache.entries
	if _, exists := entries[key]; !exists && len(entries) >= githubRepoCacheMaxLen {
		for k, e := range entries {
			if time.Since(e.fetchedAt) >= githubEntryTTL(e) {
				delete(entries, k)
			}
		}
		for k := range entries {
			if len(entries) < githubRepoCacheMaxLen {
				break
			}
			delete(entries, k)
		}
	}
	entries[key] = entry
}

// fetchGithubRepo 请求 GitHub 仓库接口；仓库不存在时返回 nil
func fetchGithubRepo(ctx context.Context, owner, repo string) (*dto.GithubRepoDto, error) {
	ctx, cancel := context.WithTimeout(ctx, githubRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/repos/%s/%s", githubAPIBaseURL, owner, repo), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "neo-blog")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	var raw struct {
		FullName    string   `json:"full_name"`
		Name        string   `json:"name"`
		Description string   `json:"description"`
		HTMLURL     string   `json:"html_url"`
		Language    string   `json:"language"`
		Topics      []string `json:"topics"`
		Stars       int      `json:"stargazers_count"`
		Forks       int      `json:"forks_count"`
		Archived    bool     `json:"archived"`
		Private     bool     `json:"private"`
		Owner       struct {
			Login     string `json:"login"`
			AvatarURL string `json:"avatar_url"`
		} `json:"owner"`
		License *struct {
			SpdxID string `json:"spdx_id"`
			Name   string `json:"name"`
		} `json:"license"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("invalid response: %w", err)
	}
	// 未携带凭据时不会返回私有仓库，这里再保险一次
	if raw.Private || raw.FullName == "" {
		return nil, nil
	}
	result := &dto.GithubRepoDto{
		FullName:    raw.FullName,
		Owner:       raw.Owner.Login,
		Name:        raw.Name,
		Description: raw.Description,
		HTMLURL:     raw.HTMLURL,
		OwnerAvatar: raw.Owner.AvatarURL,
		Language:    raw.Language,
		Topics:      raw.Topics,
		Stars:       raw.Stars,
		Forks:       raw.Forks,
		Archived:    raw.Archived,
	}
	if result.Topics == nil {
		result.Topics = []string{}
	}
	if raw.License != nil && raw.License.SpdxID != "" && raw.License.SpdxID != "NOASSERTION" {
		result.License = raw.License.SpdxID
	}
	return result, nil
}
