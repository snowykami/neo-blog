package service

import (
	"context"
	"encoding/json"
	"html"
	"regexp"
	"slices"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"golang.org/x/sync/singleflight"
)

// 站内播放的白名单（见 docs/music-player-spec.md 7.1a）：播放地址用站长的网易云账号换取，只对以下歌曲开放，避免后端被当成任意歌曲的播放代理：
//  1. 登录的管理员与编辑：任何歌曲（写文章、预览草稿时要能试听，不能把自己拦住）
//  2. 博客歌单中的歌曲
//  3. 公开的文章与页面中引用的网易云歌曲（网易云单曲卡、网易云歌词摘录）；私密内容与草稿不算
// 歌词标注（消耗大模型额度）只按 2、3 开放，不随登录身份放开
//
// 公开内容引用的歌曲缓存在进程内：公开的文章或页面变化（发布、私密化、删除、正文变化，均经 repo.TouchCacheTags）时本实例立即作废，
// 并通知其他实例作废（见 ListenMusicWhitelistChanges）；此外最多 musicArticleSongsTTL 重新扫描一次

const (
	// 文章引用的歌曲缓存多久重新扫描一次
	musicArticleSongsTTL = 10 * time.Minute
	// 查不到某首歌时，距上次扫描超过这么久就立即重新扫描（新发布的文章不用等缓存过期）
	musicArticleSongsRescan = 30 * time.Second
	// musicArticleSongsChannel 公开内容变化后通知其他实例作废文章引用的歌曲
	musicArticleSongsChannel = "music_article_songs_changed"
)

var (
	musicArticleSongs struct {
		sync.Mutex
		ids       map[int64]bool
		scannedAt time.Time
		// generation 每次作废加一：扫描开始后被作废的，结果不写回缓存（可能漏掉期间的变化）
		generation uint64
	}
	musicArticleSongsGroup  singleflight.Group
	musicArticleSongsListen sync.Once
	// 内容组件的开始标签与其中的属性（data-props 为 HTML 转义后的 JSON，不含原样的双引号）
	contentComponentTagRe   = regexp.MustCompile(`<[a-zA-Z][^>]*\bdata-component="(neteaseSong|lyricQuote)"[^>]*>`)
	contentComponentPropsRe = regexp.MustCompile(`\bdata-props="([^"]*)"`)
)

// SongPlayable 当前访客能否在站内播放这首歌（白名单见文件开头）
func (s *MusicService) SongPlayable(ctx context.Context, id int64) bool {
	if user, ok := ctxutils.GetCurrentUser(ctx); ok && user.GreaterThanEditor() {
		return true
	}
	return s.songPublic(ctx, id)
}

// songPublic 不论登录身份都开放的歌曲：博客歌单与公开内容中引用的歌曲
func (s *MusicService) songPublic(ctx context.Context, id int64) bool {
	if tracks, svcerr := s.GetPlaylist(ctx); svcerr == nil && containsTrack(tracks, id) {
		return true
	}
	return articleSongReferenced(id)
}

// articleSongReferenced 公开的文章或页面中是否引用了这首歌
func articleSongReferenced(id int64) bool {
	musicArticleSongs.Lock()
	ids, age := musicArticleSongs.ids, time.Since(musicArticleSongs.scannedAt)
	musicArticleSongs.Unlock()
	if ids != nil && (ids[id] || age < musicArticleSongsRescan) && age < musicArticleSongsTTL {
		return ids[id]
	}
	value, _, _ := musicArticleSongsGroup.Do("scan", func() (any, error) {
		return scanArticleSongs(), nil
	})
	fresh, _ := value.(map[int64]bool)
	return fresh[id]
}

// invalidateArticleSongs 作废本实例缓存的文章引用的歌曲，下次查询时重新扫描
func invalidateArticleSongs() {
	musicArticleSongs.Lock()
	musicArticleSongs.ids, musicArticleSongs.scannedAt = nil, time.Time{}
	musicArticleSongs.generation++
	musicArticleSongs.Unlock()
}

// ListenMusicWhitelistChanges 启动时调用：本实例的文章或页面数据变化（repo.TouchCacheTags 的 posts / pages 标签）时作废缓存并通知其他实例；
// 收到其他实例的通知时作废本实例的缓存（与 Redis 断线重连后收到的空消息同样处理）。可重复调用
func ListenMusicWhitelistChanges() {
	musicArticleSongsListen.Do(func() {
		repo.OnCacheTagsTouched(func(tags []string) {
			if slices.Contains(tags, repo.CacheTagPosts) || slices.Contains(tags, repo.CacheTagPages) {
				invalidateArticleSongs()
				sharedstate.Notify(musicArticleSongsChannel, "")
			}
		})
		sharedstate.OnNotify(musicArticleSongsChannel, func(string) { invalidateArticleSongs() })
	})
}

// scanArticleSongs 重新扫描公开文章与页面中引用的歌曲；读取失败时沿用上次的结果
func scanArticleSongs() map[int64]bool {
	musicArticleSongs.Lock()
	generation := musicArticleSongs.generation
	musicArticleSongs.Unlock()
	ids := map[int64]bool{}
	for _, list := range []func() ([]string, error){repo.Post.ListPublicContentsWithComponents, repo.Page.ListPublicContentsWithComponents} {
		contents, err := list()
		if err != nil {
			logrus.Warnf("scan songs referenced by articles failed: %v", err)
			musicArticleSongs.Lock()
			defer musicArticleSongs.Unlock()
			return musicArticleSongs.ids
		}
		for _, content := range contents {
			for _, id := range referencedSongIDs(content) {
				ids[id] = true
			}
		}
	}
	musicArticleSongs.Lock()
	if musicArticleSongs.generation == generation {
		musicArticleSongs.ids, musicArticleSongs.scannedAt = ids, time.Now()
	}
	musicArticleSongs.Unlock()
	return ids
}

// referencedSongIDs 正文中网易云单曲卡（mode 为 netease 或旧数据没有 mode）与网易云歌词摘录（source 为 netease）引用的歌曲 id
func referencedSongIDs(content string) []int64 {
	var ids []int64
	for _, tag := range contentComponentTagRe.FindAllStringSubmatch(content, -1) {
		match := contentComponentPropsRe.FindStringSubmatch(tag[0])
		if match == nil {
			continue
		}
		var props struct {
			Mode   string `json:"mode"`
			Source string `json:"source"`
			ID     int64  `json:"id"`
		}
		if json.Unmarshal([]byte(html.UnescapeString(match[1])), &props) != nil || props.ID <= 0 {
			continue
		}
		netease := (tag[1] == "neteaseSong" && (props.Mode == "" || props.Mode == "netease")) ||
			(tag[1] == "lyricQuote" && (props.Source == "" || props.Source == "netease"))
		if netease {
			ids = append(ids, props.ID)
		}
	}
	return ids
}
