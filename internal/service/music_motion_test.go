package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

func TestCalibratedMotionPaceBuckets(t *testing.T) {
	// 1. crisp: 高速快切
	if got, _ := classifyLyricMotionFromPace(1.65, 1.15, 1.43, 35, 20, 4.8, 0, 5, 30, 0.45); got != "crisp" {
		t.Fatalf("expected crisp, got %q", got)
	}
	// 2. gentle: 悠长留白抒情
	if got, _ := classifyLyricMotionFromPace(5.40, 4.10, 1.32, 0, 0, 1.9, 25, 0, 20, 0.28); got != "gentle" {
		t.Fatalf("expected gentle, got %q", got)
	}
	// 3. bouncy: 轻快跳跃
	if got, _ := classifyLyricMotionFromPace(2.85, 2.12, 1.34, 8, 0, 3.2, 5, 12, 25, 0.38); got != "bouncy" {
		t.Fatalf("expected bouncy, got %q", got)
	}
	// 4. cascade: 强烈主副歌反差
	if got, _ := classifyLyricMotionFromPace(4.80, 2.40, 2.00, 3, 0, 2.4, 15, 2, 28, 0.46); got != "cascade" {
		t.Fatalf("expected cascade, got %q", got)
	}
	// 5. plush: 温润慢弹（中速/中慢速高适配）
	if got, _ := classifyLyricMotionFromPace(3.85, 3.30, 1.17, 4, 0, 2.2, 8, 2, 20, 0.34); got != "plush" {
		t.Fatalf("expected plush, got %q", got)
	}
	// 6. flow: 均衡叙事推进
	if got, _ := classifyLyricMotionFromPace(3.25, 2.55, 1.27, 10, 0, 2.6, 4, 0, 22, 0.43); got != "flow" {
		t.Fatalf("expected flow, got %q", got)
	}
}

func TestStandaloneLyricMotionAndAnnotationSync(t *testing.T) {
	setupEditTest(t)

	doneCh := make(chan struct{}, 4)
	svc := &lyricMotionService{
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			if !strings.Contains(system, "plush:") || !strings.Contains(system, "cascade:") {
				t.Errorf("motion system prompt missing presets:\n%s", system)
			}
			if !strings.Contains(user, "<lyrics_excerpt>") {
				t.Errorf("motion user prompt missing lyrics_excerpt:\n%s", user)
			}
			return `{"motion":"cascade"}`, nil
		},
		concurrency: func() int { return 2 },
		done:        func() { doneCh <- struct{}{} },
	}

	lines := []string{
		"静かな夜の底で息を潜めて",
		"遠い灯りだけを数えていた",
		"やがて嵐が扉を叩くなら",
		"今こそ声を高く解き放て",
		"光る翼で空を裂いてゆけ",
		"終わらない歌を君に届けよう",
	}
	info := lyricAnnotationInfo{
		Title:     "DramaticWaltz",
		Artists:   []string{"SingerA"},
		Source:    "ncm-lrc",
		WordTimed: false,
		BPM:       132,
		Timed: []lyricTimedLine{
			{Start: 1000, End: 5200, Text: lines[0]},
			{Start: 5800, End: 10200, Text: lines[1]},
			{Start: 10800, End: 15200, Text: lines[2]},
			{Start: 15500, End: 17600, Text: lines[3]},
			{Start: 17800, End: 19900, Text: lines[4]},
			{Start: 20100, End: 22300, Text: lines[5]},
		},
	}

	songID := int64(880011)
	_, hash := lyricAnnotationKey(songID, lines)

	// 1. 未配置 AI 时：直接返回启发式标定结果，状态 ready
	noAI, svcerr := svc.getOrStart(songID, lines, info, 7*24*time.Hour)
	if svcerr != nil || noAI.Status != lyricAnnotationStatusReady || !lyricAnnotationMotions[noAI.Motion] || noAI.AI {
		t.Fatalf("unexpected heuristic motion response: %+v, err=%v", noAI, svcerr)
	}

	// 2. 已有手动编辑的完整歌词标注时：独立弹性查询回填并保留已有结果；管理员单独刷新弹性时同步更新 Data.Motion 且不丢失手动编辑的短语和 EditedAt
	now := time.Now().Add(-time.Hour)
	rawAnn, _ := json.Marshal(lyricAnnotationData{
		Font:   "song",
		Motion: "plush",
		Lines: []dto.MusicLyricAnnotationLine{
			{Text: lines[3], Mood: "intense", Phrases: []dto.MusicLyricAnnotationPhrase{{Text: "声を", Effect: "swell", Color: "gold"}}},
		},
	})
	if err := repo.GetDB().Create(&model.LyricAnnotation{
		SongID:    songID,
		LyricHash: hash,
		Data:      string(rawAnn),
		Model:     "manual",
		Source:    "ttml-amll",
		Phrases:   1,
		CreatedAt: now,
		EditedAt:  &now,
	}).Error; err != nil {
		t.Fatalf("seed LyricAnnotation: %v", err)
	}

	backfilled, svcerr := svc.getOrStart(songID, lines, info, 7*24*time.Hour)
	if svcerr != nil || backfilled.Status != lyricAnnotationStatusReady || backfilled.Motion != "plush" || !backfilled.AI {
		t.Fatalf("expected backfilled plush motion, got %+v, err=%v", backfilled, svcerr)
	}

	// 3. 管理员单独触发刷新歌词弹性 -> 生成 cascade 并同步写回 LyricAnnotation.Data.Motion，同时保留 EditedAt 与 Phrases
	cfg := tools.AIConfig{BaseURL: "https://api.example.com/v1", APIKey: "sk-test", Model: "test-motion-model"}
	pending := svc.refresh(songID, lines, info, cfg)
	if pending.Status != lyricAnnotationStatusPending || pending.Motion != "plush" {
		t.Fatalf("expected pending with previous motion plush, got %+v", pending)
	}
	select {
	case <-doneCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for standalone motion refresh")
	}

	ready, svcerr := svc.getOrStart(songID, lines, info, 7*24*time.Hour)
	if svcerr != nil || ready.Status != lyricAnnotationStatusReady || ready.Motion != "cascade" || !ready.AI {
		t.Fatalf("expected refreshed cascade motion, got %+v, err=%v", ready, svcerr)
	}

	var updatedAnn model.LyricAnnotation
	if err := repo.GetDB().Where("song_id = ? AND lyric_hash = ?", songID, hash).First(&updatedAnn).Error; err != nil {
		t.Fatalf("load updated LyricAnnotation: %v", err)
	}
	if updatedAnn.EditedAt == nil {
		t.Fatal("expected EditedAt to be preserved after standalone motion refresh")
	}
	parsedAnn := parseLyricAnnotationData(updatedAnn.Data)
	if parsedAnn.Motion != "cascade" || parsedAnn.Font != "song" || len(parsedAnn.Lines) != 1 {
		t.Fatalf("expected synced motion without losing manual edits, got %+v", parsedAnn)
	}

	// 4. 自动触发的旧任务（syncAnnotation=false）晚于已有新记录或批量删除时拒绝覆盖
	staleStart := time.Now().Add(-time.Minute)
	if err := saveGeneratedStandaloneMotion(songID, hash, "ncm-lrc", "auto-model", "gentle", staleStart, false); err != errLyricAnnotationEdited {
		t.Fatalf("expected stale auto motion writeback to yield errLyricAnnotationEdited, got %v", err)
	}
	if _, _, err := lyricAnnotations.deleteSongs(context.Background(), []int64{songID}); err != nil {
		t.Fatalf("deleteSongs failed: %v", err)
	}
	if err := saveGeneratedStandaloneMotion(songID, hash, "ncm-lrc", "auto-model", "gentle", staleStart, false); err != errLyricAnnotationDeleted {
		t.Fatalf("expected deleted song writeback to yield errLyricAnnotationDeleted, got %v", err)
	}
}
