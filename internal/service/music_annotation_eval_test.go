package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

// 歌词标注提示词的实测评估（不在常规测试中运行），用本地数据库中的模型配置与歌单：
//
//	NEO_PROMPT_EVAL=1 DB_PATH=<数据库副本> NEO_EVAL_SONGS=<网易云歌曲 id,…> go test ./internal/service -run TestLyricAnnotationPromptEval -v -timeout 60m
//
// 对每首歌用当前提示词（current）生成 NEO_EVAL_RUNS 次标注；NEO_EVAL_BASELINE 目录下有 baseline_plan.txt 与 baseline_lines.txt（要对比的系统提示词，
// 用户消息仍用当前的标签）时加上 baseline 生成 1 次。统计 token、合规与质量指标，再让模型（开启思考）对 baseline 与 current 做 A/B 盲评
// （每对正反各评一次）；明细写入 NEO_EVAL_OUT（默认 /tmp/neo-eval/out）

type evalVariant struct {
	name    string
	locale  lyricAnnotationLocale
	context int
}

type evalSong struct {
	id    int64
	lines []string
	info  lyricAnnotationInfo
}

type evalResult struct {
	Variant          string              `json:"variant"`
	Run              int                 `json:"run"`
	Song             int64               `json:"song"`
	Title            string              `json:"title"`
	Error            string              `json:"error,omitempty"`
	Seconds          float64             `json:"seconds"`
	Calls            int64               `json:"calls"`
	PromptTokens     int64               `json:"prompt_tokens"`
	CompletionTokens int64               `json:"completion_tokens"`
	RawPhrases       int                 `json:"raw_phrases"`
	KeptPhrases      int                 `json:"kept_phrases"`
	Lines            int                 `json:"lines"`
	PhrasedLines     int                 `json:"phrased_lines"`
	RepeatedTexts    int                 `json:"repeated_texts"`
	ConsistentTexts  int                 `json:"consistent_texts"`
	HeldLines        int                 `json:"held_lines"`
	HeldShake        int                 `json:"held_shake"`
	Shake            int                 `json:"shake"`
	ShakeOffHeld     int                 `json:"shake_off_held"`
	Moments          int                 `json:"moments"`
	IntroRunes       int                 `json:"intro_runes"`
	Outro            bool                `json:"outro"`
	ChorusRanges     int                 `json:"chorus_ranges"`
	ChorusHits       int                 `json:"chorus_hits"`
	Effects          map[string]int      `json:"effects"`
	Invalid          []string            `json:"invalid,omitempty"`
	Annotation       lyricAnnotationData `json:"annotation"`
}

func TestLyricAnnotationPromptEval(t *testing.T) {
	if os.Getenv("NEO_PROMPT_EVAL") != "1" {
		t.Skip("set NEO_PROMPT_EVAL=1 to run the live prompt evaluation")
	}
	if err := repo.InitDatabase(); err != nil {
		t.Fatal(err)
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		t.Fatal("ai is not configured in the database")
	}
	out := envOr("NEO_EVAL_OUT", "/tmp/neo-eval/out")
	_ = os.MkdirAll(out, 0o755)
	runs, _ := strconv.Atoi(envOr("NEO_EVAL_RUNS", "2"))

	current, currentContext := lyricAnnotationText, lyricAnnotationChunkContext
	variants := []evalVariant{{"current", current, currentContext}}
	if dir := os.Getenv("NEO_EVAL_BASELINE"); dir != "" {
		plan, err1 := os.ReadFile(filepath.Join(dir, "baseline_plan.txt"))
		lines, err2 := os.ReadFile(filepath.Join(dir, "baseline_lines.txt"))
		if err1 == nil && err2 == nil {
			baseline := current
			baseline.PlanPrompt, baseline.LinesPrompt = string(plan), string(lines)
			variants = append([]evalVariant{{"baseline", baseline, 1000}}, variants...)
		}
	}

	ctx := context.Background()
	songs := evalLoadSongs(t, ctx)
	results := map[string][]evalResult{}
	for _, variant := range variants {
		lyricAnnotationText, lyricAnnotationChunkContext = variant.locale, variant.context
		n := runs
		if variant.name == "baseline" {
			n = 1
		}
		var mu sync.Mutex
		var wg sync.WaitGroup
		gate := make(chan struct{}, 3)
		for run := 1; run <= n; run++ {
			for _, song := range songs {
				wg.Add(1)
				go func() {
					defer wg.Done()
					gate <- struct{}{}
					defer func() { <-gate }()
					result := evalGenerate(variant.name, run, song, cfg)
					mu.Lock()
					results[variant.name] = append(results[variant.name], result)
					mu.Unlock()
					t.Logf("%s run %d %s: %.1fs in=%d out=%d phrases %d/%d err=%s", variant.name, run, result.Title, result.Seconds, result.PromptTokens, result.CompletionTokens, result.KeptPhrases, result.RawPhrases, result.Error)
				}()
			}
		}
		wg.Wait()
	}
	lyricAnnotationText, lyricAnnotationChunkContext = current, currentContext

	data, _ := json.MarshalIndent(results, "", "  ")
	_ = os.WriteFile(filepath.Join(out, "results.json"), data, 0o644)
	for _, variant := range variants {
		t.Log(evalSummary(variant.name, results[variant.name]))
	}

	// A/B 盲评：同一首歌同一轮次的两个版本，正反各评一次
	var pairs [][2]string
	if len(results["baseline"]) > 0 {
		pairs = append(pairs, [2]string{"baseline", "current"})
	}
	byKey := map[string]evalResult{}
	for name, list := range results {
		for _, result := range list {
			byKey[fmt.Sprintf("%s/%d/%d", name, result.Run, result.Song)] = result
		}
	}
	type verdict struct {
		Pair, Winner, Reason string
		Song                 int64
	}
	var verdicts []verdict
	var mu sync.Mutex
	var wg sync.WaitGroup
	gate := make(chan struct{}, 4)
	for _, pair := range pairs {
		for run := 1; run <= runs; run++ {
			if pair[0] == "baseline" && run > 1 {
				continue
			}
			for _, song := range songs {
				a, okA := byKey[fmt.Sprintf("%s/%d/%d", pair[0], run, song.id)]
				b, okB := byKey[fmt.Sprintf("%s/%d/%d", pair[1], run, song.id)]
				if !okA || !okB || a.Error != "" || b.Error != "" {
					continue
				}
				for _, swap := range []bool{false, true} {
					wg.Add(1)
					go func() {
						defer wg.Done()
						gate <- struct{}{}
						defer func() { <-gate }()
						first, second := a, b
						if swap {
							first, second = b, a
						}
						winner, reason := evalJudge(ctx, cfg, song, first.Annotation, second.Annotation)
						switch {
						case winner == "A":
							winner = first.Variant
						case winner == "B":
							winner = second.Variant
						default:
							winner = "tie"
						}
						mu.Lock()
						verdicts = append(verdicts, verdict{Pair: pair[0] + " vs " + pair[1], Winner: winner, Reason: reason, Song: song.id})
						mu.Unlock()
					}()
				}
			}
		}
	}
	wg.Wait()
	data, _ = json.MarshalIndent(verdicts, "", "  ")
	_ = os.WriteFile(filepath.Join(out, "verdicts.json"), data, 0o644)
	tally := map[string]map[string]int{}
	for _, v := range verdicts {
		if tally[v.Pair] == nil {
			tally[v.Pair] = map[string]int{}
		}
		tally[v.Pair][v.Winner]++
	}
	for pair, counts := range tally {
		t.Logf("judge %s: %v", pair, counts)
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// evalLoadSongs 与正式生成相同的输入：歌词、歌曲信息、热评、副歌片段与长音（逐行歌词向 QQ 音乐 / 酷狗借）
func evalLoadSongs(t *testing.T, ctx context.Context) []evalSong {
	s := NewMusicService()
	var songs []evalSong
	for _, field := range strings.Split(os.Getenv("NEO_EVAL_SONGS"), ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(field), 10, 64)
		if err != nil {
			continue
		}
		lines, info, _, svcerr := s.prepareLyricAnnotations(ctx, id)
		if svcerr != nil {
			t.Logf("skip song %d: %v", id, svcerr)
			continue
		}
		info.Comments = fetchNCMHotComments(ctx, id)
		info.Chorus = chorusLineRanges(info.Timed, fetchSongChorus(ctx, id))
		if !info.WordTimed {
			info.Timed = borrowHeldNotes(info.Timed, fetchWordTimedLyric(ctx, id))
		}
		songs = append(songs, evalSong{id: id, lines: lines, info: info})
	}
	if len(songs) == 0 {
		t.Fatal("no songs to evaluate (set NEO_EVAL_SONGS)")
	}
	return songs
}

func evalGenerate(variant string, run int, song evalSong, cfg tools.AIConfig) evalResult {
	result := evalResult{Variant: variant, Run: run, Song: song.id, Title: song.info.Title, Lines: len(song.lines), Effects: map[string]int{}}
	var calls, prompt, completion atomic.Int64
	service := &lyricAnnotationService{
		limiter:     &aiLimiter{},
		concurrency: func() int { return 6 },
		complete: func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
			resp, err := postChatCompletions(ctx, cfg, map[string]any{
				"model": cfg.Model, "messages": chatMessages(system, user), "temperature": lyricAnnotationTemperature,
				"stream": false, "reasoning_effort": lyricAnnotationReasoningEffort,
			})
			if err != nil {
				return "", err
			}
			defer resp.Body.Close()
			data, _ := io.ReadAll(resp.Body)
			var parsed struct {
				Usage struct {
					PromptTokens     int64 `json:"prompt_tokens"`
					CompletionTokens int64 `json:"completion_tokens"`
				} `json:"usage"`
			}
			_ = json.Unmarshal(data, &parsed)
			calls.Add(1)
			prompt.Add(parsed.Usage.PromptTokens)
			completion.Add(parsed.Usage.CompletionTokens)
			return parseChatCompletion(data)
		},
	}
	start := time.Now()
	raw, err := service.generate(song.id, cfg, song.info, song.lines)
	result.Seconds = time.Since(start).Seconds()
	result.Calls, result.PromptTokens, result.CompletionTokens = calls.Load(), prompt.Load(), completion.Load()
	if err != nil {
		result.Error = err.Error()
		return result
	}
	var rawParsed struct {
		Lines []struct {
			I       int `json:"i"`
			Phrases []struct {
				Text string `json:"text"`
			} `json:"phrases"`
		} `json:"lines"`
	}
	_ = json.Unmarshal([]byte(raw), &rawParsed)
	for _, line := range rawParsed.Lines {
		result.RawPhrases += len(line.Phrases)
		// 不是该行原文片段的短语（校验时会被丢弃）
		for _, phrase := range line.Phrases {
			if line.I < 0 || line.I >= len(song.lines) || !strings.Contains(normalizeLyricMatch(song.lines[line.I]), normalizeLyricMatch(phrase.Text)) || normalizeLyricMatch(phrase.Text) == "" {
				text := ""
				if line.I >= 0 && line.I < len(song.lines) {
					text = song.lines[line.I]
				}
				result.Invalid = append(result.Invalid, fmt.Sprintf("%d %q in %q", line.I, phrase.Text, text))
			}
		}
	}
	annotation, err := sanitizeLyricAnnotations(song.lines, song.info.Comments, raw)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Annotation = annotation
	evalMeasure(&result, song, annotation)
	return result
}

// evalMeasure 合规与质量指标（按行文本统计，与 sanitizeLyricAnnotations 的去重一致）
func evalMeasure(result *evalResult, song evalSong, annotation lyricAnnotationData) {
	held := map[string]*lyricHeldNote{}
	for _, line := range song.info.Timed {
		if line.Held != nil {
			held[line.Text] = line.Held
		}
	}
	result.HeldLines = len(held)
	type style struct{ effect, color string }
	seen := map[string][]style{}
	chorusStarts := map[int]bool{}
	for _, line := range annotation.Lines {
		if line.ChorusStart {
			for i, text := range song.lines {
				if text == line.Text {
					chorusStarts[i] = true
				}
			}
		}
		if len(line.Phrases) > 0 {
			result.PhrasedLines++
		}
		heldHere := held[line.Text]
		shakeOnHeld := false
		for _, phrase := range line.Phrases {
			result.KeptPhrases++
			result.Effects[phrase.Effect]++
			key := normalizeLyricMatch(phrase.Text)
			seen[key] = append(seen[key], style{phrase.Effect, phrase.Color})
			if phrase.Effect == "shake" {
				result.Shake++
				if heldHere != nil && strings.Contains(phrase.Text, heldHere.Text) {
					shakeOnHeld = true
				} else if len(held) > 0 {
					result.ShakeOffHeld++
				}
			}
		}
		if shakeOnHeld {
			result.HeldShake++
		}
	}
	for _, styles := range seen {
		if len(styles) < 2 {
			continue
		}
		result.RepeatedTexts++
		if !slices.ContainsFunc(styles, func(s style) bool { return s != styles[0] }) {
			result.ConsistentTexts++
		}
	}
	result.Moments = len(annotation.Moments)
	result.IntroRunes = utf8.RuneCountInString(annotation.Intro)
	result.Outro = annotation.Outro != nil
	result.ChorusRanges = len(song.info.Chorus)
	for _, chorus := range song.info.Chorus {
		for i := chorus.From - 1; i <= chorus.From+1; i++ {
			if chorusStarts[i] {
				result.ChorusHits++
				break
			}
		}
	}
}

func evalSummary(name string, results []evalResult) string {
	var n, failed int
	var seconds, in, outTokens float64
	var raw, kept, lines, phrased, repeated, consistent, heldLines, heldShake, shake, offHeld, moments, introOK, chorus, chorusHits int
	effects := map[string]int{}
	for _, r := range results {
		if r.Error != "" {
			failed++
			continue
		}
		n++
		seconds += r.Seconds
		in += float64(r.PromptTokens)
		outTokens += float64(r.CompletionTokens)
		raw, kept, lines, phrased = raw+r.RawPhrases, kept+r.KeptPhrases, lines+r.Lines, phrased+r.PhrasedLines
		repeated, consistent = repeated+r.RepeatedTexts, consistent+r.ConsistentTexts
		heldLines, heldShake, shake, offHeld = heldLines+r.HeldLines, heldShake+r.HeldShake, shake+r.Shake, offHeld+r.ShakeOffHeld
		moments += r.Moments
		if r.IntroRunes > 0 && r.IntroRunes <= 40 {
			introOK++
		}
		chorus, chorusHits = chorus+r.ChorusRanges, chorusHits+r.ChorusHits
		for effect, count := range r.Effects {
			effects[effect] += count
		}
	}
	if n == 0 {
		return name + ": no successful runs"
	}
	ratio := func(a, b int) string {
		if b == 0 {
			return "-"
		}
		return fmt.Sprintf("%.0f%%", float64(a)*100/float64(b))
	}
	invalid := 0
	for _, r := range results {
		invalid += len(r.Invalid)
	}
	return fmt.Sprintf("%s: runs=%d failed=%d avg %.1fs, input %.0f / output %.0f tokens; invalid phrases %s, kept phrases %s, phrased lines %s, consistent imagery %s, held→shake %s, shake off held %s, moments/run %.1f, intro ok %s, chorus hits %s; effects %v",
		name, n, failed, seconds/float64(n), in/float64(n), outTokens/float64(n), ratio(invalid, raw), ratio(kept, raw), ratio(phrased, lines), ratio(consistent, repeated),
		ratio(heldShake, heldLines), ratio(offHeld, shake), float64(moments)/float64(n), ratio(introOK, n), ratio(chorusHits, chorus), effects)
}

const evalJudgePrompt = `你是资深的音乐视觉演出评审。下面是同一首歌的两份歌词特效设计（A 与 B），特效会在逐字歌词播放器中随演唱呈现。
特效含义：swell 放大辉光；glow 柔光；wave 波浪跳动；shake 震颤（落在长音上是颤音）；focus 由虚到实；dissolve 唱完化为颗粒消散；shimmer 流光扫过；heartbeat 心跳双拍。
请从这些方面综合比较：情感契合（特效、颜色与歌词含义和情绪是否贴切）、选词精准（是否点亮最值得唱出来的词）、克制与层次（主歌留白、副歌浓烈，不滥用）、
意象与颜色前后一致、长音颤音等细节（〔长音〕处是否用颤音、普通句尾是否误用）、导语与时刻文字的感染力。
只输出 JSON：{"winner":"A"或"B"或"tie","reason":"一句话理由"}`

// evalJudge 让模型（开启思考）比较两份标注，返回 A / B / tie
func evalJudge(ctx context.Context, cfg tools.AIConfig, song evalSong, a, b lyricAnnotationData) (string, string) {
	user := "歌曲：" + song.info.Title + "（" + strings.Join(song.info.Artists, " / ") + "）\n\n【A】\n" + evalRender(song, a) + "\n【B】\n" + evalRender(song, b)
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	raw, err := chatCompletionWithReasoning(ctx, cfg, evalJudgePrompt, user, 0.2, "")
	if err != nil {
		return "error", err.Error()
	}
	object, err := extractJSONObject(raw)
	if err != nil {
		return "error", err.Error()
	}
	var verdict struct {
		Winner string `json:"winner"`
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal([]byte(object), &verdict)
	return verdict.Winner, verdict.Reason
}

// evalRender 把一份标注渲染成评审读的文本：逐行原文与短语（特效、颜色、字形）、行级标注、导语与时刻
func evalRender(song evalSong, data lyricAnnotationData) string {
	byText := map[string]*evalLine{}
	for i := range data.Lines {
		line := data.Lines[i]
		byText[line.Text] = &evalLine{line.Mood, line.Chorus, line.ChorusStart, line.Scene, nil}
		for _, phrase := range line.Phrases {
			item := phrase.Text + "/" + phrase.Effect
			if phrase.Color != "" {
				item += "/" + phrase.Color
			}
			if len(phrase.Styles) > 0 {
				item += "/" + strings.Join(phrase.Styles, "+")
			}
			byText[line.Text].phrases = append(byText[line.Text].phrases, item)
		}
	}
	var b strings.Builder
	if data.Intro != "" {
		b.WriteString("导语：" + data.Intro + "\n")
	}
	for i, text := range song.lines {
		fmt.Fprintf(&b, "%d: %s", i, text)
		if i < len(song.info.Timed) && song.info.Timed[i].Held != nil {
			fmt.Fprintf(&b, "〔长音：%s〕", song.info.Timed[i].Held.Text)
		}
		if line := byText[text]; line != nil {
			var marks []string
			if line.chorusStart {
				marks = append(marks, "副歌起点")
			} else if line.chorus {
				marks = append(marks, "副歌")
			}
			if line.mood != "" {
				marks = append(marks, line.mood)
			}
			if line.scene != "" {
				marks = append(marks, "场景 "+line.scene)
			}
			if len(marks) > 0 {
				b.WriteString(" ［" + strings.Join(marks, "，") + "］")
			}
			if len(line.phrases) > 0 {
				b.WriteString(" → " + strings.Join(line.phrases, "；"))
			}
		}
		b.WriteString("\n")
	}
	for _, moment := range data.Moments {
		fmt.Fprintf(&b, "时刻「%s」：%s\n", moment.Text, moment.Content)
	}
	if data.Outro != nil {
		b.WriteString("尾奏热评：" + data.Outro.Content + "\n")
	}
	return b.String()
}

type evalLine struct {
	mood                string
	chorus, chorusStart bool
	scene               string
	phrases             []string
}
