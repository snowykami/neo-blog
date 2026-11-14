package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
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
	rangeRe := regexp.MustCompile(`Annotate lines (\d+)-(\d+)`)
	var inFlight, peak, chunkCalls atomic.Int32
	service := &lyricAnnotationService{
		limiter:     &llmclient.Limiter{},
		concurrency: func() int { return 3 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			if system == lyricAnnotationText.PlanPrompt {
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
			if !strings.Contains(user, "Imagery:\n") || !strings.Contains(user, "- 歌词: glow, gold") {
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
			limiter:     &llmclient.Limiter{},
			concurrency: func() int { return 2 },
			complete: func(_ context.Context, _ tools.AIConfig, system, _ string) (string, error) {
				if system == lyricAnnotationText.PlanPrompt {
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

func TestLyricAnnotationLinesPromptSpotlight(t *testing.T) {
	lines := []string{"主歌", "副歌", "点题句", "尾声", "点题句"}
	var plan lyricAnnotationPlan
	if err := json.Unmarshal([]byte(`{"spotlights":[2],"lines":[{"i":1,"chorus_start":true},{"i":2,"mood":"sad"}]}`), &plan); err != nil {
		t.Fatal(err)
	}
	// 聚光灯那一行与其他标注合并在同一行；同一句的其他出现没有选中时不标
	prompt := buildLyricAnnotationLinesPrompt(lyricAnnotationInfo{}, lines, plan, 0, 4, 1)
	if !strings.Contains(prompt, "line 2: spotlight, mood sad\n") || strings.Contains(prompt, "line 4: spotlight\n") {
		t.Fatalf("spotlight marks wrong:\n%s", prompt)
	}
	plan.Spotlights = []int{2, 4}
	if prompt := buildLyricAnnotationLinesPrompt(lyricAnnotationInfo{}, lines, plan, 0, 4, 1); !strings.Contains(prompt, "line 4: spotlight\n") {
		t.Fatalf("selected repeat not marked:\n%s", prompt)
	}
	plan.Spotlights = []int{2}
	// 没有其他标注时单独列出；不在本段时不标
	plan.Lines = nil
	if prompt := buildLyricAnnotationLinesPrompt(lyricAnnotationInfo{}, lines, plan, 0, 3, 1); !strings.Contains(prompt, "line 2: spotlight\n") {
		t.Fatalf("prompt missing standalone spotlight mark:\n%s", prompt)
	}
	if prompt := buildLyricAnnotationLinesPrompt(lyricAnnotationInfo{}, lines, plan, 3, 3, 2); strings.Contains(prompt, "spotlight\n") {
		t.Fatal("spotlight outside the chunk should not be marked")
	}
}

func TestLyricAnnotationStage1PartialAndParallelPrefetch(t *testing.T) {
	setupTTMLDB(t)
	resetLyricSharedState(t)

	lines := []string{"第一句歌词", "第二句歌词"}
	validPlan := `{"font":"song","accent":"#ff6b8b","intro":"一段导语","outro_comment":1,"moments":[{"text":"第一句歌词","content":"旁白时刻","source":"ai"}],"spotlights":[1],"lines":[{"i":0,"mood":"calm"},{"i":1,"chorus_start":true,"chorus":true,"mood":"intense"}]}`
	validChunk := `{"lines":[{"i":0,"phrases":[{"text":"第一句","effect":"glow","color":"amber"}]}]}`

	// 三个前置依赖（热评、副歌、借长音）通过屏障同步，若串行执行会阻塞超时
	var arrived atomic.Int32
	allArrived := make(chan struct{})
	barrier := func() {
		if arrived.Add(1) == 3 {
			close(allArrived)
		}
		select {
		case <-allArrived:
		case <-time.After(2 * time.Second):
			t.Error("upstream prefetch did not execute in parallel")
		}
	}

	planDone := make(chan struct{})
	releaseChunk := make(chan struct{})
	var callIdx atomic.Int32
	svc := &lyricAnnotationService{
		name:    "test_partial_" + t.Name(),
		limiter: &llmclient.Limiter{},
		complete: func(_ context.Context, _ tools.AIConfig, system, _ string) (string, error) {
			if callIdx.Add(1) == 1 || strings.Contains(system, lyricAnnotationText.PlanPrompt) {
				if strings.Contains(system, lyricAnnotationText.PlanPrompt) {
					return validPlan, nil
				}
			}
			// 进入 chunk 阶段前，Stage-1 结果应已写入共享状态
			select {
			case <-planDone:
			default:
				close(planDone)
			}
			<-releaseChunk
			return validChunk, nil
		},
		hotComments: func(_ context.Context, _ int64) []lyricAnnotationComment {
			barrier()
			return []lyricAnnotationComment{{Content: "精选热评故事真感人", Liked: 120}}
		},
		chorus: func(_ context.Context, _ int64) []dto.MusicChorusDto {
			barrier()
			return []dto.MusicChorusDto{{Start: 1000, End: 4000}}
		},
		wordTimed: func(_ context.Context, _ int64) string {
			barrier()
			return "[1000,2000]第(1000,300)一(1300,300)"
		},
		concurrency: func() int { return 2 },
	}

	key, hash := lyricAnnotationKey(777, lines)
	jobKey, _ := svc.stateKeys(key)
	lease, err := sharedstate.AcquireLease(jobKey, lyricAnnotationJobTTL)
	if err != nil || lease == nil {
		t.Fatalf("acquire lease: %v", err)
	}
	done := make(chan error, 1)
	info := lyricAnnotationInfo{
		Title: "歌",
		Timed: []lyricTimedLine{{Start: 0, Text: lines[0]}, {Start: 1000, Text: lines[1]}},
	}
	go func() {
		done <- svc.execute(lease, key, 777, hash, lines, info, tools.AIConfig{Model: "m"}, false)
	}()

	<-planDone
	// 短暂等待 savePartial 落共享状态
	var partial *dto.MusicLyricAnnotationsDto
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		partial = svc.loadPartial(key, lines)
		if partial != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if partial == nil {
		close(releaseChunk)
		t.Fatal("expected Stage-1 partial annotation while chunks are still running")
	}
	if partial.Status != lyricAnnotationStatusPending || partial.Font != "song" || partial.Accent != "#ff6b8b" || partial.Intro != "一段导语" || partial.Outro == nil || len(partial.Moments) != 1 || len(partial.Spotlights) != 1 {
		close(releaseChunk)
		t.Fatalf("unexpected partial dto: %+v", partial)
	}

	close(releaseChunk)
	if execErr := <-done; execErr != nil {
		t.Fatalf("execute failed: %v", execErr)
	}
	// 完成后应清理 partial，并写入最终 DB 记录
	if svc.loadPartial(key, lines) != nil {
		t.Fatal("partial cache should be deleted after execute finishes")
	}
	got, svcerr := svc.get(777, lines, info, tools.AIConfig{Model: "m"}, time.Hour)
	if svcerr != nil || got.Status != lyricAnnotationStatusReady || len(got.Lines) == 0 {
		t.Fatalf("final get = %+v, err=%v", got, svcerr)
	}
}
