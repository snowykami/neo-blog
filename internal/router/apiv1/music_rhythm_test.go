package apiv1

import (
	"bytes"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func performJSONRequest(t *testing.T, method, url, cookie string, body any) (int, string) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(method, url, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

func TestMusicRhythmRouterRBAC(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyFFmpegPath, "off")
	service.InitMusicRhythm()
	t.Cleanup(service.InitMusicRhythm)
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	editor := &model.User{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor}
	viewer := &model.User{Username: "viewer", Email: "viewer@test.local", Role: constant.RoleUser}
	for _, u := range []*model.User{admin, editor, viewer} {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := repo.GetDB().Create(&model.Post{
		UserID: admin.ID,
		PostBase: model.PostBase{
			Title:   "music card",
			Content: `<div data-component="neteaseSong" data-props="` + html.EscapeString(`{"id":801}`) + `"></div>`,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}

	base := startRoutes(t, registerMusicRoutes)
	adminCookie := loginCookie(t, admin)
	editorCookie := loginCookie(t, editor)
	viewerCookie := loginCookie(t, viewer)

	sample := dto.MusicRhythmAnalysisDto{
		AlgoVersion:   1,
		DurationMs:    180_000,
		FrameMs:       11.61,
		FrameOffsetMs: 46.44,
		PeriodMs:      500,
		BasePeriodMs:  500,
		BPM:           120,
		Confidence:    0.72,
		LoudLow:       -24,
		LoudHigh:      -6,
		Beats:         []dto.MusicRhythmBeatDto{{T: 500, Loud: -8, Strength: 1.5}},
		Autocorr:      []float64{1, 0.5, 0.8},
		OnsetMax:      3.5,
		OnsetData:     "AAECAwQ=",
	}

	// 非管理员写入与刷新均必须拦截
	for name, tc := range map[string]struct {
		cookie string
		want   int
	}{
		"guest":  {"", http.StatusUnauthorized},
		"user":   {viewerCookie, http.StatusForbidden},
		"editor": {editorCookie, http.StatusForbidden},
	} {
		if status, body := performJSONRequest(t, http.MethodPut, base+"/music/song/801/rhythm", tc.cookie, sample); status != tc.want {
			t.Errorf("%s PUT /music/song/801/rhythm: status %d, want %d, body %s", name, status, tc.want, body)
		}
		if status, body := performJSONRequest(t, http.MethodPost, base+"/music/song/801/rhythm/refresh", tc.cookie, struct{}{}); status != tc.want {
			t.Errorf("%s POST /music/song/801/rhythm/refresh: status %d, want %d, body %s", name, status, tc.want, body)
		}
	}

	// 管理员上传成功后，匿名访客立即可读取到完整缓存
	if status, body := performJSONRequest(t, http.MethodPut, base+"/music/song/801/rhythm", adminCookie, sample); status != http.StatusOK {
		t.Fatalf("admin PUT /music/song/801/rhythm: status %d body %s", status, body)
	}
	status, body := getAs(t, base+"/music/song/801/rhythm", "")
	if status != http.StatusOK {
		t.Fatalf("guest GET /music/song/801/rhythm: status %d body %s", status, body)
	}
	var resp struct {
		Data dto.MusicSongRhythmDto `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Status != "ready" || resp.Data.Analysis == nil || resp.Data.Analysis.OnsetData != "AAECAwQ=" {
		t.Fatalf("unexpected GET response: %+v", resp.Data)
	}
}
