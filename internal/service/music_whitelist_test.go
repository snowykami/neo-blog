package service

import (
	"context"
	"html"
	"reflect"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

// songComponent 编辑器保存的内容组件：data-props 为 HTML 转义后的 JSON
func songComponent(name, props string) string {
	return `<div data-component="` + name + `" data-props="` + html.EscapeString(props) + `"></div>`
}

func resetArticleSongs() {
	musicArticleSongs.Lock()
	musicArticleSongs.ids, musicArticleSongs.scannedAt = nil, time.Time{}
	musicArticleSongs.Unlock()
}

func TestReferencedSongIDs(t *testing.T) {
	content := "<p>正文</p>" +
		songComponent("neteaseSong", `{"mode":"netease","id":101}`) +
		// 旧数据没有 mode：按网易云处理
		songComponent("neteaseSong", `{"id":102}`) +
		// 自定义音频不是网易云歌曲
		songComponent("neteaseSong", `{"mode":"custom","id":103,"src":"/a.mp3"}`) +
		songComponent("lyricQuote", `{"source":"netease","id":104,"showTranslation":true}`) +
		songComponent("lyricQuote", `{"source":"custom","id":105}`) +
		// 属性顺序不同也能识别
		`<div class="x" data-props="` + html.EscapeString(`{"id":106}`) + `" data-component="neteaseSong"></div>` +
		songComponent("otherCard", `{"id":107}`) +
		songComponent("neteaseSong", `{"id":0}`)
	if got := referencedSongIDs(content); !reflect.DeepEqual(got, []int64{101, 102, 104, 106}) {
		t.Fatalf("ids = %v", got)
	}
}

func TestSongPlayableWhitelist(t *testing.T) {
	author, admin, _, _, _ := setupEditTest(t)
	resetArticleSongs()
	t.Cleanup(resetArticleSongs)
	s := NewMusicService()
	anonymous := context.Background()

	create := func(page bool, private bool, content string) {
		t.Helper()
		var err error
		if page {
			err = repo.GetDB().Create(&model.Page{PageBase: model.PageBase{Title: "p", Slug: "p" + time.Now().Format("150405.000000"), Content: content, IsPrivate: private}}).Error
		} else {
			err = repo.GetDB().Create(&model.Post{PostBase: model.PostBase{Title: "t", Content: content, IsPrivate: private}}).Error
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	create(false, false, songComponent("neteaseSong", `{"id":201}`))
	create(true, false, songComponent("lyricQuote", `{"source":"netease","id":202}`))
	create(false, true, songComponent("neteaseSong", `{"id":203}`))

	// 公开文章与页面引用的歌曲任何人都能播放；私密文章与未引用的不行
	for id, want := range map[int64]bool{201: true, 202: true, 203: false, 204: false} {
		if got := s.SongPlayable(anonymous, id); got != want {
			t.Errorf("anonymous song %d: got %v, want %v", id, got, want)
		}
	}
	// 管理员与编辑可以播放任何歌曲（写文章、预览草稿时试听）
	if !s.SongPlayable(admin, 204) || !s.SongPlayable(author, 204) {
		t.Error("admin and editor should play any song")
	}

	// 新发布的文章：缓存里没有时，距上次扫描超过一段时间就重新扫描，不用等缓存过期
	create(false, false, songComponent("neteaseSong", `{"id":205}`))
	if s.SongPlayable(anonymous, 205) {
		t.Fatal("rescan should be throttled right after a scan")
	}
	musicArticleSongs.Lock()
	musicArticleSongs.scannedAt = time.Now().Add(-musicArticleSongsRescan - time.Second)
	musicArticleSongs.Unlock()
	if !s.SongPlayable(anonymous, 205) {
		t.Fatal("newly published song should be found after rescanning")
	}
}

// 公开的文章或页面变化（repo.TouchCacheTags）后立即作废文章引用的歌曲，不用等重新扫描的间隔
func TestArticleSongsInvalidatedOnContentChange(t *testing.T) {
	setupEditTest(t)
	resetArticleSongs()
	t.Cleanup(resetArticleSongs)
	ListenMusicWhitelistChanges()
	s := NewMusicService()
	anonymous := context.Background()
	if s.SongPlayable(anonymous, 301) {
		t.Fatal("song 301 is not referenced yet")
	}
	if err := repo.GetDB().Create(&model.Post{PostBase: model.PostBase{Title: "t", Content: songComponent("neteaseSong", `{"id":301}`)}}).Error; err != nil {
		t.Fatal(err)
	}
	repo.TouchCacheTags(repo.CacheTagPosts)
	if !s.SongPlayable(anonymous, 301) {
		t.Fatal("published song should be playable right after the content change")
	}
	// 改为私密后同样立即失效
	if err := repo.GetDB().Model(&model.Post{}).Where("1 = 1").Update("is_private", true).Error; err != nil {
		t.Fatal(err)
	}
	repo.TouchCacheTags(repo.CacheTagPosts)
	if s.SongPlayable(anonymous, 301) {
		t.Fatal("private post should no longer whitelist the song")
	}
}

// 换取播放地址不依赖整份歌单：歌单接口出错时，公开文章引用的歌曲仍可播放，其他歌曲照样拒绝
func TestSongURLWithoutPlaylist(t *testing.T) {
	setupEditTest(t)
	resetArticleSongs()
	t.Cleanup(resetArticleSongs)
	srv, calls := fakeNCMServer(t)
	// 歌单不存在：歌单接口返回错误
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "MUSIC_U=abc", "ncm_playlist_id": float64(99), "ncm_song_level": ""})
	s := NewMusicService()
	ctx := context.Background()
	if _, svcerr := s.GetPlaylist(ctx); svcerr == nil {
		t.Fatal("playlist should fail")
	}
	if err := repo.GetDB().Create(&model.Post{PostBase: model.PostBase{Title: "t", Content: songComponent("neteaseSong", `{"id":1}`)}}).Error; err != nil {
		t.Fatal(err)
	}
	if songURL, svcerr := s.GetSongURL(ctx, 1, "higher"); svcerr != nil || songURL == "" {
		t.Fatalf("referenced song url = %q %v", songURL, svcerr)
	}
	if _, svcerr := s.GetSongURL(ctx, 12345, ""); svcerr == nil || svcerr.Message != "music_song_not_found" {
		t.Fatalf("unreferenced song = %v", svcerr)
	}
	if calls["/song/url/v1"].Load() > 1 {
		t.Fatalf("song url calls = %d", calls["/song/url/v1"].Load())
	}
	// 网易云未配置时不提供
	setMusicKV(t, map[string]any{"ncm_api_base_url": ""})
	if _, svcerr := s.GetSongURL(ctx, 1, ""); svcerr == nil || svcerr.Message != "ncm_not_configured" {
		t.Fatalf("not configured = %v", svcerr)
	}
}
