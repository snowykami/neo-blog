package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/tools"
)

// 歌词标注的生成流程（见 docs/music-player-spec.md 7.2b）：一次输出整首歌的标注太慢（输出越长越慢），拆成两步——
// 1. 全曲规划（一次请求，输出很短）：主题、方向、副歌、意象对照表、导语、时刻、字体、情绪与场景
// 2. 逐段标注（按行分段，各段并行）：每段带着规划只输出短语，意象对照表保证各段的特效与颜色一致
// 两步的结果合并成与单次生成相同的 JSON，再经过同一套校验（sanitizeLyricAnnotations）

const (
	// 每段大约多少行、最多分几段（并行数还受全局 AI 并发数限制）
	lyricAnnotationChunkLines = 20
	lyricAnnotationMaxChunks  = 6
	// 某一段失败时的重试次数；仍失败时这一段没有短语，不影响其他段
	lyricAnnotationChunkRetries = 1
	// 全曲规划失败时的重试次数；规划是第一步，仍失败时整个任务失败（进入冷却）
	lyricAnnotationPlanRetries = 1
)

// lyricAnnotationChunkContext 逐段标注时附带的本段前后的行数（只作上下文，节约输入；全曲的一致性由规划中的意象保证）
var lyricAnnotationChunkContext = 2

// lyricAnnotationPlanRetryDelay 全曲规划重试前的等待（网络抖动、接口限流时稍后再试）；等待期间不占用并发名额，测试时可改为 0
var lyricAnnotationPlanRetryDelay = 2 * time.Second

// lyricAnnotationPlan 全曲规划中逐段标注需要参考的部分（其余字段原样并入最终结果）
type lyricAnnotationPlan struct {
	Theme     string `json:"theme"`
	Direction string `json:"direction"`
	Font      string `json:"font"`
	Pace      string `json:"pace"`
	// 聚光灯句子的行号：逐段标注时在这些句子（含重复出现的行）上标 spotlight，让模型少给它们叠特效
	Spotlights []int `json:"spotlights"`
	Imagery    []struct {
		Text   string `json:"text"`
		Effect string `json:"effect"`
		Color  string `json:"color"`
	} `json:"imagery"`
	Lines []struct {
		I           int    `json:"i"`
		Mood        string `json:"mood"`
		Chorus      bool   `json:"chorus"`
		ChorusStart bool   `json:"chorus_start"`
		Scene       string `json:"scene"`
	} `json:"lines"`
	// 自定义粒子：没有选图标库图标的，与逐段标注并行请模型画出来
	Sprites []lyricSpriteRequest `json:"sprites"`
}

// lyricAnnotationChunks 把 n 行分成若干段（含首尾的行号区间），段数为 ceil(n / 每段行数)，不超过上限
func lyricAnnotationChunks(n int) [][2]int {
	if n <= 0 {
		return nil
	}
	count := min((n+lyricAnnotationChunkLines-1)/lyricAnnotationChunkLines, lyricAnnotationMaxChunks)
	size := (n + count - 1) / count
	var chunks [][2]int
	for from := 0; from < n; from += size {
		chunks = append(chunks, [2]int{from, min(from+size, n) - 1})
	}
	return chunks
}

// extractJSONObject 模型回复中的 JSON 对象（去掉前后的说明文字或代码块标记）
func extractJSONObject(raw string) (string, error) {
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return "", errors.New("no json object in response")
	}
	return raw[start : end+1], nil
}

// call 排队等待全局 AI 并发名额（与 AI 摘要共用），拿到后才开始计算超时
func (a *lyricAnnotationService) call(cfg tools.AIConfig, system, user string) (string, error) {
	_ = a.limiter.acquire(context.Background(), a.concurrency, false, nil)
	defer a.limiter.release()
	ctx, cancel := context.WithTimeout(context.Background(), lyricAnnotationTimeout)
	defer cancel()
	return a.complete(ctx, cfg, system, user)
}

// plan 全曲规划：调用出错、回复中没有 JSON 或 JSON 解析失败时，等待 lyricAnnotationPlanRetryDelay 后重试
func (a *lyricAnnotationService) plan(id int64, cfg tools.AIConfig, info lyricAnnotationInfo, lines []string) (string, lyricAnnotationPlan, error) {
	user := buildLyricAnnotationPrompt(info, lines)
	var err error
	for attempt := 0; attempt <= lyricAnnotationPlanRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(lyricAnnotationPlanRetryDelay)
		}
		var raw, planJSON string
		raw, err = a.call(cfg, lyricAnnotationText.PlanPrompt, user)
		if err == nil {
			planJSON, err = extractJSONObject(raw)
		}
		var plan lyricAnnotationPlan
		if err == nil {
			err = json.Unmarshal([]byte(planJSON), &plan)
		}
		if err == nil {
			return planJSON, plan, nil
		}
		logrus.Warnf("lyric annotation plan for song %d failed (attempt %d): %v", id, attempt+1, err)
	}
	return "", lyricAnnotationPlan{}, fmt.Errorf("plan: %w", err)
}

// generate 先规划、再并行逐段标注，返回合并后的标注 JSON（交给 sanitizeLyricAnnotations 校验）
func (a *lyricAnnotationService) generate(id int64, cfg tools.AIConfig, info lyricAnnotationInfo, lines []string) (string, error) {
	start := time.Now()
	planJSON, plan, err := a.plan(id, cfg, info, lines)
	if err != nil {
		return "", err
	}
	planned := time.Now()

	chunks := lyricAnnotationChunks(len(lines))
	results := make([]string, len(chunks))
	var wg sync.WaitGroup
	// 画自定义粒子（与逐段标注并行）：失败时这个粒子没有路径，校验时丢弃，用到它的行改用备用场景
	drawn := map[string]json.RawMessage{}
	var drawnMu sync.Mutex
	for index, sprite := range plan.Sprites {
		if index >= lyricSpriteMax || !sprite.needsDrawing() {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			paths, err := a.drawLyricSprite(cfg, sprite.Image, lyricSpriteLine(plan, lines, sprite.Name))
			if err != nil {
				logrus.Warnf("lyric annotation sprite %q for song %d failed: %v", sprite.Name, id, err)
				return
			}
			drawnMu.Lock()
			drawn[sprite.Name] = paths
			drawnMu.Unlock()
		}()
	}
	for index, chunk := range chunks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			user := buildLyricAnnotationLinesPrompt(info, lines, plan, chunk[0], chunk[1], len(chunks))
			for attempt := 0; attempt <= lyricAnnotationChunkRetries; attempt++ {
				raw, err := a.call(cfg, lyricAnnotationText.LinesPrompt, user)
				object := ""
				if err == nil {
					object, err = extractJSONObject(raw)
				}
				if err == nil && !json.Valid([]byte(object)) {
					err = errors.New("invalid json")
				}
				if err == nil {
					results[index] = object
					return
				}
				logrus.Warnf("lyric annotation chunk %d-%d for song %d failed (attempt %d): %v", chunk[0], chunk[1], id, attempt+1, err)
			}
		}()
	}
	wg.Wait()
	logrus.Infof("lyric annotation for song %d: %d lines, plan %.1fs, %d chunks %.1fs, %d sprites drawn",
		id, len(lines), planned.Sub(start).Seconds(), len(chunks), time.Since(planned).Seconds(), len(drawn))
	merged, err := mergeLyricAnnotationResults(planJSON, chunks, results)
	if err != nil || len(drawn) == 0 {
		return merged, err
	}
	return attachLyricSpritePaths(merged, drawn)
}

// lyricSpriteLine 用到这个粒子的第一行歌词（画图标时作为上下文），没有时为空
func lyricSpriteLine(plan lyricAnnotationPlan, lines []string, name string) string {
	for _, line := range plan.Lines {
		if line.Scene == "custom:"+name && line.I >= 0 && line.I < len(lines) {
			return lines[line.I]
		}
	}
	return ""
}

// attachLyricSpritePaths 把画好的路径并入合并后的 JSON（sprites 中同名的项）
func attachLyricSpritePaths(merged string, drawn map[string]json.RawMessage) (string, error) {
	var object map[string]any
	if err := json.Unmarshal([]byte(merged), &object); err != nil {
		return "", err
	}
	sprites, _ := object["sprites"].([]any)
	for _, item := range sprites {
		sprite, ok := item.(map[string]any)
		name, _ := sprite["name"].(string)
		if paths, found := drawn[name]; ok && found {
			sprite["paths"] = paths
		}
	}
	data, err := json.Marshal(object)
	return string(data), err
}

// mergeLyricAnnotationResults 把规划与各段的短语合并成单次生成的 JSON 格式：规划的行级标注（副歌、情绪、场景）与
// 各段的短语按行号合并；各段只取自己范围内的行，规划里的短语（不应出现）忽略
func mergeLyricAnnotationResults(planJSON string, chunks [][2]int, results []string) (string, error) {
	var merged map[string]any
	if err := json.Unmarshal([]byte(planJSON), &merged); err != nil {
		return "", err
	}
	byLine := map[int]map[string]any{}
	if planLines, ok := merged["lines"].([]any); ok {
		for _, item := range planLines {
			line, ok := item.(map[string]any)
			index, isNumber := line["i"].(float64)
			if !ok || !isNumber {
				continue
			}
			delete(line, "phrases")
			byLine[int(index)] = line
		}
	}
	for chunkIndex, result := range results {
		if result == "" {
			continue
		}
		var parsed struct {
			Lines []struct {
				I       int   `json:"i"`
				Phrases []any `json:"phrases"`
			} `json:"lines"`
		}
		if json.Unmarshal([]byte(result), &parsed) != nil {
			continue
		}
		from, to := chunks[chunkIndex][0], chunks[chunkIndex][1]
		for _, item := range parsed.Lines {
			if item.I < from || item.I > to || len(item.Phrases) == 0 {
				continue
			}
			line := byLine[item.I]
			if line == nil {
				line = map[string]any{"i": item.I}
				byLine[item.I] = line
			}
			existing, _ := line["phrases"].([]any)
			line["phrases"] = append(existing, item.Phrases...)
		}
	}
	indexes := make([]int, 0, len(byLine))
	for index := range byLine {
		indexes = append(indexes, index)
	}
	sort.Ints(indexes)
	lines := make([]any, 0, len(indexes))
	for _, index := range indexes {
		lines = append(lines, byLine[index])
	}
	merged["lines"] = lines
	data, err := json.Marshal(merged)
	return string(data), err
}

// buildLyricAnnotationLinesPrompt 逐段标注的用户消息：歌曲信息、全曲规划（方向、意象、本段的副歌与情绪）、
// 本段歌词与前后 lyricAnnotationChunkContext 行（上下文），以及本次范围
func buildLyricAnnotationLinesPrompt(info lyricAnnotationInfo, lines []string, plan lyricAnnotationPlan, from, to, chunks int) string {
	text := lyricAnnotationText
	var b strings.Builder
	writeLyricAnnotationSong(&b, info, false)

	b.WriteString(text.Plan)
	if plan.Theme != "" {
		b.WriteString(text.Theme + plan.Theme + "\n")
	}
	if plan.Direction != "" {
		b.WriteString(text.Direction + plan.Direction + "\n")
	}
	if plan.Font != "" {
		b.WriteString(text.Font + plan.Font + "\n")
	}
	if plan.Pace != "" {
		b.WriteString(text.Pace + plan.Pace + "\n")
	}
	if len(plan.Imagery) > 0 {
		b.WriteString(text.Imagery)
		for _, item := range plan.Imagery {
			color := item.Color
			if color == "" {
				color = text.NoColor
			}
			fmt.Fprintf(&b, text.ImageryItem, item.Text, item.Effect, color)
		}
	}
	var marks []string
	// 聚光灯按文字生效：本段中与聚光灯句子文字相同的行都标上
	spotlights := lyricSpotlightTexts(lines, plan.Spotlights)
	isSpotlight := func(i int) bool { return i >= 0 && i < len(lines) && slices.Contains(spotlights, lines[i]) }
	spotlightMarked := map[int]bool{}
	for _, line := range plan.Lines {
		if line.I < from || line.I > to {
			continue
		}
		var parts []string
		if isSpotlight(line.I) {
			parts = append(parts, text.Spotlight)
			spotlightMarked[line.I] = true
		}
		if line.ChorusStart {
			parts = append(parts, text.ChorusStart)
		} else if line.Chorus {
			parts = append(parts, text.ChorusLine)
		}
		if line.Mood != "" {
			parts = append(parts, text.Mood+line.Mood)
		}
		if len(parts) > 0 {
			marks = append(marks, fmt.Sprintf(text.Mark, line.I, strings.Join(parts, ", ")))
		}
	}
	// 聚光灯的行没有其他标注时单独列出
	for i := from; i <= to; i++ {
		if isSpotlight(i) && !spotlightMarked[i] {
			marks = append(marks, fmt.Sprintf(text.Mark, i, text.Spotlight))
		}
	}
	if len(marks) > 0 {
		b.WriteString(text.Marks + strings.Join(marks, ""))
	}
	b.WriteString(text.PlanEnd)

	writeLyricAnnotationLines(&b, info, lines, from-lyricAnnotationChunkContext, to+lyricAnnotationChunkContext)
	fmt.Fprintf(&b, text.Range, from, to, chunks, max(1, (lyricAnnotationMaxPhraseFonts+chunks-1)/chunks))
	return b.String()
}
