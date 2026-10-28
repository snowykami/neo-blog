package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

func TestQRCRoundTrip(t *testing.T) {
	text := "[0,1000]你(0,500)好(500,500)\n[1000,800]hello (1000,400)world(1400,400)"
	cipher := encryptQRC(text)
	if !isHexString(cipher) || len(cipher)%16 != 0 {
		t.Fatalf("ciphertext should be hex blocks, got %q", cipher)
	}
	got, err := decryptQRC(cipher)
	if err != nil || got != text {
		t.Fatalf("decrypt = %q, %v", got, err)
	}
	if _, err := decryptQRC("ABC"); err == nil {
		t.Fatal("odd-length hex should fail")
	}
	if _, err := decryptQRC(strings.Repeat("00", 8)); err == nil {
		t.Fatal("garbage should not inflate")
	}
}

func TestUnwrapQRC(t *testing.T) {
	xml := `<?xml version="1.0" encoding="utf-8"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[0,500]&quot;Hi&quot; &amp; "bye"(0,500)
"/></LyricInfo></QrcInfos>`
	if got := unwrapQRC(xml); got != "[0,500]\"Hi\" & \"bye\"(0,500)\n" {
		t.Fatalf("unwrap = %q", got)
	}
	if got := unwrapQRC("[00:01.00]plain"); got != "[00:01.00]plain" {
		t.Fatalf("plain text should be returned as is, got %q", got)
	}
}

func TestScoreLyricCandidate(t *testing.T) {
	query := lyricQuery{Title: "One Last Kiss", Artists: []string{"宇多田ヒカル"}, Album: "One Last Kiss", Duration: 252}
	cases := []struct {
		name      string
		candidate lyricCandidate
		want      int
		ok        bool
	}{
		{"歌名包含、歌手包含、专辑相同、时长接近", lyricCandidate{Title: "One Last Kiss (最后一吻)", Artists: []string{"宇多田光 (宇多田ヒカル)"}, Album: "One Last Kiss", Duration: 252}, 4 + 2 + 2 + 3, true},
		{"歌名相同、歌手相同", lyricCandidate{Title: "one last kiss", Artists: []string{"宇多田ヒカル"}, Duration: 250}, 10 + 5 + 3, true},
		{"翻唱：歌手不同", lyricCandidate{Title: "One Last Kiss", Artists: []string{"瞳りょこ"}, Duration: 252}, 0, false},
		{"时长相差超过 20 秒", lyricCandidate{Title: "One Last Kiss", Artists: []string{"宇多田ヒカル"}, Duration: 300}, 0, false},
		{"歌名只有一小部分相同", lyricCandidate{Title: "One Last Kiss Medley Long Version Extended Mix", Artists: []string{"宇多田ヒカル"}}, 0, false},
		{"多位歌手以分隔符连接", lyricCandidate{Title: "One Last Kiss", Artists: []string{"A/宇多田ヒカル"}}, 10 + 5, true},
	}
	for _, tc := range cases {
		got, ok := scoreLyricCandidate(tc.candidate, query)
		if ok != tc.ok || got != tc.want {
			t.Errorf("%s: score = %d, %v; want %d, %v", tc.name, got, ok, tc.want, tc.ok)
		}
	}

	best := bestLyricCandidate([]lyricCandidate{
		{MID: "cover", Title: "One Last Kiss", Artists: []string{"瞳りょこ"}},
		{MID: "contained", Title: "One Last Kiss (Live)", Artists: []string{"宇多田ヒカル"}},
		{MID: "exact", Title: "One Last Kiss", Artists: []string{"宇多田ヒカル"}, Duration: 252},
	}, query)
	if best == nil || best.MID != "exact" {
		t.Fatalf("best = %+v", best)
	}
	if bestLyricCandidate([]lyricCandidate{{MID: "x", Title: "别的歌", Artists: []string{"宇多田ヒカル"}}}, query) != nil {
		t.Fatal("unrelated titles should not match")
	}
}

func TestFetchQQLyric(t *testing.T) {
	qrc := `<?xml version="1.0"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[ti:歌]
[1000,1000]你(1000,500)好(1500,500)
"/></LyricInfo></QrcInfos>`
	var searched sync.Map
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/amll/") || r.URL.Path == "/smartbox" {
			http.NotFound(w, r)
			return
		}
		switch r.URL.Path {
		case "/client/musicu.fcg":
			_, _ = w.Write([]byte(`{"code":0,"req":{"code":0,"data":{"session":{"uid":"u1","sid":"s1"}}}}`))
			return
		case "/client/musics.fcg":
			var search struct {
				Req struct {
					Param struct {
						Query string `json:"query"`
					} `json:"param"`
				} `json:"req"`
			}
			_ = json.NewDecoder(r.Body).Decode(&search)
			searched.Store(search.Req.Param.Query, true)
			_, _ = w.Write([]byte(`{"code":0,"req":{"code":0,"data":{"body":{"song":{"list":[
				{"mid":"cover","title":"歌","singer":[{"title":"别人"}],"interval":200},
				{"mid":"mid1","title":"歌","singer":[{"title":"歌手"}],"album":{"title":"专辑"},"interval":201}
			]}}}}}`))
			return
		}
		var body struct {
			Req struct {
				Param struct {
					SongMID string `json:"songMID"`
				} `json:"param"`
			} `json:"req"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Req.Param.SongMID != "mid1" {
			t.Errorf("lyric requested for %q", body.Req.Param.SongMID)
		}
		data, _ := json.Marshal(map[string]any{"code": 0, "req": map[string]any{"code": 0, "data": map[string]any{
			"lyric": encryptQRC(qrc),
			"trans": base64.StdEncoding.EncodeToString([]byte("[00:01.00]你好呀")),
			"roma":  "",
		}}})
		_, _ = w.Write(data)
	}))
	t.Cleanup(server.Close)
	stubQQEndpoints(t, server.URL)
	// 预热 TTML 的请求也指向本地，避免访问外网
	setupTTMLTest(t, "", server.URL+"/amll")

	lyric, degraded, err := fetchQQLyric(context.Background(), &dto.MusicSongDto{Name: "歌", Artists: []string{"歌手"}, Album: "专辑", Duration: 200500})
	if err != nil || degraded {
		t.Fatal(err, degraded)
	}
	if _, ok := searched.Load("歌 歌手"); !ok {
		t.Error("first round should search title + artists")
	}
	if lyric.SongMID != "mid1" || lyric.Format != "qrc" || lyric.Translation != "[00:01.00]你好呀" || lyric.Romanization != "" {
		t.Fatalf("lyric = %+v", lyric)
	}
	if lyric.Lyric != "[ti:歌]\n[1000,1000]你(1000,500)好(1500,500)" {
		t.Fatalf("lyric body = %q", lyric.Lyric)
	}

	// 没有匹配的歌曲：空结果，不是错误
	lyric, _, err = fetchQQLyric(context.Background(), &dto.MusicSongDto{Name: "另一首", Artists: []string{"歌手"}})
	if err != nil || lyric.SongMID != "" || lyric.Lyric != "" {
		t.Fatalf("no match = %+v, %v", lyric, err)
	}
}

// stubQQEndpoints 把 QQ 音乐的各个接口指向本地测试服务器，避免访问外网
func stubQQEndpoints(t *testing.T, base string) {
	t.Helper()
	smartbox, lyric, client, delay := musicQQSmartboxURL, musicQQLyricURL, musicQQClientHost, musicQQClientRetryDelay
	musicQQSmartboxURL, musicQQLyricURL, musicQQClientHost, musicQQClientRetryDelay = base+"/smartbox", base+"/lyric", base+"/client/", 0
	musicQQSession.Lock()
	musicQQSession.expires = time.Time{}
	musicQQSession.Unlock()
	t.Cleanup(func() {
		musicQQSmartboxURL, musicQQLyricURL, musicQQClientHost, musicQQClientRetryDelay = smartbox, lyric, client, delay
	})
}

func TestSearchQQSongFallback(t *testing.T) {
	var smartboxKeys sync.Map
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/client/musics.fcg", "/client/musicu.fcg":
			// 签名搜索不可用
			w.WriteHeader(http.StatusInternalServerError)
		case "/smartbox":
			smartboxKeys.Store(r.URL.Query().Get("key"), true)
			_, _ = w.Write([]byte(`{"code":0,"data":{"song":{"itemlist":[{"mid":"mid1","name":"歌","singer":"歌手"}]}}}`))
		case "/lyric":
			var body struct {
				Req struct {
					Module string `json:"module"`
					Param  struct {
						Mids []string `json:"mids"`
					} `json:"param"`
				} `json:"req"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Req.Module != "music.trackInfo.UniformRuleCtrl" || len(body.Req.Param.Mids) != 1 {
				t.Errorf("unexpected musicu request %+v", body.Req)
			}
			_, _ = w.Write([]byte(`{"code":0,"req":{"code":0,"data":{"tracks":[{"mid":"mid1","name":"歌","interval":201,"album":{"name":"专辑"},"singer":[{"name":"歌手"}]}]}}}`))
		}
	}))
	t.Cleanup(server.Close)
	stubQQEndpoints(t, server.URL)

	best, degraded, err := searchQQSong(context.Background(), lyricQuery{Title: "歌", Artists: []string{"歌手", "合唱"}, Duration: 200})
	if err != nil || best == nil || !degraded {
		t.Fatalf("fallback = %+v, %v, %v", best, degraded, err)
	}
	if best.MID != "mid1" || best.Duration != 201 || best.Album != "专辑" {
		t.Fatalf("candidate = %+v", best)
	}
	// 联想搜索同时用了三种关键词
	for _, key := range []string{"歌", "歌 歌手", "歌 歌手 合唱"} {
		if _, ok := smartboxKeys.Load(key); !ok {
			t.Errorf("smartbox keyword %q not searched", key)
		}
	}
}

func TestSearchQQSongDesktop(t *testing.T) {
	var otherSearches atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/client/musicu.fcg":
			_, _ = w.Write([]byte(`{"code":0,"req":{"code":0,"data":{"session":{"uid":"u1","sid":"s1"}}}}`))
		case "/client/musics.fcg":
			if r.Header.Get("Sign") == "" || r.Header.Get("Mask") == "" {
				t.Error("desktop search must be signed")
			}
			var body struct {
				Comm map[string]string `json:"comm"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Comm["uid"] != "u1" || body.Comm["sid"] != "s1" || body.Comm["ct"] != "6" {
				t.Errorf("comm = %+v", body.Comm)
			}
			_, _ = w.Write([]byte(`{"code":0,"req":{"code":0,"data":{"body":{"song":{"list":[
				{"mid":"cover","title":"歌","singer":[{"title":"别人"}],"interval":200},
				{"mid":"mid1","title":"歌","singer":[{"title":"歌手"}],"album":{"title":"专辑"},"interval":201}
			]}}}}}`))
		default:
			otherSearches.Add(1)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	stubQQEndpoints(t, server.URL)

	best, degraded, err := searchQQSong(context.Background(), lyricQuery{Title: "歌", Artists: []string{"歌手"}, Album: "专辑", Duration: 201})
	if err != nil || degraded || best == nil || best.MID != "mid1" || best.Album != "专辑" {
		t.Fatalf("desktop = %+v, %v, %v", best, degraded, err)
	}
	// 第一轮命中，不再进行其他搜索
	if otherSearches.Load() != 0 {
		t.Fatalf("other searches = %d", otherSearches.Load())
	}
}
