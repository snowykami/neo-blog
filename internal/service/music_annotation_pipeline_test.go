package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/tools"
)

func TestLyricAnnotationChunks(t *testing.T) {
	cases := map[int][][2]int{
		0:   nil,
		5:   {{0, 4}},
		20:  {{0, 19}},
		45:  {{0, 14}, {15, 29}, {30, 44}},
		150: {{0, 24}, {25, 49}, {50, 74}, {75, 99}, {100, 124}, {125, 149}},
	}
	for n, want := range cases {
		if got := lyricAnnotationChunks(n); !reflect.DeepEqual(got, want) {
			t.Errorf("chunks(%d) = %v, want %v", n, got, want)
		}
	}
}

func TestLyricAnnotationPipeline(t *testing.T) {
	lines := make([]string, 45)
	for i := range lines {
		lines[i] = fmt.Sprintf("第%d句歌词在这里", i)
	}
	rangeRe := regexp.MustCompile(`【本次标注范围】第 (\d+) 行～第 (\d+) 行`)
	var inFlight, peak, chunkCalls atomic.Int32
	service := &lyricAnnotationService{
		limiter:     &aiLimiter{},
		concurrency: func() int { return 3 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			if system == lyricAnnotationPlanPrompt {
				// 规划：副歌起点、场景、意象；规划里不应出现的短语会被忽略
				return `{"theme":"t","direction":"d","intro":"导语","font":"song","imagery":[{"text":"歌词","effect":"glow","color":"gold"}],
					"lines":[{"i":0,"chorus_start":true,"scene":"petals","phrases":[{"text":"不该出现","effect":"swell"}]},{"i":40,"mood":"sad"}]}`, nil
			}
			now := inFlight.Add(1)
			defer inFlight.Add(-1)
			for {
				old := peak.Load()
				if now <= old || peak.CompareAndSwap(old, now) {
					break
				}
			}
			chunkCalls.Add(1)
			// 模拟模型耗时，让并行的段有机会重叠
			time.Sleep(50 * time.Millisecond)
			if !strings.Contains(user, "意象（出现时 effect 与 color 必须与此一致）") || !strings.Contains(user, "- 歌词：glow，gold") {
				return "", errors.New("plan not passed to chunk")
			}
			m := rangeRe.FindStringSubmatch(user)
			from, _ := strconv.Atoi(m[1])
			to, _ := strconv.Atoi(m[2])
			// 第二段一直失败（重试后放弃），其余段为范围内每行标一个短语，并故意多标一行范围外的
			if from == 15 {
				return "", errors.New("boom")
			}
			var items []string
			for i := from; i <= to+1; i++ {
				items = append(items, fmt.Sprintf(`{"i":%d,"phrases":[{"text":"歌词","effect":"glow","color":"gold"}]}`, i))
			}
			return "```json\n{\"lines\":[" + strings.Join(items, ",") + "]}\n```", nil
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
	// 3 段并行（第二段重试一次），至少两段同时进行
	if chunkCalls.Load() != 4 || peak.Load() < 2 {
		t.Fatalf("chunk calls = %d, peak concurrency = %d", chunkCalls.Load(), peak.Load())
	}
	if got.Font != "song" || got.Intro != "导语" {
		t.Fatalf("plan fields = %+v", got)
	}
	phrased := map[string]bool{}
	for _, line := range got.Lines {
		if len(line.Phrases) > 0 {
			phrased[line.Text] = true
		}
		if line.Text == lines[0] && !(line.ChorusStart && line.Scene == "petals" && len(line.Phrases) == 1 && line.Phrases[0].Text == "歌词") {
			t.Fatalf("line 0 = %+v", line)
		}
		if line.Text == lines[40] && line.Mood != "sad" {
			t.Fatalf("line 40 = %+v", line)
		}
	}
	// 失败的第二段（15～29 行）没有短语，其余 30 行都有；范围外多标的行不重复
	if len(phrased) != 30 || phrased[lines[20]] || !phrased[lines[14]] || !phrased[lines[30]] {
		t.Fatalf("phrased lines = %d", len(phrased))
	}
}

func TestLyricAnnotationPlanRetry(t *testing.T) {
	original := lyricAnnotationPlanRetryDelay
	lyricAnnotationPlanRetryDelay = 0
	t.Cleanup(func() { lyricAnnotationPlanRetryDelay = original })

	const validPlan = `{"theme":"t","direction":"d","font":"song","lines":[]}`
	newService := func(planReplies []func() (string, error)) (*lyricAnnotationService, *atomic.Int32, *atomic.Int32) {
		var planCalls, chunkCalls atomic.Int32
		return &lyricAnnotationService{
			limiter:     &aiLimiter{},
			concurrency: func() int { return 2 },
			complete: func(_ context.Context, _ tools.AIConfig, system, _ string) (string, error) {
				if system == lyricAnnotationPlanPrompt {
					n := int(planCalls.Add(1)) - 1
					return planReplies[min(n, len(planReplies)-1)]()
				}
				chunkCalls.Add(1)
				return `{"lines":[]}`, nil
			},
		}, &planCalls, &chunkCalls
	}
	lines := []string{"第一句", "第二句"}

	// 第一次出错、第一次回复不是 JSON：重试后成功，继续逐段标注
	for name, first := range map[string]func() (string, error){
		"error":    func() (string, error) { return "", errors.New("timeout") },
		"not json": func() (string, error) { return "抱歉，请稍后再试", nil },
	} {
		service, planCalls, chunkCalls := newService([]func() (string, error){first, func() (string, error) { return validPlan, nil }})
		raw, err := service.generate(1, tools.AIConfig{}, lyricAnnotationInfo{}, lines)
		if err != nil || !strings.Contains(raw, `"font":"song"`) {
			t.Fatalf("%s: generate = %q, %v", name, raw, err)
		}
		if planCalls.Load() != 2 || chunkCalls.Load() != 1 {
			t.Fatalf("%s: plan calls = %d, chunk calls = %d", name, planCalls.Load(), chunkCalls.Load())
		}
	}

	// 重试后仍失败：整个任务失败，不再逐段标注
	service, planCalls, chunkCalls := newService([]func() (string, error){func() (string, error) { return "", errors.New("boom") }})
	if _, err := service.generate(1, tools.AIConfig{}, lyricAnnotationInfo{}, lines); err == nil || !strings.Contains(err.Error(), "plan") {
		t.Fatalf("persistent plan failure should fail the job, got %v", err)
	}
	if planCalls.Load() != int32(lyricAnnotationPlanRetries+1) || chunkCalls.Load() != 0 {
		t.Fatalf("plan calls = %d, chunk calls = %d", planCalls.Load(), chunkCalls.Load())
	}
}
