package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

const (
	aiWriteMetaTimeout        = 60 * time.Second
	aiWriteMetaHeadRunes      = 4500
	aiWriteMetaTailRunes      = 1500
	aiWriteMetaMinRunes       = 8
	aiTitleMaxRunes           = 80
	aiTitleMaxCount           = 5
	aiTaxonomyMaxPromptLabels = 200
	aiTaxonomyMaxLabels       = 5
	aiTaxonomyMaxNewLabels    = 3
	aiTaxonomyLabelNameMax    = 24
	aiTaxonomyLabelSlugMax    = 48
)

const aiSuggestTitlesSystemPrompt = `# 角色
你是个人博客编辑器的标题助手。根据作者正在撰写的文章或页面内容，给出 4 个角度互补、克制自然的候选标题。

# 标题要求
1. 语言一致：中文内容用中文（简繁跟随原文），英文内容用英文，专有名词与命令大小写照原文。
2. 角度互补（4 个标题各自侧重不同切入点，不要只是同义词替换）：
   - 直陈核心结论或做法；
   - 从具体问题、场景或踩坑现象切入；
   - 凝练短标题（适合归档列表跳读）；
   - 带作者口吻的自然表达（如有作者语言习惯则贴合其习惯）。
3. 去掉 AI 腔与营销味：
   - 严禁“浅谈 / 初探 / 深度解析 / 全解析 / 全面梳理 / 一文读懂 / 保姆级教程 / 终极指南 / 避坑指南”等套路词；
   - 严禁震惊体、夸张感叹号和无意义的冒号双标题（如“从零到一：XXX 的探索与实践”）；
   - 不要加书名号《》或外层引号，不要加序号。
4. 忠实原文：只提原文确实写到的技术栈、概念或经历，不编造未出现的结论；长度控制在 6～36 字（英文 4～14 词）。
5. 严格只输出一个 JSON 对象，格式如下，不要输出任何额外说明或代码块：
{"titles": ["候选标题1", "候选标题2", "候选标题3", "候选标题4"]}`

const aiSuggestTaxonomySystemPrompt = `# 角色
你是个人博客的分类与标签整理助手。根据文章内容，优先从站点已有的分类和标签中挑选最匹配的项；只有当核心主题词在现有标签库中确实缺失时，才少量建议新建标签。

# 选择规则
1. 分类（category_id）：
   - 只能从 <categories> 给出的已有分类 ID 中选最贴切的 1 个整数 ID；
   - 如果现有分类列表为空，或没有任何一个分类贴切，填 null（不要强凑，分类用于全站主导航）。
2. 已有标签（label_ids）：
   - 从 <existing_labels> 中选 1～5 个真正切题的整数 ID，按相关度从高到低排列；没有合适的可填 []。
3. 建议新建标签（new_labels）：
   - 仅当文章的核心技术栈、工具名或明确主题在 <existing_labels> 中完全没有对应项时，才补充 0～3 个；已有同义或大小写相近的标签（如已有 Go 就不要再建 Golang）一律直接选已有标签，不要新建！
   - 标签名简短通用（2～16 字，如 "OpenTelemetry"、"SQLite"、"骑行"），不要生造长词组（如“数据库性能优化实践”）；
   - slug 使用全小写英文与连字符 kebab-case（只含 a-z、0-9、-，且不能是纯数字，中文标签请转成对应的常用英文词或拼音连字符，如 "opentelemetry"、"cycling"）。
4. 严格只输出一个 JSON 对象，不要输出任何额外说明：
{"category_id": 1, "label_ids": [3, 8], "new_labels": [{"name": "标签名", "slug": "label-slug"}]}`

// SuggestTitles 为文章或独立页面生成候选标题
func (s *AIWriteService) SuggestTitles(ctx context.Context, targetType string, targetID uint, req *dto.AITitlesReq) (*dto.AITitlesResp, *errs.ServiceError) {
	if targetType != constant.TargetTypePost && targetType != constant.TargetTypePage {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	ownerID, svcerr := NewEditSessionService().editableTargetOwner(ctx, targetType, targetID)
	if svcerr != nil {
		return nil, svcerr
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewBadRequest("ai_not_configured")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	if len(req.Document) > aiWriteMaxDocumentBytes {
		return nil, errs.NewBadRequest("ai_input_too_long")
	}

	title, desc, body, svcerr := resolveTargetText(targetType, targetID, req.Title, req.Description, req.Document)
	if svcerr != nil {
		return nil, svcerr
	}
	if utf8.RuneCountInString(body)+utf8.RuneCountInString(desc) < aiWriteMetaMinRunes {
		return nil, errs.NewBadRequest("content_too_short")
	}

	habit, err := repo.User.GetAIWritingHabit(ownerID)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	systemPrompt := aiSuggestTitlesSystemPrompt
	if style := tools.GetAIWritingStyle(); style != "" {
		systemPrompt += "\n\n# 站点写作风格\n" + aiWritingStyleIntro + style
	}
	if habit != "" {
		systemPrompt += "\n\n# 作者的语言习惯\n" + aiWritingHabitIntro + habit
	}

	kind := "文章"
	if targetType == constant.TargetTypePage {
		kind = "独立页面"
	}
	userPrompt := fmt.Sprintf("<target_type>%s</target_type>\n<current_title>%s</current_title>\n<description>%s</description>\n<content>\n%s\n</content>",
		kind, orEmpty(title), orEmpty(desc), clipHeadTail(body, aiWriteMetaHeadRunes, aiWriteMetaTailRunes))

	raw, svcerr := s.callComplete(ctx, cfg, systemPrompt, userPrompt, 0.6)
	if svcerr != nil {
		return nil, svcerr
	}
	titles := parseSuggestedTitles(raw)
	if len(titles) == 0 {
		return nil, errs.NewBadRequest("ai_empty_response")
	}
	return &dto.AITitlesResp{Titles: titles}, nil
}

// SuggestPostTaxonomy 为文章推荐已有分类、已有标签及可选新建标签
func (s *AIWriteService) SuggestPostTaxonomy(ctx context.Context, postID uint, req *dto.AITaxonomyReq) (*dto.AITaxonomyResp, *errs.ServiceError) {
	if _, svcerr := NewEditSessionService().editableTargetOwner(ctx, constant.TargetTypePost, postID); svcerr != nil {
		return nil, svcerr
	}
	cfg := tools.GetAIConfig()
	if !cfg.Configured() {
		return nil, errs.NewBadRequest("ai_not_configured")
	}
	if svcerr := checkSiteAIBudget(time.Now()); svcerr != nil {
		return nil, svcerr
	}
	if len(req.Document) > aiWriteMaxDocumentBytes {
		return nil, errs.NewBadRequest("ai_input_too_long")
	}

	title, desc, body, svcerr := resolveTargetText(constant.TargetTypePost, postID, req.Title, req.Description, req.Document)
	if svcerr != nil {
		return nil, svcerr
	}
	if utf8.RuneCountInString(title)+utf8.RuneCountInString(desc)+utf8.RuneCountInString(body) < aiWriteMetaMinRunes {
		return nil, errs.NewBadRequest("content_too_short")
	}

	categories, err := repo.Post.ListCategories()
	if err != nil {
		return nil, errs.Internal("failed_to_list_targets", err)
	}
	labels, err := repo.Label.ListLabels()
	if err != nil {
		return nil, errs.Internal("failed_to_list_targets", err)
	}

	var catBuf strings.Builder
	if len(categories) == 0 {
		catBuf.WriteString("（暂无分类）")
	} else {
		for _, c := range categories {
			fmt.Fprintf(&catBuf, "- %d | %s | %s\n", c.ID, c.Slug, c.Name)
		}
	}
	var labelBuf strings.Builder
	if len(labels) == 0 {
		labelBuf.WriteString("（暂无标签）")
	} else {
		limit := min(len(labels), aiTaxonomyMaxPromptLabels)
		for _, l := range labels[:limit] {
			fmt.Fprintf(&labelBuf, "- %d | %s | %s\n", l.ID, l.Slug, l.Name)
		}
	}

	userPrompt := fmt.Sprintf("<categories>\n%s</categories>\n\n<existing_labels>\n%s</existing_labels>\n\n<title>%s</title>\n<description>%s</description>\n<content>\n%s\n</content>",
		catBuf.String(), labelBuf.String(), orEmpty(title), orEmpty(desc), clipHeadTail(body, aiWriteMetaHeadRunes, aiWriteMetaTailRunes))

	raw, svcerr := s.callComplete(ctx, cfg, aiSuggestTaxonomySystemPrompt, userPrompt, 0.3)
	if svcerr != nil {
		return nil, svcerr
	}
	return normalizeSuggestedTaxonomy(raw, categories, labels)
}

func (s *AIWriteService) callComplete(ctx context.Context, cfg tools.AIConfig, systemPrompt, userPrompt string, temperature float64) (string, *errs.ServiceError) {
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	callCtx, cancel := context.WithTimeout(ctx, aiWriteMetaTimeout)
	defer cancel()

	if err := s.limiter.Acquire(callCtx, s.concurrency, true, nil); err != nil {
		if errors.Is(callCtx.Err(), context.DeadlineExceeded) {
			return "", errs.NewBadRequest("ai_timeout")
		}
		return "", errs.Internal("ai_interrupted", err)
	}
	defer s.limiter.Release()

	completeFn := s.complete
	if completeFn == nil {
		completeFn = chatCompletionWithReasoning
	}
	raw, err := completeFn(withLLMPurpose(callCtx, constant.LLMPurposeWriting, userID), cfg, systemPrompt, userPrompt, temperature, "low")
	if err != nil {
		var svcerr *errs.ServiceError
		if errors.As(err, &svcerr) {
			return "", svcerr
		}
		if errors.Is(callCtx.Err(), context.DeadlineExceeded) {
			return "", errs.NewBadRequest("ai_timeout")
		}
		logrus.WithContext(ctx).Warnf("ai write meta completion failed: %v", err)
		return "", errs.Internal("ai_empty_response", err)
	}
	return raw, nil
}

// resolveTargetText 提取用于推荐的标题、描述和纯文本正文；前端未传正文时回退读取库中草稿或已发布正文
func resolveTargetText(targetType string, targetID uint, reqTitle, reqDesc, reqDoc string) (title, desc, body string, svcerr *errs.ServiceError) {
	title = strings.TrimSpace(reqTitle)
	desc = strings.TrimSpace(reqDesc)
	rawHTML := strings.TrimSpace(reqDoc)

	if rawHTML == "" || title == "" || desc == "" {
		switch targetType {
		case constant.TargetTypePost:
			post, err := repo.Post.GetPostByID(targetID)
			if err != nil {
				return "", "", "", errs.FromDB(err, "post", "failed_to_get_target")
			}
			if title == "" {
				title = strings.TrimSpace(post.Title)
			}
			if desc == "" {
				desc = strings.TrimSpace(post.Description)
			}
			if rawHTML == "" {
				if post.DraftContent != nil && strings.TrimSpace(*post.DraftContent) != "" {
					rawHTML = *post.DraftContent
				} else {
					rawHTML = post.Content
				}
			}
		case constant.TargetTypePage:
			page, err := repo.Page.GetPageByID(targetID)
			if err != nil {
				return "", "", "", errs.FromDB(err, "page", "failed_to_get_target")
			}
			if title == "" {
				title = strings.TrimSpace(page.Title)
			}
			if desc == "" {
				desc = strings.TrimSpace(page.Description)
			}
			if rawHTML == "" {
				if page.DraftContent != nil && strings.TrimSpace(*page.DraftContent) != "" {
					rawHTML = *page.DraftContent
				} else {
					rawHTML = page.Content
				}
			}
		}
	}
	return title, desc, strings.TrimSpace(htmlToPlainText(rawHTML)), nil
}

func clipHeadTail(text string, headRunes, tailRunes int) string {
	runes := []rune(text)
	if len(runes) <= headRunes+tailRunes {
		return text
	}
	return string(runes[:headRunes]) + "\n\n……（中间部分省略）……\n\n" + string(runes[len(runes)-tailRunes:])
}

var reLeadingIndex = regexp.MustCompile(`^\s*(?:\d+[.、)）]|[-*•])\s*`)

func parseSuggestedTitles(raw string) []string {
	cleaned := extractJSON(raw)
	var rawTitles []string
	var obj struct {
		Titles []string `json:"titles"`
	}
	if err := json.Unmarshal([]byte(cleaned), &obj); err == nil && len(obj.Titles) > 0 {
		rawTitles = obj.Titles
	} else {
		_ = json.Unmarshal([]byte(cleaned), &rawTitles)
	}

	seen := make(map[string]bool, len(rawTitles))
	result := make([]string, 0, aiTitleMaxCount)
	for _, item := range rawTitles {
		t := strings.ReplaceAll(item, "\n", " ")
		t = strings.Join(strings.Fields(t), " ")
		t = reLeadingIndex.ReplaceAllString(t, "")
		t = trimTitleQuotes(strings.TrimSpace(t))
		if t == "" || utf8.RuneCountInString(t) > aiTitleMaxRunes {
			continue
		}
		key := strings.ToLower(t)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, t)
		if len(result) >= aiTitleMaxCount {
			break
		}
	}
	return result
}

func trimTitleQuotes(s string) string {
	pairs := [][2]string{{"《", "》"}, {"「", "」"}, {"『", "』"}, {"“", "”"}, {`"`, `"`}, {"'", "'"}}
	for _, p := range pairs {
		if strings.HasPrefix(s, p[0]) && strings.HasSuffix(s, p[1]) {
			inner := strings.TrimSpace(s[len(p[0]) : len(s)-len(p[1])])
			if inner != "" && !strings.Contains(inner, p[0]) && !strings.Contains(inner, p[1]) {
				return inner
			}
		}
	}
	return s
}

var (
	reSlugSeparator = regexp.MustCompile(`[\s_./]+`)
	reSlugInvalid   = regexp.MustCompile(`[^a-z0-9-]+`)
	reSlugDashes    = regexp.MustCompile(`-{2,}`)
	reDigitsOnly    = regexp.MustCompile(`^\d+$`)
)

func sanitizeLabelSlug(rawSlug, fallbackName string) string {
	s := strings.ToLower(strings.TrimSpace(rawSlug))
	s = reSlugSeparator.ReplaceAllString(s, "-")
	s = reSlugInvalid.ReplaceAllString(s, "")
	s = reSlugDashes.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > aiTaxonomyLabelSlugMax {
		s = strings.Trim(s[:aiTaxonomyLabelSlugMax], "-")
	}
	if s == "" || reDigitsOnly.MatchString(s) {
		sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(fallbackName))))
		s = "tag-" + hex.EncodeToString(sum[:3])
	}
	return s
}

func normalizeSuggestedTaxonomy(raw string, categories []model.Category, labels []model.Label) (*dto.AITaxonomyResp, *errs.ServiceError) {
	var parsed struct {
		CategoryID *uint `json:"category_id"`
		LabelIDs   []uint `json:"label_ids"`
		NewLabels  []struct {
			Name string `json:"name"`
			Slug string `json:"slug"`
		} `json:"new_labels"`
	}
	if err := json.Unmarshal([]byte(extractJSON(raw)), &parsed); err != nil {
		return nil, errs.NewBadRequest("ai_empty_response")
	}

	catByID := make(map[uint]model.Category, len(categories))
	for _, c := range categories {
		catByID[c.ID] = c
	}
	labelByID := make(map[uint]model.Label, len(labels))
	labelByName := make(map[string]model.Label, len(labels))
	labelBySlug := make(map[string]model.Label, len(labels))
	for _, l := range labels {
		labelByID[l.ID] = l
		if k := strings.ToLower(strings.TrimSpace(l.Name)); k != "" {
			labelByName[k] = l
		}
		if k := strings.ToLower(strings.TrimSpace(l.Slug)); k != "" {
			labelBySlug[k] = l
		}
	}

	resp := &dto.AITaxonomyResp{
		Labels:    make([]dto.LabelDto, 0),
		NewLabels: make([]dto.AITaxonomyNewItemDto, 0),
	}
	if parsed.CategoryID != nil && *parsed.CategoryID > 0 {
		if cat, ok := catByID[*parsed.CategoryID]; ok {
			resp.Category = cat.ToDto()
		}
	}

	addedLabelIDs := make(map[uint]bool)
	addExistingLabel := func(l model.Label) {
		if addedLabelIDs[l.ID] || len(resp.Labels) >= aiTaxonomyMaxLabels {
			return
		}
		addedLabelIDs[l.ID] = true
		resp.Labels = append(resp.Labels, l.ToDto())
	}

	for _, id := range parsed.LabelIDs {
		if l, ok := labelByID[id]; ok {
			addExistingLabel(l)
		}
	}

	seenNewName := make(map[string]bool)
	seenNewSlug := make(map[string]bool)
	for _, item := range parsed.NewLabels {
		name := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(item.Name), "#"))
		name = trimTitleQuotes(name)
		if name == "" || utf8.RuneCountInString(name) > aiTaxonomyLabelNameMax {
			continue
		}
		slug := sanitizeLabelSlug(item.Slug, name)
		nameKey := strings.ToLower(name)
		// 若名称或 slug 已存在于现有标签库，自动归并到匹配的已有标签，避免新建撞唯一索引
		if existing, ok := labelByName[nameKey]; ok {
			addExistingLabel(existing)
			continue
		}
		if existing, ok := labelBySlug[slug]; ok {
			addExistingLabel(existing)
			continue
		}
		if seenNewName[nameKey] || seenNewSlug[slug] {
			continue
		}
		if len(resp.NewLabels) >= aiTaxonomyMaxNewLabels {
			break
		}
		seenNewName[nameKey] = true
		seenNewSlug[slug] = true
		resp.NewLabels = append(resp.NewLabels, dto.AITaxonomyNewItemDto{Name: name, Slug: slug})
	}
	return resp, nil
}
