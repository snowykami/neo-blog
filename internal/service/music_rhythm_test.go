package service

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func saveAndRestoreRhythmFFmpeg(t *testing.T) {
	t.Helper()
	rhythmFFmpeg.RLock()
	origInit, origAvail, origPath := rhythmFFmpeg.initialized, rhythmFFmpeg.available, rhythmFFmpeg.path
	rhythmFFmpeg.RUnlock()
	t.Cleanup(func() {
		rhythmFFmpeg.Lock()
		rhythmFFmpeg.initialized = origInit
		rhythmFFmpeg.available = origAvail
		rhythmFFmpeg.path = origPath
		rhythmFFmpeg.Unlock()
		musicRhythmCache.Clear()
	})
}

func resetMusicPlaylistState(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		musicState.Lock()
		musicState.key = ""
		musicState.fetchedAt = time.Time{}
		musicState.tracks = nil
		musicState.version = ""
		musicState.refreshing = false
		musicState.recheckAt = time.Time{}
		musicState.songURLs = nil
		musicState.Unlock()
		musicShared.Clear()
	})
}

func TestInitMusicRhythmEnvAndFallback(t *testing.T) {
	saveAndRestoreRhythmFFmpeg(t)

	for _, disabledVal := range []string{"off", "false", "0", "NONE"} {
		t.Setenv(constant.EnvKeyFFmpegPath, disabledVal)
		InitMusicRhythm()
		if avail, _ := rhythmFFmpegStatus(); avail {
			t.Fatalf("FFMPEG_PATH=%q should disable ffmpeg", disabledVal)
		}
	}

	t.Setenv(constant.EnvKeyFFmpegPath, filepath.Join(t.TempDir(), "missing-ffmpeg"))
	InitMusicRhythm()
	if avail, _ := rhythmFFmpegStatus(); avail {
		t.Fatal("missing binary should gracefully fall back to disabled")
	}

	if realFFmpeg, err := exec.LookPath("ffmpeg"); err == nil {
		t.Setenv(constant.EnvKeyFFmpegPath, realFFmpeg)
		InitMusicRhythm()
		avail, gotPath := rhythmFFmpegStatus()
		if !avail || gotPath == "" {
			t.Fatalf("expected ffmpeg %q to be detected", realFFmpeg)
		}
	}
}

func TestMusicRhythmServicePermissionsAndCache(t *testing.T) {
	_, adminCtx, _, _, _ := setupEditTest(t)
	saveAndRestoreRhythmFFmpeg(t)
	resetArticleSongs()
	t.Cleanup(resetArticleSongs)
	setMusicRhythmFFmpegForTest("")

	if err := repo.GetDB().Create(&model.Post{
		PostBase: model.PostBase{
			Title:   "song post",
			Content: songComponent("neteaseSong", `{"id":501}`),
		},
	}).Error; err != nil {
		t.Fatal(err)
	}

	svc := NewMusicService()
	anonCtx := context.Background()

	// 未在白名单内的歌曲对访客返回 404
	if _, svcerr := svc.GetSongRhythm(anonCtx, 999); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("unlisted song should return 404, got %v", svcerr)
	}

	// 无 ffmpeg 且尚无缓存时返回 unavailable（不阻塞）
	got, svcerr := svc.GetSongRhythm(anonCtx, 501)
	if svcerr != nil || got.Status != "unavailable" || got.Reason != "ffmpeg_unavailable" {
		t.Fatalf("no ffmpeg result = %+v, err=%v", got, svcerr)
	}

	// 管理员上传完整节拍分析后，所有访客均可读取
	sampleAnalysis, err := AnalyzeRhythm(testDrumTrack(120, "pop", 12), rhythmSampleRate)
	if err != nil {
		t.Fatal(err)
	}
	saved, svcerr := svc.SaveSongRhythm(adminCtx, 501, sampleAnalysis)
	if svcerr != nil || saved.Status != "ready" || saved.Analysis == nil || saved.Analysis.OnsetData == "" {
		t.Fatalf("save rhythm failed: %+v, %v", saved, svcerr)
	}

	// 清空 L1/L2 后应从数据库读回并重建缓存
	musicRhythmCache.Clear()
	cached, svcerr := svc.GetSongRhythm(anonCtx, 501)
	if svcerr != nil || cached.Status != "ready" || cached.Analysis == nil || math.Abs(cached.Analysis.BPM-120) > 2 {
		t.Fatalf("load from db failed: %+v, %v", cached, svcerr)
	}

	// 刷新清空数据库与缓存
	refreshed, svcerr := svc.RefreshSongRhythm(adminCtx, 501)
	if svcerr != nil || refreshed.Status != "unavailable" || refreshed.Reason != "ffmpeg_unavailable" {
		t.Fatalf("refresh without ffmpeg = %+v, %v", refreshed, svcerr)
	}
	afterClear, svcerr := svc.GetSongRhythm(anonCtx, 501)
	if svcerr != nil || afterClear.Status != "unavailable" {
		t.Fatalf("expected cache deleted after refresh, got %+v, %v", afterClear, svcerr)
	}
}

func TestMusicRhythmFFmpegPipelineFormats(t *testing.T) {
	ffmpegBin, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed on host")
	}

	setupEditTest(t)
	sharedstate.UseMemory()
	saveAndRestoreRhythmFFmpeg(t)
	resetMusicPlaylistState(t)
	resetArticleSongs()
	t.Cleanup(resetArticleSongs)
	setMusicRhythmFFmpegForTest(ffmpegBin)

	tmpDir := t.TempDir()
	rawPath := filepath.Join(tmpDir, "source.f32le")
	samples := testDrumTrack(120, "pop", 16)
	rawFile, err := os.Create(rawPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range samples {
		_ = binary.Write(rawFile, binary.LittleEndian, math.Float32bits(s))
	}
	_ = rawFile.Close()

	// 生成 MP3 / M4A(AAC) / FLAC 三种真实容器格式验证 ffmpeg 端到端管道与非 faststart SEEK 兼容性
	formats := []struct {
		songID int64
		ext    string
		args   []string
	}{
		{601, "mp3", []string{"-c:a", "libmp3lame", "-b:a", "128k"}},
		{602, "m4a", []string{"-c:a", "aac", "-b:a", "128k"}},
		{603, "flac", []string{"-c:a", "flac"}},
	}

	filesByID := map[string]string{}
	playlistSongs := make([]map[string]any, 0, len(formats))
	playlistPrivs := make([]map[string]any, 0, len(formats))
	for _, f := range formats {
		outPath := filepath.Join(tmpDir, fmt.Sprintf("track-%d.%s", f.songID, f.ext))
		cmdArgs := append([]string{"-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", "11025", "-ac", "1", "-i", rawPath, "-ar", "44100", "-ac", "2"}, f.args...)
		cmdArgs = append(cmdArgs, outPath)
		if out, encErr := exec.Command(ffmpegBin, cmdArgs...).CombinedOutput(); encErr != nil {
			t.Skipf("encode %s skipped (codec unavailable in host ffmpeg): %v %s", f.ext, encErr, string(out))
		}
		filesByID[fmt.Sprintf("%d", f.songID)] = outPath
		playlistSongs = append(playlistSongs, map[string]any{"id": f.songID, "name": f.ext, "dt": 16000})
		playlistPrivs = append(playlistPrivs, map[string]any{"id": f.songID, "st": 0})
	}

	var srvURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/playlist/track/all":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":       200,
				"songs":      playlistSongs,
				"privileges": playlistPrivs,
			})
		case "/song/url/v1":
			w.Header().Set("Content-Type", "application/json")
			id := r.URL.Query().Get("id")
			if id == "699" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code": 200,
					"data": []map[string]any{{"id": 699, "url": srvURL + "/audio?id=699", "freeTrialInfo": map[string]int{"start": 0, "end": 30}}},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 200,
				"data": []map[string]any{{"id": id, "url": srvURL + "/audio?id=" + id}},
			})
		case "/audio":
			idStr := r.URL.Query().Get("id")
			p, ok := filesByID[idStr]
			if !ok {
				http.NotFound(w, r)
				return
			}
			http.ServeFile(w, r, p)
		default:
			http.NotFound(w, r)
		}
	}))
	srvURL = srv.URL
	defer srv.Close()

	setMusicKV(t, map[string]any{
		"ncm_api_base_url": srv.URL,
		"ncm_cookie":       "abc",
		"ncm_playlist_id":  99001,
	})

	// 默认 fetchRhythmStandardAudioURL 遇到 VIP 30 秒试听片段应主动拦截报错
	if _, trialErr := fetchRhythmStandardAudioURL(context.Background(), 699); trialErr == nil {
		t.Fatal("expected trial snippet freeTrialInfo to be rejected")
	}

	origDone := musicRhythmJobs.done
	var mu sync.Mutex
	doneCh := make(chan struct{}, len(formats))
	finished := map[int64]error{}
	musicRhythmJobs.done = func(id int64, jobErr error) {
		mu.Lock()
		finished[id] = jobErr
		mu.Unlock()
		doneCh <- struct{}{}
	}
	t.Cleanup(func() {
		musicRhythmJobs.done = origDone
	})

	svc := NewMusicService()
	ctx := context.Background()
	for _, f := range formats {
		first, svcerr := svc.GetSongRhythm(ctx, f.songID)
		if svcerr != nil || first.Status != "pending" {
			t.Fatalf("%s first GetSongRhythm = %+v, %v", f.ext, first, svcerr)
		}
	}

	for range formats {
		select {
		case <-doneCh:
		case <-time.After(20 * time.Second):
			t.Fatal("timeout waiting for ffmpeg rhythm jobs")
		}
	}

	for _, f := range formats {
		if jobErr := finished[f.songID]; jobErr != nil {
			t.Fatalf("%s job failed: %v", f.ext, jobErr)
		}
		ready, svcerr := svc.GetSongRhythm(ctx, f.songID)
		if svcerr != nil || ready.Status != "ready" || ready.Analysis == nil {
			t.Fatalf("%s final GetSongRhythm = %+v, %v", f.ext, ready, svcerr)
		}
		if oe := testOctaveError(ready.Analysis.BPM, 120); oe != 0 {
			t.Fatalf("%s detected BPM = %.2f (want ~120)", f.ext, ready.Analysis.BPM)
		}
		if len(ready.Analysis.Beats) < 10 || ready.Analysis.OnsetData == "" {
			t.Fatalf("%s incomplete output: beats=%d onsetLen=%d", f.ext, len(ready.Analysis.Beats), len(ready.Analysis.OnsetData))
		}
	}
}
