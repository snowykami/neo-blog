package service

import (
	"context"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

func TestLyricOffset(t *testing.T) {
	setupTTMLDB(t)
	s := NewMusicService()
	ctx := context.Background()
	if svcerr := s.SaveLyricOffset(ctx, 7, "ncm-yrc", 300); svcerr != nil {
		t.Fatal(svcerr)
	}
	if svcerr := s.SaveLyricOffset(ctx, 7, "qq-qrc", -150); svcerr != nil {
		t.Fatal(svcerr)
	}
	// 再次保存覆盖同一来源
	if svcerr := s.SaveLyricOffset(ctx, 7, "ncm-yrc", 450); svcerr != nil {
		t.Fatal(svcerr)
	}
	got, svcerr := s.GetLyricSettings(ctx, 7)
	if svcerr != nil || !reflect.DeepEqual(got.Offsets, map[string]int{"ncm-yrc": 450, "qq-qrc": -150}) {
		t.Fatalf("offsets = %+v, %v", got, svcerr)
	}
	// 为 0 时清除；未知来源与超出范围的偏移不接受
	if svcerr := s.SaveLyricOffset(ctx, 7, "qq-qrc", 0); svcerr != nil {
		t.Fatal(svcerr)
	}
	if got, _ = s.GetLyricSettings(ctx, 7); !reflect.DeepEqual(got.Offsets, map[string]int{"ncm-yrc": 450}) {
		t.Fatalf("after clear = %+v", got.Offsets)
	}
	for _, bad := range []struct {
		source string
		offset int
	}{{"netease", 100}, {"ncm-yrc", lyricOffsetMaxMs + 1}, {"ncm-yrc", -lyricOffsetMaxMs - 1}} {
		if svcerr := s.SaveLyricOffset(ctx, 7, bad.source, bad.offset); svcerr == nil {
			t.Errorf("%s %d should be rejected", bad.source, bad.offset)
		}
	}
}

func TestLyricPin(t *testing.T) {
	setupTTMLDB(t)
	s := NewMusicService()
	ctx := context.Background()
	if got, _ := s.GetLyricSettings(ctx, 8); got.Pin != "" {
		t.Fatalf("pin = %q", got.Pin)
	}
	for _, kind := range []string{"qq", "ttml"} {
		if svcerr := s.SaveLyricPin(ctx, 8, kind); svcerr != nil {
			t.Fatal(svcerr)
		}
	}
	if got, _ := s.GetLyricSettings(ctx, 8); got.Pin != "ttml" {
		t.Fatalf("pin = %q", got.Pin)
	}
	// 为空时取消；未知来源不接受
	if svcerr := s.SaveLyricPin(ctx, 8, ""); svcerr != nil {
		t.Fatal(svcerr)
	}
	if got, _ := s.GetLyricSettings(ctx, 8); got.Pin != "" {
		t.Fatalf("pin after clear = %q", got.Pin)
	}
	if svcerr := s.SaveLyricPin(ctx, 8, "spotify"); svcerr == nil {
		t.Fatal("unknown kind should be rejected")
	}
}

func TestSanitizeEditedLyricAnnotations(t *testing.T) {
	lines := []string{"樱花飘落的季节", "我们说再见", "樱花飘落的季节"}
	req := &dto.MusicLyricAnnotationsEditReq{
		Font: "kai", Pace: "slow", Intro: "  春天的告别  ", Accent: "#FFB37A",
		Spotlights: []dto.MusicLyricAnnotationSpotlight{{Text: "樱花飘落的季节", Occurrence: 1}, {Text: "我们说再见"}},
		Lines: []dto.MusicLyricAnnotationLine{
			{Text: "樱花飘落的季节", ChorusStart: true, Scene: "petals", SceneColor: "pink", SceneLines: 4, Phrases: []dto.MusicLyricAnnotationPhrase{
				{Text: "樱花", Effect: "glow", Color: "cherry-blossom", Styles: []string{"bold", "bold"}, Pace: "slow"},
				{Text: "季节", Effect: "shatter", Pace: "fast"},
			}},
			{Text: "我们说再见", Mood: "sad", Phrases: []dto.MusicLyricAnnotationPhrase{{Text: "再见", Effect: "dissolve"}}},
		},
	}
	data, ok := sanitizeEditedLyricAnnotations(lines, req, nil)
	if !ok {
		t.Fatal("valid annotation rejected")
	}
	want := lyricAnnotationData{
		Font: "kai", Pace: "slow", Intro: "春天的告别", Accent: "#ffb37a",
		Spotlights: []dto.MusicLyricAnnotationSpotlight{{Text: "樱花飘落的季节", Occurrence: 1}, {Text: "我们说再见"}},
		Lines: []dto.MusicLyricAnnotationLine{
			// 副歌起点也是副歌；旧版颜色名映射到新色板；与全曲节奏相同的不单独保存；重复的字形去掉
			{Text: "樱花飘落的季节", Chorus: true, ChorusStart: true, Scene: "petals", SceneColor: "cherry-blossom", SceneLines: 4, Phrases: []dto.MusicLyricAnnotationPhrase{
				{Text: "樱花", Effect: "glow", Color: "cherry-blossom", Styles: []string{"bold"}},
				{Text: "季节", Effect: "shatter", Pace: "fast"},
			}},
			{Text: "我们说再见", Mood: "sad", Phrases: []dto.MusicLyricAnnotationPhrase{{Text: "再见", Effect: "dissolve"}}},
		},
	}
	if !reflect.DeepEqual(data, want) {
		t.Fatalf("data = %+v\nwant %+v", data, want)
	}

	// 不合法的编辑整体拒绝（不静默修正）
	invalid := []func(r *dto.MusicLyricAnnotationsEditReq){
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[0].Phrases[0].Effect = "explode" },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[0].Phrases[0].Text = "樱花雨" },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[0].Phrases[1].Text = " 樱花 " },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[1].Text = "不存在的一行" },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[1].Text = "樱花飘落的季节" },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[1].Mood = "angry" },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[0].Phrases[0].Color = "neon" },
		func(r *dto.MusicLyricAnnotationsEditReq) {
			r.Spotlights[1] = dto.MusicLyricAnnotationSpotlight{Text: "不存在的一行"}
		},
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Spotlights[1] = r.Spotlights[0] },
		// 「樱花飘落的季节」只出现两次
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Spotlights[0].Occurrence = 2 },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Spotlights[0].Occurrence = -1 },
		func(r *dto.MusicLyricAnnotationsEditReq) {
			r.Spotlights = slices.Repeat(r.Spotlights, 4)
		},
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Accent = "orange" },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[0].SceneLines = lyricAnnotationMaxSceneLines + 1 },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Lines[0].SceneLines = -1 },
		func(r *dto.MusicLyricAnnotationsEditReq) { r.Font = "comic" },
		func(r *dto.MusicLyricAnnotationsEditReq) {
			r.Intro = string(make([]rune, lyricAnnotationMaxIntroRunes+1))
		},
	}
	for i, mutate := range invalid {
		copied := *req
		copied.Lines = []dto.MusicLyricAnnotationLine{req.Lines[0], req.Lines[1]}
		copied.Lines[0].Phrases = append([]dto.MusicLyricAnnotationPhrase{}, req.Lines[0].Phrases...)
		copied.Spotlights = slices.Clone(req.Spotlights)
		mutate(&copied)
		if _, ok := sanitizeEditedLyricAnnotations(lines, &copied, nil); ok {
			t.Errorf("case %d should be rejected", i)
		}
	}
}

func TestEditedLyricAnnotationLocked(t *testing.T) {
	setupEditTest(t)
	calls := 0
	done := make(chan struct{}, 2)
	service := &lyricAnnotationService{
		jobs:        make(map[string]*lyricAnnotationJob),
		limiter:     &aiLimiter{},
		concurrency: func() int { return 1 },
		complete: func(_ context.Context, _ tools.AIConfig, system, _ string) (string, error) {
			if system == lyricAnnotationText.PlanPrompt {
				calls++
			}
			return `{"lines":[{"i":0,"phrases":[{"text":"心动","effect":"swell"}]}]}`, nil
		},
		done: func() { done <- struct{}{} },
	}
	lines := []string{"怦然心动"}
	cfg := tools.AIConfig{Model: "test"}
	ttl := time.Hour
	if _, svcerr := service.get(2, lines, lyricAnnotationInfo{}, cfg, ttl); svcerr != nil {
		t.Fatal(svcerr)
	}
	<-done
	// 手动编辑过且已过期：不自动重新生成
	edited := time.Now()
	repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id = ?", 2).Updates(map[string]any{"created_at": time.Now().Add(-2 * ttl), "edited_at": edited})
	if got, _ := service.get(2, lines, lyricAnnotationInfo{}, cfg, ttl); got.Stale || service.running(lyricAnnotationKeyOf(2, lines)) {
		t.Fatalf("edited annotation should not regenerate: %+v", got)
	}
	// 管理员手动刷新时覆盖，并清空编辑时间
	service.refresh(2, lines, lyricAnnotationInfo{}, cfg)
	<-done
	var record model.LyricAnnotation
	repo.GetDB().Where("song_id = ?", 2).First(&record)
	if record.EditedAt != nil || calls != 2 {
		t.Fatalf("refresh should overwrite edits: edited_at=%v calls=%d", record.EditedAt, calls)
	}
}

func lyricAnnotationKeyOf(id int64, lines []string) string {
	key, _ := lyricAnnotationKey(id, lines)
	return key
}
