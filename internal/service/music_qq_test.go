package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
	var searched string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/amll/") {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodGet {
			searched = r.URL.Query().Get("w")
			_, _ = w.Write([]byte(`{"code":0,"data":{"song":{"list":[
				{"songmid":"cover","songname":"歌","singer":[{"name":"别人"}],"interval":200},
				{"songmid":"mid1","songname":"歌","singer":[{"name":"歌手"}],"albumname":"专辑","interval":201}
			]}}}`))
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
	originalSearch, originalLyric := musicQQSearchURL, musicQQLyricURL
	musicQQSearchURL, musicQQLyricURL = server.URL+"/search", server.URL+"/lyric"
	// 预热 TTML 的请求也指向本地，避免访问外网
	setupTTMLTest(t, "", server.URL+"/amll")
	t.Cleanup(func() { musicQQSearchURL, musicQQLyricURL = originalSearch, originalLyric })

	lyric, err := fetchQQLyric(context.Background(), &dto.MusicSongDto{Name: "歌", Artists: []string{"歌手"}, Album: "专辑", Duration: 200500})
	if err != nil {
		t.Fatal(err)
	}
	if searched != "歌 歌手" {
		t.Errorf("keyword = %q", searched)
	}
	if lyric.SongMID != "mid1" || lyric.Format != "qrc" || lyric.Translation != "[00:01.00]你好呀" || lyric.Romanization != "" {
		t.Fatalf("lyric = %+v", lyric)
	}
	if lyric.Lyric != "[ti:歌]\n[1000,1000]你(1000,500)好(1500,500)" {
		t.Fatalf("lyric body = %q", lyric.Lyric)
	}

	// 没有匹配的歌曲：空结果，不是错误
	lyric, err = fetchQQLyric(context.Background(), &dto.MusicSongDto{Name: "另一首", Artists: []string{"歌手"}})
	if err != nil || lyric.SongMID != "" || lyric.Lyric != "" {
		t.Fatalf("no match = %+v, %v", lyric, err)
	}
}

func TestSearchQQSongsFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/search":
			w.WriteHeader(http.StatusInternalServerError)
		case "/smartbox":
			_, _ = w.Write([]byte(`{"code":0,"data":{"song":{"itemlist":[{"mid":"mid1","name":"歌","singer":"歌手"}]}}}`))
		case "/musicu":
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
	originalSearch, originalSmartbox, originalLyric := musicQQSearchURL, musicQQSmartboxURL, musicQQLyricURL
	musicQQSearchURL, musicQQSmartboxURL, musicQQLyricURL = server.URL+"/search", server.URL+"/smartbox", server.URL+"/musicu"
	t.Cleanup(func() {
		musicQQSearchURL, musicQQSmartboxURL, musicQQLyricURL = originalSearch, originalSmartbox, originalLyric
	})

	candidates, err := searchQQSongs(context.Background(), "歌 歌手")
	if err != nil || len(candidates) != 1 {
		t.Fatalf("fallback = %+v, %v", candidates, err)
	}
	if got := candidates[0]; got.MID != "mid1" || got.Duration != 201 || got.Album != "专辑" || len(got.Artists) != 1 {
		t.Fatalf("candidate = %+v", got)
	}
}
