package apiv1

import (
	"bytes"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func TestMusicMVRouterRBACAndRangeProxy(t *testing.T) {
	sharedstate.UseMemory()
	service.ListenMusicWhitelistChanges()
	t.Cleanup(func() { repo.TouchCacheTags(repo.CacheTagPosts) })
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	videoPayload := []byte("ABCDEFGHIJKLMNOPQRSTUVWX")
	var ncmSrv *httptest.Server
	ncmSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/song/detail":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":  200,
				"songs": []map[string]any{{"id": 901, "name": "测试单曲", "mv": 7701}},
			})
		case "/mv/url":
			if r.URL.Query().Get("r") != "480" {
				t.Errorf("expected r=480, got %q", r.URL.Query().Get("r"))
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 200,
				"data": map[string]any{"id": 7701, "url": ncmSrv.URL + "/vod/7701.mp4", "expi": 1800},
			})
		case "/vod/7701.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			http.ServeContent(w, r, "7701.mp4", time.Time{}, bytes.NewReader(videoPayload))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ncmSrv.Close)

	if err := repo.KV.SetKV("ncm_api_base_url", ncmSrv.URL); err != nil {
		t.Fatal(err)
	}
	if err := repo.KV.SetKV("ncm_cookie", "abc"); err != nil {
		t.Fatal(err)
	}

	admin := &model.User{Username: "admin_mv", Email: "admin_mv@test.local", Role: constant.RoleAdmin}
	editor := &model.User{Username: "editor_mv", Email: "editor_mv@test.local", Role: constant.RoleEditor}
	viewer := &model.User{Username: "viewer_mv", Email: "viewer_mv@test.local", Role: constant.RoleUser}
	for _, u := range []*model.User{admin, editor, viewer} {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := repo.GetDB().Create(&model.Post{
		UserID: admin.ID,
		PostBase: model.PostBase{
			Title:   "mv card",
			Content: `<div data-component="neteaseSong" data-props="` + html.EscapeString(`{"id":901}`) + `"></div>`,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}
	repo.TouchCacheTags(repo.CacheTagPosts)

	base := startRoutes(t, registerMusicRoutes)
	adminCookie := loginCookie(t, admin)
	editorCookie := loginCookie(t, editor)
	viewerCookie := loginCookie(t, viewer)

	settingReq := dto.MusicMVSettingReq{OffsetMs: -800, Disabled: false}

	// 非管理员写入 MV 设置均被拦截
	for name, tc := range map[string]struct {
		cookie string
		want   int
	}{
		"guest":  {"", http.StatusUnauthorized},
		"user":   {viewerCookie, http.StatusForbidden},
		"editor": {editorCookie, http.StatusForbidden},
	} {
		if status, body := performJSONRequest(t, http.MethodPut, base+"/music/song/901/mv/setting", tc.cookie, settingReq); status != tc.want {
			t.Errorf("%s PUT /music/song/901/mv/setting: status %d, want %d, body %s", name, status, tc.want, body)
		}
	}

	// 管理员保存成功后，公开访客可读取 MV 信息与设置
	if status, body := performJSONRequest(t, http.MethodPut, base+"/music/song/901/mv/setting", adminCookie, settingReq); status != http.StatusOK {
		t.Fatalf("admin PUT /music/song/901/mv/setting: status %d body %s", status, body)
	}

	status, body := getAs(t, base+"/music/song/901/mv", "")
	if status != http.StatusOK {
		t.Fatalf("guest GET /music/song/901/mv: status %d body %s", status, body)
	}
	var mvResp struct {
		Data dto.MusicSongMVDto `json:"data"`
	}
	if err := json.Unmarshal(body, &mvResp); err != nil {
		t.Fatal(err)
	}
	if mvResp.Data.MVID != 7701 || !mvResp.Data.Available || mvResp.Data.OffsetMs != -800 || mvResp.Data.Disabled || mvResp.Data.StreamURL != "/api/v1/music/mv/7701/stream" {
		t.Fatalf("unexpected GET /music/song/901/mv data: %+v", mvResp.Data)
	}

	// 公开访客带 Range 请求视频流代理接口，验证 206 Partial Content 与各响应头透传
	rangeReq, err := http.NewRequest(http.MethodGet, base+"/music/mv/7701/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	rangeReq.Header.Set("Range", "bytes=2-7")
	streamResp, err := http.DefaultClient.Do(rangeReq)
	if err != nil {
		t.Fatal(err)
	}
	defer streamResp.Body.Close()
	streamBytes, _ := io.ReadAll(streamResp.Body)
	if streamResp.StatusCode != http.StatusPartialContent {
		t.Fatalf("stream status = %d, want 206", streamResp.StatusCode)
	}
	if got := streamResp.Header.Get("Content-Range"); got != "bytes 2-7/24" {
		t.Errorf("Content-Range = %q, want %q", got, "bytes 2-7/24")
	}
	if got := streamResp.Header.Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("Accept-Ranges = %q, want bytes", got)
	}
	if got := streamResp.Header.Get("Content-Length"); got != "6" {
		t.Errorf("Content-Length = %q, want 6", got)
	}
	if got := streamResp.Header.Get("Content-Type"); got != "video/mp4" {
		t.Errorf("Content-Type = %q, want video/mp4", got)
	}
	if string(streamBytes) != "CDEFGH" {
		t.Errorf("stream body = %q, want CDEFGH", string(streamBytes))
	}
}
