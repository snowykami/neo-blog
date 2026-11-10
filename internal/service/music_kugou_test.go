package service

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

// encryptKRC decryptKRC 的逆运算（测试用）
func encryptKRC(text string) []byte {
	var compressed bytes.Buffer
	w := zlib.NewWriter(&compressed)
	_, _ = w.Write([]byte(text))
	_ = w.Close()
	out := []byte("krc1")
	for i, b := range compressed.Bytes() {
		out = append(out, b^krcKey[i%len(krcKey)])
	}
	return out
}

const testKRC = "[ti:歌]\n[ar:歌手]\n" +
	"[language:%s]\n" +
	"[1000,1200]<0,500,0>私<500,400,0>だ<900,300,0>け\n" +
	"[3000,800]<0,400,0>A<400,400,0>B\n"

func testKRCText() string {
	language, _ := json.Marshal(map[string]any{"content": []map[string]any{
		{"type": 1, "lyricContent": [][]string{{"只有我"}, {""}}},
		{"type": 0, "lyricContent": [][]string{{"wa ta shi ", "da ", "ke "}, {"a"}}},
	}})
	return strings.Replace(testKRC, "%s", base64.StdEncoding.EncodeToString(language), 1)
}

func TestKRCToQRC(t *testing.T) {
	text, err := decryptKRC(encryptKRC(testKRCText()))
	if err != nil {
		t.Fatal(err)
	}
	got := krcToQRC(text)
	if got.Format != "qrc" || got.Lyric != "[1000,1200]私(1000,500)だ(1500,400)け(1900,300)\n[3000,800]A(3000,400)B(3400,400)" {
		t.Fatalf("lyric = %q", got.Lyric)
	}
	// 空翻译的行不输出；音节数与字数不一致的行不要音译
	if got.Translation != "[00:01.00]只有我" {
		t.Fatalf("translation = %q", got.Translation)
	}
	if got.Romanization != "[1000,1200]wa ta shi (1000,500)da (1500,400)ke (1900,300)" {
		t.Fatalf("romanization = %q", got.Romanization)
	}
	if _, err := decryptKRC([]byte("nope")); err == nil {
		t.Fatal("bad magic should fail")
	}
}

func TestFetchKugouLyric(t *testing.T) {
	var keywords []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/search":
			keywords = append(keywords, r.URL.Query().Get("keyword"))
			_, _ = w.Write([]byte(`{"status":1,"data":{"info":[
				{"hash":"live","songname":"歌 (演唱会)","singername":"歌手","duration":180},
				{"hash":"abc","songname":"歌","singername":"歌手、合唱","album_name":"专辑","duration":201}
			]}}`))
		case "/lyric-search":
			if r.URL.Query().Get("hash") != "ABC" || r.URL.Query().Get("timelength") != "201" {
				t.Errorf("lyric search = %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"candidates":[{"id":"42","accesskey":"key","krctype":1,"contenttype":0}]}`))
		case "/download":
			if r.URL.Query().Get("fmt") != "krc" || r.URL.Query().Get("accesskey") != "key" {
				t.Errorf("download = %s", r.URL.RawQuery)
			}
			data, _ := json.Marshal(map[string]any{"content": base64.StdEncoding.EncodeToString(encryptKRC(testKRCText()))})
			_, _ = w.Write(data)
		}
	}))
	t.Cleanup(server.Close)
	search, lyricSearch, download := musicKugouSearchURL, musicKugouLyricSearchURL, musicKugouDownloadURL
	musicKugouSearchURL, musicKugouLyricSearchURL, musicKugouDownloadURL = server.URL+"/search", server.URL+"/lyric-search", server.URL+"/download"
	t.Cleanup(func() {
		musicKugouSearchURL, musicKugouLyricSearchURL, musicKugouDownloadURL = search, lyricSearch, download
	})

	lyric, degraded, err := fetchKugouLyric(context.Background(), &dto.MusicSongDto{Name: "歌", Artists: []string{"歌手", "合唱"}, Duration: 201000})
	if err != nil || degraded {
		t.Fatal(err, degraded)
	}
	// 「歌名 + 歌手」与「歌名」两个关键词都搜了；演唱会版被排除
	if len(keywords) != 2 || lyric.Hash != "ABC" || lyric.Format != "qrc" || !strings.HasPrefix(lyric.Lyric, "[1000,1200]私") {
		t.Fatalf("keywords = %q, lyric = %+v", keywords, lyric)
	}
}

// 真实请求酷狗（默认跳过）：NEO_LIVE_MUSIC=1 go test -run TestKugouLive ./internal/service/
func TestKugouLive(t *testing.T) {
	if os.Getenv("NEO_LIVE_MUSIC") == "" {
		t.Skip("set NEO_LIVE_MUSIC=1 to run against Kugou")
	}
	for _, song := range []*dto.MusicSongDto{
		{Name: "紫荆花盛开", Artists: []string{"李荣浩", "梁咏琪"}, Duration: 210000},
		{Name: "One Last Kiss", Artists: []string{"宇多田ヒカル"}, Duration: 252000},
	} {
		lyric, degraded, err := fetchKugouLyric(context.Background(), song)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Count(lyric.Lyric, "\n") + 1
		t.Logf("%s: hash=%s format=%s lines=%d translation=%t romanization=%t degraded=%t", song.Name, lyric.Hash, lyric.Format, lines,
			lyric.Translation != "", lyric.Romanization != "", degraded)
		if lyric.Lyric == "" {
			t.Fatalf("%s: no lyric", song.Name)
		}
	}
}

// TestKugouLyricRevalidate 命中的酷狗歌词缓存同样按 lyricRevalidateInterval 复核
func TestKugouLyricRevalidate(t *testing.T) {
	setupTTMLDB(t)
	var body atomic.Value
	body.Store(testKRCText())
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/search":
			_, _ = w.Write([]byte(`{"status":1,"data":{"info":[{"hash":"abc","songname":"歌","singername":"歌手","album_name":"专辑","duration":201}]}}`))
		case "/lyric-search":
			_, _ = w.Write([]byte(`{"candidates":[{"id":"42","accesskey":"key","krctype":1,"contenttype":0}]}`))
		default:
			calls.Add(1)
			data, _ := json.Marshal(map[string]any{"content": base64.StdEncoding.EncodeToString(encryptKRC(body.Load().(string)))})
			_, _ = w.Write(data)
		}
	}))
	t.Cleanup(server.Close)
	search, lyricSearch, download := musicKugouSearchURL, musicKugouLyricSearchURL, musicKugouDownloadURL
	musicKugouSearchURL, musicKugouLyricSearchURL, musicKugouDownloadURL = server.URL+"/search", server.URL+"/lyric-search", server.URL+"/download"
	t.Cleanup(func() {
		musicKugouSearchURL, musicKugouLyricSearchURL, musicKugouDownloadURL = search, lyricSearch, download
	})
	resetLyricSharedState(t)
	musicKugouCache.Clear()
	musicSongCache.Put(uint(302), jsonBytes(t, dto.MusicSongDto{ID: 302, Name: "歌", Artists: []string{"歌手"}, Album: "专辑", Duration: 201000}), musicSongTTL)
	t.Cleanup(func() { musicSongCache.Remove(uint(302)) })
	s := NewMusicService()
	ctx := context.Background()

	first, svcerr := s.GetKugouLyric(ctx, 302)
	if svcerr != nil || !strings.HasPrefix(first.Lyric, "[1000,1200]私") {
		t.Fatalf("first = %+v, %v", first, svcerr)
	}
	if cached, ok := loadKugouCacheEntry(302); !ok || cached.Hash == "" || cached.CheckedAt == 0 {
		t.Fatalf("cache entry should carry digest and check time: %+v", cached)
	}
	// 上游只改了歌词时间轴，但未到复核时间：仍用缓存
	body.Store(strings.Replace(testKRCText(), "[1000,1200]", "[1300,1200]", 1))
	if lyric, svcerr := s.GetKugouLyric(ctx, 302); svcerr != nil || lyric.Lyric != first.Lyric {
		t.Fatalf("should use cache within interval: %+v, %v", lyric, svcerr)
	}
	// 到期复核：先返回缓存（不等上游），后台复核发现摘要不同后换成新时间轴
	cached, _ := loadKugouCacheEntry(302)
	cached.CheckedAt = time.Now().Add(-2 * lyricRevalidateInterval).Unix()
	musicKugouCache.Put(uint(302), jsonBytes(t, cached), musicKugouHitTTL)
	if lyric, svcerr := s.GetKugouLyric(ctx, 302); svcerr != nil || lyric.Lyric != first.Lyric {
		t.Fatalf("stale cache should be returned immediately: %+v, %v", lyric, svcerr)
	}
	waitLyricCondition(t, "kugou background revalidation", func() bool {
		entry, ok := loadKugouCacheEntry(302)
		return ok && strings.HasPrefix(entry.Lyric.Lyric, "[1300,1200]私")
	})
	// 管理员「重新获取歌词」立即复核（不等间隔）
	body.Store(strings.Replace(testKRCText(), "[1000,1200]", "[1500,1200]", 1))
	refreshCtx := withLyricRefresh(ctx, "kugou", 302, true)
	if lyric, svcerr := s.GetKugouLyric(refreshCtx, 302); svcerr != nil || !strings.HasPrefix(lyric.Lyric, "[1500,1200]私") {
		t.Fatalf("refreshed = %+v, %v", lyric, svcerr)
	}
}
