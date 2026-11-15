package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/tools"
)

const (
	vocalAlignMinCoveragePercent = 60
	vocalAlignMaxCommentHints    = 6
)

var singerJSONModeUnsupported sync.Map // endpoint\x00model -> true

// runCompactVocalAligner 执行轻量紧凑下标对齐阶段（Layer 3）
// 前置条件：必须已通过外部权威搜索命中（candidate != nil），或歌词自身存在内联/TTML多声部标记。
func (a *lyricSingerService) runCompactVocalAligner(
	ctx context.Context,
	cfg tools.AIConfig,
	input *lyricSingerInput,
	candidate *VocalEvidenceCandidate,
	comments []lyricAnnotationComment,
) (dto.LyricSingerData, string, error) {
	if input == nil || len(input.Tasks) == 0 {
		return dto.LyricSingerData{Empty: true}, cfg.Model, nil
	}
	if candidate == nil && !input.HasInlineMarkers && !input.MultiAgentSys {
		return dto.LyricSingerData{Empty: true}, "pipeline:no_evidence", nil
	}

	systemPrompt := buildCompactVocalAlignerSystemPrompt()
	userPrompt := buildCompactVocalAlignerUserPrompt(input, candidate, comments)

	raw, err := a.callCompactVocalAlignerLLM(ctx, cfg, systemPrompt, userPrompt)
	if err != nil {
		return dto.LyricSingerData{}, cfg.Model, err
	}

	parsed, err := decodeCompactVocalAlignerJSON(raw)
	if err != nil {
		// JSON 解析偶发畸形时按纠正提示重试一次
		retryPrompt := userPrompt + "\n\n【格式纠正】上一次回复不是合法 JSON，请严格只输出一个符合 Schema 的纯 JSON 对象。"
		rawRetry, retryErr := a.callCompactVocalAlignerLLM(ctx, cfg, systemPrompt, retryPrompt)
		if retryErr != nil {
			return dto.LyricSingerData{}, cfg.Model, err
		}
		parsed, err = decodeCompactVocalAlignerJSON(rawRetry)
		if err != nil {
			return dto.LyricSingerData{}, cfg.Model, err
		}
	}

	// 若模型未判空且映射数组长度明显残缺（<75%），附加行数修正提示重试一次
	expectedLen := len(input.Tasks)
	if !parsed.Empty && len(parsed.Lines) == 0 && len(parsed.Mapping)*4 < expectedLen*3 {
		retryPrompt := fmt.Sprintf(
			"%s\n\n【长度纠正】目标歌词共 %d 行（编号 1 到 %d），但你上次仅返回了 %d 项 mapping。请严格输出长度恰好为 %d 的 mapping 字符串数组（每行依次对应一个歌手 id 或 \"\"）。",
			userPrompt, expectedLen, expectedLen, len(parsed.Mapping), expectedLen,
		)
		if rawRetry, retryErr := a.callCompactVocalAlignerLLM(ctx, cfg, systemPrompt, retryPrompt); retryErr == nil {
			if parsedRetry, decErr := decodeCompactVocalAlignerJSON(rawRetry); decErr == nil {
				if parsedRetry.Empty || len(parsedRetry.Mapping) > len(parsed.Mapping) || len(parsedRetry.Lines) > 0 {
					parsed = parsedRetry
				}
			}
		}
	}

	data, err := sanitizeLyricSingerRespStruct(parsed, input)
	if err != nil {
		return dto.LyricSingerData{}, cfg.Model, err
	}
	if data.Empty {
		return data, cfg.Model, nil
	}

	// 外部权威证据路径覆盖率防线：有效归属行数须达到总行数 >= 60%（5 行以上曲目）
	if candidate != nil && !input.HasInlineMarkers && !input.MultiAgentSys && expectedLen >= 5 {
		if len(data.Lines)*100 < expectedLen*vocalAlignMinCoveragePercent {
			logrus.Warnf("vocal aligner low coverage for song %d (%s): aligned=%d/%d (<%d%%), falling back to empty",
				input.Track.ID, input.Source, len(data.Lines), expectedLen, vocalAlignMinCoveragePercent)
			return dto.LyricSingerData{Empty: true}, "pipeline:low_coverage", nil
		}
	}

	evSource := strings.TrimSpace(parsed.EvidenceSource)
	if evSource == "" && candidate != nil {
		evSource = candidate.SourceName
	}
	evURL := strings.TrimSpace(parsed.EvidenceURL)
	if evURL == "" && candidate != nil {
		evURL = candidate.URL
	}
	logrus.Infof("vocal aligner aligned song %d (%s): singers=%d lines=%d/%d evidence=%s (%s)",
		input.Track.ID, input.Source, len(data.Singers), len(data.Lines), expectedLen, evSource, evURL)

	return data, cfg.Model, nil
}

func (a *lyricSingerService) callCompactVocalAlignerLLM(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
	if a != nil && a.alignComplete != nil {
		return a.alignComplete(ctx, cfg, system, user)
	}
	return singerJSONCompletion(ctx, cfg, system, user, lyricSingerTemperature, lyricSingerReasoning)
}

func decodeCompactVocalAlignerJSON(raw string) (*lyricSingerAIResp, error) {
	jsonStr, err := extractJSONObject(raw)
	if err != nil {
		return nil, err
	}
	var parsed lyricSingerAIResp
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

func buildCompactVocalAlignerSystemPrompt() string {
	colorKeys := make([]string, 0, 12)
	for i, item := range lyricAnnotationPalette {
		if i >= 16 {
			break
		}
		colorKeys = append(colorKeys, fmt.Sprintf("%s(%s)", item.Key, item.Hint))
	}

	return fmt.Sprintf(`你是一位极度严谨的 ACG 与多歌手歌词声部对齐专家，严格遵循【零幻觉（Zero Hallucination）】原则。
你的唯一任务是：根据已经核实并清洗好的【参考声部段落】或【原歌词内联声部标注】，将【目标原歌词】从第 1 行到第 N 行逐行映射给正确的演唱者 ID。

核心原则与硬性约束：
1. 【严格零幻觉】：禁止无中生有猜测歌手！如果参考声部资料存在明显错位无法对齐，或原歌词实为独唱且仅存在制作人员信息（作词/作曲/编曲/制作人等），必须直接返回 {"empty": true}。
2. 【严禁片段化切分】：同一角色连续演唱的段落，mapping 中相邻行必须连续保持同一 ID；严禁没有参考证据支持就逐句轮流拆分歌手。
3. 【跨语言/跨版本对齐】：如果参考资料是罗马音/中文标注而目标歌词是日文原词（或顺序略有前缀/间奏差异），请根据段落停顿、行数节奏与发音顺序准确对齐到每一行。
4. 【角色规范】：
   - 每位独立演唱者赋予短 ID（v1, v2, ...），role 设为 "person"。
   - 若存在全员合唱/齐唱/重唱段落（如 合唱 / All / 全员），额外定义组合 ID（如 g1），role 设为 "group"，align 必须为 "center"，并在 members 中列出包含的个人 ID。
   - 歌手名保持干净简洁，不带方括号与企划缩写后缀；若歌手互为搭档/对唱角色，"person" 歌手的 align 应合理在 "left" 和 "right" 间交替分配以形成左右对话排版。
   - color 必须为每位歌手选择互不重复的颜色 key，可选主题色：%s。
5. 【紧凑输出 Schema】：为节省输出时间并杜绝篡改原文，**不要复述原歌词文字**，严格只输出单个合法 JSON 对象：
   - 若不构成可信多声部对齐：{"empty": true}
   - 若对齐成功：
     {
       "empty": false,
       "evidence_source": "来源站点或内置标注",
       "evidence_url": "来源链接（无则留空）",
       "singers": [
         {"id": "v1", "name": "角色A", "role": "person", "color": "ocean", "align": "left"},
         {"id": "v2", "name": "角色B", "role": "person", "color": "cherry-blossom", "align": "right"},
         {"id": "g1", "name": "合唱", "role": "group", "color": "starry-blue", "align": "center", "members": ["v1", "v2"]}
       ],
       "mapping": ["v1", "v1", "v2", "g1"]
     }
   - mapping 数组长度必须与目标歌词总行数 N 一一对应（第 k 个元素对应编号 k+1 的歌词行）；对于作词/作曲/编曲等非演唱信息行填 ""。`, strings.Join(colorKeys, ", "))
}

func buildCompactVocalAlignerUserPrompt(
	input *lyricSingerInput,
	candidate *VocalEvidenceCandidate,
	comments []lyricAnnotationComment,
) string {
	var b strings.Builder

	if input.Track != nil {
		fmt.Fprintf(&b, "歌曲名：%s\n", input.Track.Name)
		if len(input.Track.Aliases) > 0 {
			fmt.Fprintf(&b, "别名：%s\n", strings.Join(input.Track.Aliases, " / "))
		}
		if len(input.Track.Artists) > 0 {
			fmt.Fprintf(&b, "艺人元数据：%s\n", strings.Join(input.Track.Artists, ", "))
		}
		if input.Track.Album != "" {
			fmt.Fprintf(&b, "专辑：%s\n", input.Track.Album)
		}
	}

	if len(input.Credits) > 0 {
		fmt.Fprintf(&b, "已知制作人员/元信息（勿将其识别为歌手）：%s\n", strings.Join(input.Credits, " | "))
	}

	if len(input.Agents) > 0 {
		b.WriteString("\n【TTML 声明声部清单】\n")
		for _, ag := range input.Agents {
			fmt.Fprintf(&b, "- id=%s name=%s role=%s pos=%s members=%s\n",
				ag.ID, ag.Name, ag.Role, ag.Position, strings.Join(ag.Members, ","))
		}
	}

	if candidate != nil && strings.TrimSpace(candidate.CleanContent) != "" {
		fmt.Fprintf(&b, "\n【已核验外部权威声部资料（%s）】\n", candidate.SourceName)
		if candidate.URL != "" {
			fmt.Fprintf(&b, "URL: %s\n", candidate.URL)
		}
		b.WriteString(clipRunes(candidate.CleanContent, 6500))
		b.WriteByte('\n')
	}

	if len(comments) > 0 {
		added := 0
		for _, c := range comments {
			txt := strings.TrimSpace(c.Content)
			if txt == "" {
				continue
			}
			if added == 0 {
				b.WriteString("\n【辅助参考评论（仅作人名印证）】\n")
			}
			fmt.Fprintf(&b, "- %s\n", clipRunes(txt, 140))
			added++
			if added >= vocalAlignMaxCommentHints {
				break
			}
		}
	}

	fmt.Fprintf(&b, "\n【目标原歌词（共 %d 行，请输出长度恰好为 %d 的 mapping 数组）】\n", len(input.Tasks), len(input.Tasks))
	for _, task := range input.Tasks {
		var tags []string
		if task.RawAgent != "" {
			tags = append(tags, "agent="+task.RawAgent)
		}
		if task.Bg {
			tags = append(tags, "和声/bg")
		}
		if len(tags) > 0 {
			fmt.Fprintf(&b, "%d. [%s] %s\n", task.Index, strings.Join(tags, ", "), task.Text)
		} else {
			fmt.Fprintf(&b, "%d. %s\n", task.Index, task.Text)
		}
	}

	return b.String()
}

// singerJSONCompletion 发送带可选 response_format=json_object 与关闭深度思考的请求，并自动处理不兼容接口的 400 回退
func singerJSONCompletion(ctx context.Context, cfg tools.AIConfig, system, user string, temperature float64, effort string) (string, error) {
	finish, err := beginLLMCall(ctx, cfg.Model)
	if err != nil {
		return "", err
	}

	endpointModelKey := strings.TrimSpace(cfg.BaseURL) + "\x00" + strings.TrimSpace(cfg.Model)
	useJSONMode := true
	if _, unsupported := singerJSONModeUnsupported.Load(endpointModelKey); unsupported {
		useJSONMode = false
	}
	useEffort := strings.TrimSpace(strings.ToLower(effort))
	if _, unsupported := singerReasoningUnsupported.Load(endpointModelKey + "\x00" + useEffort); unsupported {
		useEffort = ""
	}

	sendOnce := func(withJSON bool, eff string) ([]byte, error) {
		payload := map[string]any{
			"model":       cfg.Model,
			"messages":    llmclient.ChatMessages(system, user),
			"temperature": temperature,
			"stream":      false,
		}
		if withJSON {
			payload["response_format"] = map[string]string{"type": "json_object"}
		}
		if eff != "" {
			if strings.Contains(strings.ToLower(cfg.BaseURL), "deepseek.com") {
				if eff == "none" {
					payload["thinking"] = map[string]any{"type": "disabled"}
				} else {
					payload["thinking"] = map[string]any{"type": "enabled"}
				}
			} else {
				payload["reasoning_effort"] = eff
			}
		}

		resp, reqErr := llmclient.PostChatCompletions(ctx, cfg, payload)
		if reqErr != nil {
			return nil, reqErr
		}
		defer resp.Body.Close()
		return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	}

	data, callErr := sendOnce(useJSONMode, useEffort)
	var statusErr *llmclient.StatusError
	if errors.As(callErr, &statusErr) && statusErr.Code == http.StatusBadRequest {
		msgLower := strings.ToLower(statusErr.Message)
		retried := false
		if useJSONMode && (strings.Contains(msgLower, "response_format") || strings.Contains(msgLower, "json_object") || useEffort == "") {
			singerJSONModeUnsupported.Store(endpointModelKey, true)
			useJSONMode = false
			retried = true
		}
		if useEffort != "" && (strings.Contains(msgLower, "reasoning") || strings.Contains(msgLower, "thinking") || !retried) {
			singerReasoningUnsupported.Store(endpointModelKey+"\x00"+useEffort, true)
			useEffort = ""
			retried = true
		}
		if retried {
			data, callErr = sendOnce(useJSONMode, useEffort)
			// 若仍 400 且尚未关闭 JSON mode，兜底全去掉参数再试一次
			if errors.As(callErr, &statusErr) && statusErr.Code == http.StatusBadRequest && (useJSONMode || useEffort != "") {
				if useJSONMode {
					singerJSONModeUnsupported.Store(endpointModelKey, true)
					useJSONMode = false
				}
				if useEffort != "" {
					singerReasoningUnsupported.Store(endpointModelKey+"\x00"+effort, true)
					useEffort = ""
				}
				data, callErr = sendOnce(false, "")
			}
		}
	}

	var usage llmUsage
	var out string
	if callErr == nil {
		usage = llmclient.ParseUsageDetail(data)
		out, callErr = llmclient.ParseChatCompletion(data)
	}
	finish(usage, callErr)
	return out, callErr
}
