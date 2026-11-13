package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// testPNG 以 PNG 文件头开头、总长 size 字节的内容（按内容嗅探为 image/png）
func testPNG(size int) []byte {
	data := make([]byte, size)
	copy(data, "\x89PNG\r\n\x1a\n")
	return data
}

// imageServer 模拟外链图床：/a.png 等返回图片，/big.png 超过单张上限，/page 是网页，/fake.png 声明是图片但内容不是
func imageServer(t *testing.T) *httptest.Server {
	t.Helper()
	utils.SafeFetchAllowPrivate = true
	t.Cleanup(func() { utils.SafeFetchAllowPrivate = false })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/big.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(testPNG(aiVisionMaxImageBytes + 1))
		case "/page":
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "<html><body>hi</body></html>")
		case "/fake.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = io.WriteString(w, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")
		case "/b.gif":
			w.Header().Set("Content-Type", "image/gif")
			_, _ = io.WriteString(w, "GIF89a\x01\x00\x01\x00")
		case "/missing.png":
			w.WriteHeader(http.StatusNotFound)
		default:
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(testPNG(64))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestArticleTextWithImages(t *testing.T) {
	content := `<p>前文</p><img src="/api/v1/file/f/3" alt="架构 &amp; 流程"><p>中间</p>` +
		`<img data-src="https://wrong.test/x.png" src='https://e.test/a.png'><img alt="没有地址"><p>结尾</p>`
	text, images := articleTextWithImages(content)
	if len(images) != 2 || images[0].Src != "/api/v1/file/f/3" || images[0].Alt != "架构 & 流程" ||
		images[1].Src != "https://e.test/a.png" || images[1].Index != 2 {
		t.Fatalf("images = %+v", images)
	}
	if !strings.Contains(text, "[图1：架构 & 流程]") || !strings.Contains(text, "[图2]") || strings.Contains(text, "没有地址") {
		t.Fatalf("text = %q", text)
	}
	// 摘要的用户消息保留占位，并返回图片
	prompt, got := buildAISummaryUserPrompt("标题", content)
	if !strings.Contains(prompt, "[图1：架构 & 流程]") || len(got) != 2 {
		t.Fatalf("prompt = %q, images = %+v", prompt, got)
	}
}

func TestAnnotateMarkdownImages(t *testing.T) {
	md := "开头 ![猫](https://e.test/cat.png \"标题\") 中间\n\n<figure><img class=\"x\" src=\"/api/v1/file/f/2\" alt=\"图 &lt;二&gt;\"></figure>\n" +
		"![](<https://e.test/space.png>)"
	out, images := AnnotateMarkdownImages(md)
	if len(images) != 3 || images[0].Src != "https://e.test/cat.png" || images[0].Alt != "猫" ||
		images[1].Src != "/api/v1/file/f/2" || images[1].Alt != "图 <二>" || images[2].Src != "https://e.test/space.png" {
		t.Fatalf("images = %+v", images)
	}
	for _, want := range []string{`![猫](https://e.test/cat.png "标题") [图1]`, `alt="图 &lt;二&gt;"> [图2]`, `![](<https://e.test/space.png>) [图3]`} {
		if !strings.Contains(out, want) {
			t.Fatalf("annotated = %q, want %q", out, want)
		}
	}
}

// 站内文件从存储读取，外链经防 SSRF 下载；按内容嗅探格式，超过单张上限、无法解析的地址跳过
func TestLoadVisionImageSources(t *testing.T) {
	env := setupFileLinkTest(t)
	ctx := userCtx(env.admin)
	saved := saveTestFile(t, ctx, env.localID, string(testPNG(128)))
	bigSite := saveTestFile(t, ctx, env.localID, string(testPNG(aiVisionMaxImageBytes+10)))
	notImage := saveTestFile(t, ctx, env.localID, "plain text file")
	srv := imageServer(t)
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(testPNG(32))

	cases := []struct {
		src  string
		ok   bool
		mime string
	}{
		{FileLink(saved.ID), true, "image/png"},
		{FileLink(saved.ID) + "/a.png", true, "image/png"},
		{tools.GetBaseUrl() + FileLink(saved.ID), true, "image/png"},
		{FileLink(bigSite.ID), false, ""},
		{FileLink(notImage.ID), false, ""},
		{FileLink(99999), false, ""},
		{srv.URL + "/a.png", true, "image/png"},
		{srv.URL + "/b.gif", true, "image/gif"},
		{srv.URL + "/big.png", false, ""},
		{srv.URL + "/page", false, ""},
		{srv.URL + "/fake.png", false, ""},
		{srv.URL + "/missing.png", false, ""},
		{dataURL, true, "image/png"},
		{"images/relative.png", false, ""},
		{"/static/logo.png", false, ""},
		{"ftp://e.test/a.png", false, ""},
	}
	for _, c := range cases {
		data, mime, err := loadVisionImage(context.Background(), c.src)
		if (err == nil) != c.ok || mime != c.mime || (c.ok && len(data) == 0) {
			t.Errorf("%s: ok=%v mime=%q err=%v", c.src, err == nil, mime, err)
		}
	}
	// 其他站点的同名路径按外链处理（本例无法连接，读取失败），不会去读本站存储
	if _, ok := siteFileID("https://other.test" + FileLink(saved.ID)); ok {
		t.Fatal("other site's file link treated as site file")
	}
}

// 每次最多附带 AIVisionMaxImages 张（取正文靠前的、同一地址只算一次），总大小超出上限的跳过
func TestLoadVisionImagesLimits(t *testing.T) {
	srv := imageServer(t)
	var images []ContentImage
	for i := 1; i <= 9; i++ {
		src := srv.URL + "/img" + string(rune('0'+i)) + ".png"
		if i == 2 {
			src = srv.URL + "/page" // 读不到的图片只留占位，不由后面的图片补上
		}
		images = append(images, ContentImage{Index: i, Src: src})
		if i == 1 {
			images = append(images, ContentImage{Index: 99, Src: src}) // 重复的地址
		}
	}
	got := LoadVisionImages(context.Background(), images, 100)
	if len(got) != AIVisionMaxImages-1 {
		t.Fatalf("loaded %d images", len(got))
	}
	for i, img := range got {
		want := []int{1, 3, 4, 5, 6}[i]
		if img.Index != want || !strings.HasPrefix(img.DataURL, "data:image/png;base64,") {
			t.Fatalf("image %d = index %d, %q", i, img.Index, img.DataURL[:30])
		}
	}
	if got := LoadVisionImages(context.Background(), images, 2); len(got) != 1 {
		t.Fatalf("limit 2 loaded %d", len(got))
	}

	// 总大小：每张 3 MB，第三张起超出 8 MB 上限
	big := make([]ContentImage, 4)
	for i := range big {
		big[i] = ContentImage{Index: i + 1, Src: "data:image/png;base64," + base64.StdEncoding.EncodeToString(testPNG(3<<20+i))}
	}
	if got := LoadVisionImages(context.Background(), big, AIVisionMaxImages); len(got) != 2 || got[1].Index != 2 {
		t.Fatalf("total size limit: loaded %d", len(got))
	}
}

// visionModelServer 模拟模型接口，记录每次请求的消息；rejectImages 为 true 时带图片的请求返回 400
func visionModelServer(t *testing.T, rejectImages *atomic.Bool) (*httptest.Server, func() []map[string]any) {
	t.Helper()
	var mu sync.Mutex
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(data, &body)
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		if rejectImages.Load() && strings.Contains(string(data), `"image_url"`) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":{"message":"image input is not supported"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"这是一段摘要。"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []map[string]any {
		mu.Lock()
		defer mu.Unlock()
		return append([]map[string]any(nil), bodies...)
	}
}

// userContent 请求中 user 消息的 content（字符串或内容块数组）
func userContent(t *testing.T, body map[string]any) any {
	t.Helper()
	messages, _ := body["messages"].([]any)
	for _, m := range messages {
		msg, _ := m.(map[string]any)
		if msg["role"] == "user" {
			return msg["content"]
		}
	}
	t.Fatalf("no user message in %v", body)
	return nil
}

// 模型拒收图片：去掉图片按纯文本重试一次（标签一并去掉）并记住；之后直接按纯文本发送，两种情况都告知调用方
func TestChatCompletionVisionFallback(t *testing.T) {
	setupEditTest(t)
	if err := repo.KV.SetKV("ai_vision_enabled", true); err != nil {
		t.Fatal(err)
	}
	var reject atomic.Bool
	reject.Store(true)
	srv, bodies := visionModelServer(t, &reject)
	cfg := tools.AIConfig{BaseURL: srv.URL, APIKey: "k", Model: "text-only"}
	t.Cleanup(func() { llmclient.ResetVisionUnsupported(cfg.BaseURL, cfg.Model) })
	images := []VisionImage{{Index: 1, DataURL: "data:image/png;base64,AAAA"}}

	var notices []string
	ctx := WithVisionFallbackNotice(context.Background(), func(reason string) { notices = append(notices, reason) })
	got, err := aiSummaryCompletion(ctx, cfg, "s", "正文 [图1]", images)
	if err != nil || got != "这是一段摘要。" {
		t.Fatalf("got %q, %v", got, err)
	}
	all := bodies()
	if len(all) != 2 || len(notices) != 1 {
		t.Fatalf("requests = %d, notices = %v", len(all), notices)
	}
	if parts, ok := userContent(t, all[0]).([]any); !ok || len(parts) != 3 {
		t.Fatalf("first request content = %v", userContent(t, all[0]))
	}
	if c := userContent(t, all[1]); c != "正文 [图1]" {
		t.Fatalf("retry content = %#v", c)
	}
	if llmclient.VisionUsable(cfg.BaseURL, cfg.Model) {
		t.Fatal("model should be remembered as not supporting images")
	}

	// 已知不支持：不再发送图片，只发一次请求
	if _, err := aiSummaryCompletion(ctx, cfg, "s", "正文 [图1]", images); err != nil {
		t.Fatal(err)
	}
	if all = bodies(); len(all) != 3 || len(notices) != 2 {
		t.Fatalf("requests = %d, notices = %d", len(all), len(notices))
	}
	if _, ok := userContent(t, all[2]).(string); !ok {
		t.Fatalf("content = %v", userContent(t, all[2]))
	}

	// 支持图片的模型：一次请求带上图片，不记为不支持
	vision := tools.AIConfig{BaseURL: srv.URL + "/v1", APIKey: "k", Model: "vision"}
	reject.Store(false)
	if _, err := aiSummaryCompletion(context.Background(), vision, "s", "u", images); err != nil {
		t.Fatal(err)
	}
	if all = bodies(); len(all) != 4 || !llmclient.VisionUsable(vision.BaseURL, vision.Model) {
		t.Fatalf("requests = %d", len(all))
	}
	if _, ok := userContent(t, all[3]).([]any); !ok {
		t.Fatalf("content = %v", userContent(t, all[3]))
	}
}

// AI 摘要：开启识图时正文图片以 data URL 随正文发送；未开启时只有文字占位；模型拒收时任务结果标明已退回纯文本
func TestAISummaryVision(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	var reject atomic.Bool
	modelSrv, bodies := visionModelServer(t, &reject)
	setAIBaseURL(t, modelSrv.URL)
	t.Cleanup(func() { llmclient.ResetVisionUnsupported(modelSrv.URL, "test-model") })
	imgSrv := imageServer(t)
	content := `<p>正文介绍了部署架构。</p><img src="` + imgSrv.URL + `/arch.png" alt="示意图"><p>结尾</p>`
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID).Update("content", content).Error; err != nil {
		t.Fatal(err)
	}
	repo.InvalidatePostCache()
	s := NewAISummaryService()
	run := func() map[string]any {
		t.Helper()
		before := len(bodies())
		if svcerr := s.Trigger(author, post.ID); svcerr != nil {
			t.Fatalf("trigger: %v", svcerr)
		}
		if st := waitAISummary(t, s, author, post.ID); st.Status != aiSummaryStatusSucceeded {
			t.Fatalf("status = %+v", st)
		}
		all := bodies()
		if len(all) <= before {
			t.Fatal("no request sent")
		}
		return all[before]
	}

	// 未开启识图：content 为字符串，图片只留占位
	text, ok := userContent(t, run()).(string)
	if !ok || !strings.Contains(text, "[图1：示意图]") || strings.Contains(text, "image_url") {
		t.Fatalf("content without vision = %#v", text)
	}

	// 开启识图：文本块 + [图1] 标签 + 图片块
	if err := repo.KV.SetKV("ai_vision_enabled", true); err != nil {
		t.Fatal(err)
	}
	parts, ok := userContent(t, run()).([]any)
	if !ok || len(parts) != 3 {
		t.Fatalf("content with vision = %#v", parts)
	}
	first, _ := parts[0].(map[string]any)
	image, _ := parts[2].(map[string]any)
	url, _ := image["image_url"].(map[string]any)
	if !strings.Contains(first["text"].(string), "[图1：示意图]") || image["type"] != "image_url" ||
		!strings.HasPrefix(url["url"].(string), "data:image/png;base64,") {
		t.Fatalf("parts = %v", parts)
	}
	if st, _ := s.Status(author, post.ID); st.VisionFallback {
		t.Fatal("vision fallback should be false when images were accepted")
	}

	// 模型拒收图片：按纯文本重试成功，任务结果标明已退回纯文本
	reject.Store(true)
	run()
	if st, _ := s.Status(author, post.ID); !st.VisionFallback {
		t.Fatalf("status = %+v", st)
	}
	if last := bodies()[len(bodies())-1]; userContent(t, last) == nil {
		t.Fatal("missing retry")
	} else if _, ok := userContent(t, last).(string); !ok {
		t.Fatalf("retry content = %v", userContent(t, last))
	}

	// 用量照常按一次调用记录
	var n int64
	repo.GetDB().Model(&model.LLMUsage{}).Where("purpose = ?", constant.LLMPurposeSummary).Count(&n)
	if n != 3 {
		t.Fatalf("summary usage rows = %d", n)
	}
}

// AI 用户：消息带图片且模型拒收时，AgentChat 去掉图片重试并告知 worker
func TestAgentChatVisionFallback(t *testing.T) {
	_, _, ai1, _, _ := setupAgentTest(t)
	var reject atomic.Bool
	reject.Store(true)
	srv, bodies := visionModelServer(t, &reject)
	setAIBaseURL(t, srv.URL)
	if err := repo.KV.SetKV("ai_vision_enabled", true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { llmclient.ResetVisionUnsupported(srv.URL, "test-model") })
	_, run := leaseCtx(t, ai1.ID, constant.AgentRunKindBrowse)
	var notices []string
	ctx := WithVisionFallbackNotice(context.Background(), func(reason string) { notices = append(notices, reason) })
	messages := []map[string]any{
		{"role": "system", "content": "s"},
		{"role": "user", "content": VisionContentParts("读文章", []VisionImage{{Index: 1, DataURL: "data:image/png;base64,AAAA"}})},
	}
	if _, err := NewAIAgentService().AgentChat(ctx, run.ID, map[string]any{"messages": messages}); err != nil {
		t.Fatalf("agent chat: %v", err)
	}
	all := bodies()
	if len(all) != 2 || len(notices) != 1 || userContent(t, all[1]) != "读文章" {
		t.Fatalf("requests = %d, notices = %v", len(all), notices)
	}
	if got, _ := repo.AIAgent.GetRun(run.ID); got.PromptTokens != 10 {
		t.Fatalf("run usage = %+v", got)
	}
	// 之后租约中标明该模型不支持，worker 按纯文本阅读
	lease, err := NewAIAgentService().buildLeaseRun(run, mustAgent(t, ai1.ID), tools.GetAIAgentConfig(), run.ScheduledAt, *run.LeaseUntil)
	if err != nil || lease.Vision || !lease.VisionUnsupported {
		t.Fatalf("lease vision = %v / %v, %v", lease.Vision, lease.VisionUnsupported, err)
	}
}

func mustAgent(t *testing.T, id uint) *model.AIAgent {
	t.Helper()
	agent, err := repo.AIAgent.GetByID(id)
	if err != nil {
		t.Fatal(err)
	}
	return agent
}
