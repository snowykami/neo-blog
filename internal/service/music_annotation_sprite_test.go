package service

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/snowykami/neo-blog/internal/tools"
)

func TestValidLyricSpritePath(t *testing.T) {
	for _, d := range []string{"M2 2 L22 2 L12 20 Z", "M 7 9.5 A 5 5 0 1 0 17 9.5 Z", "M3.5 7.5C7.8 6 11 4.8 14.5 4.8Q18 5 21 9.8H4V12Z"} {
		if !validLyricSpritePath(d) {
			t.Errorf("%q should be valid", d)
		}
	}
	for _, d := range []string{
		"",                              // 空
		"L2 2 L4 4",                     // 不以 M 开头
		"M2 2 l4 4",                     // 相对坐标
		"M2 2 L30 4",                    // 超出画布
		"M2 2 L4 4\"/><script>",         // 注入
		"M2 2 S4 4 6 6",                 // 不允许的命令
		"M" + strings.Repeat(" 1", 400), // 太长
	} {
		if validLyricSpritePath(d) {
			t.Errorf("%q should be invalid", d)
		}
	}
}

func TestSanitizeLyricAnnotationsSprites(t *testing.T) {
	lines := []string{"气球飞走了", "当玩偶落下", "纸飞机", "下雨了"}
	raw := `{"sprites":[
		{"name":"balloon","image":"balloon","icon":"balloon","motion":"float","size":"l","color":"rose","fallback":"hearts"},
		{"name":"Doll","image":"plush toy","icon":"","motion":"spin-wildly","color":"peach","fallback":"hearts","paths":[{"d":"M7 9.5 A5 5 0 1 0 17 9.5 Z","paint":"fill"}]},
		{"name":"plane","image":"paper plane","icon":"","fallback":"feathers","paths":[{"d":"M2 2 l4 4","paint":"fill"}]},
		{"name":"unused","icon":"star","fallback":"stars"}],
	"lines":[{"i":0,"scene":"custom:balloon"},{"i":1,"scene":"custom:doll"},{"i":2,"scene":"custom:plane"},{"i":3,"scene":"custom:nope"}]}`
	got, err := sanitizeLyricAnnotations(lines, nil, raw)
	if err != nil {
		t.Fatal(err)
	}
	scenes := map[string]string{}
	for _, line := range got.Lines {
		scenes[line.Text] = line.Scene
	}
	// 图标库与画好的粒子保留；路径不合格的换成备用场景；不存在的粒子去掉场景
	if scenes["气球飞走了"] != "custom:balloon" || scenes["当玩偶落下"] != "custom:doll" || scenes["纸飞机"] != "feathers" || scenes["下雨了"] != "" {
		t.Fatalf("scenes = %v", scenes)
	}
	if len(got.Sprites) != 2 {
		t.Fatalf("sprites = %+v", got.Sprites)
	}
	balloon, doll := got.Sprites[0], got.Sprites[1]
	if balloon.Icon != "balloon" || len(balloon.Paths) == 0 || balloon.Paths[0].Paint != "line" || balloon.Size != "l" || balloon.Color != "rose" {
		t.Fatalf("balloon = %+v", balloon)
	}
	// 名称转小写；无效的动作改为 fall；尺寸默认 m
	if doll.Name != "doll" || doll.Icon != "" || doll.Paths[0].Paint != "fill" || doll.Motion != "fall" || doll.Size != "m" || doll.Label != "plush toy" {
		t.Fatalf("doll = %+v", doll)
	}
}

func TestLyricAnnotationPipelineDrawsSprites(t *testing.T) {
	lines := []string{"焦糖色的糖衣", "当玩偶落下从天空坠下", "汇聚一片海"}
	var sprites atomic.Int32
	var spriteUser atomic.Value
	service := &lyricAnnotationService{
		limiter:     &aiLimiter{},
		concurrency: func() int { return 3 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			switch system {
			case lyricAnnotationText.PlanPrompt:
				return `{"sprites":[{"name":"doll","image":"plush toy","icon":"","motion":"fall","color":"peach","fallback":"hearts"},
					{"name":"candy","image":"candy","icon":"candy","motion":"float"}],
					"lines":[{"i":1,"scene":"custom:doll"},{"i":0,"scene":"custom:candy"}]}`, nil
			case lyricAnnotationText.SpritePrompt:
				sprites.Add(1)
				spriteUser.Store(user)
				return "```json\n{\"paths\":[{\"d\":\"M7 9.5 A5 5 0 1 0 17 9.5 Z\",\"paint\":\"fill\"}]}\n```", nil
			default:
				return `{"lines":[]}`, nil
			}
		},
	}
	raw, err := service.generate(1, tools.AIConfig{}, lyricAnnotationInfo{}, lines)
	if err != nil {
		t.Fatal(err)
	}
	got, err := sanitizeLyricAnnotations(lines, nil, raw)
	if err != nil {
		t.Fatal(err)
	}
	// 只画没有图标的那个，用户消息带上它所在的歌词
	if sprites.Load() != 1 {
		t.Fatalf("sprite calls = %d", sprites.Load())
	}
	if user, _ := spriteUser.Load().(string); !strings.Contains(user, "plush toy") || !strings.Contains(user, "当玩偶落下从天空坠下") {
		t.Fatalf("sprite user = %q", user)
	}
	if len(got.Sprites) != 2 || got.Sprites[0].Name != "doll" || len(got.Sprites[0].Paths) != 1 || got.Sprites[1].Icon != "candy" {
		t.Fatalf("sprites = %+v", got.Sprites)
	}
}

func TestLyricSpriteIconsInPrompt(t *testing.T) {
	if len(lyricSpriteIcons) < 200 || !strings.Contains(lyricAnnotationText.PlanPrompt, "objects: balloon, gift") || strings.Contains(lyricAnnotationText.PlanPrompt, "{{icons}}") {
		t.Fatalf("icon list missing from plan prompt (%d icons)", len(lyricSpriteIcons))
	}
}
