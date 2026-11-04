package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// fakeCommentTranslate 模拟模型：评论写的是简体中文，译文为「[目标语言] 原文」
func fakeCommentTranslate(calls *atomic.Int32) func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
	return func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		calls.Add(1)
		lang := user[strings.Index(user, "（")+len("（") : strings.Index(user, "）")]
		content := user[strings.Index(user, "<comment>\n")+len("<comment>\n") : strings.LastIndex(user, "\n</comment>")]
		if lang == "zh" {
			return `{"source_lang": "zh-CN", "translation": ""}`, nil
		}
		return fmt.Sprintf("<think>想一想</think>```json\n{\"source_lang\": \"zh-CN\", \"translation\": \"[%s] %s\"}\n```", lang, content), nil
	}
}

func configureTestAI(t *testing.T) {
	t.Helper()
	for k, v := range map[string]string{"ai_api_base_url": "https://example.com/v1", "ai_api_key": "sk-test", "ai_model": "test-model"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatalf("set kv: %v", err)
		}
	}
}

func countCommentTranslations(t *testing.T, commentID uint) map[string]model.CommentTranslation {
	t.Helper()
	var rows []model.CommentTranslation
	if err := repo.GetDB().Where("comment_id = ?", commentID).Find(&rows).Error; err != nil {
		t.Fatalf("list translations: %v", err)
	}
	result := make(map[string]model.CommentTranslation, len(rows))
	for _, row := range rows {
		result[row.TargetLang] = row
	}
	return result
}

func commentLanguage(t *testing.T, commentID uint) string {
	t.Helper()
	var comment model.Comment
	if err := repo.GetDB().First(&comment, commentID).Error; err != nil {
		t.Fatalf("get comment: %v", err)
	}
	return comment.Language
}

// 评论语言：AI 识别后写入并随评论返回，不改变编辑时间；内容被修改后清空；翻译期间评论被修改时不写入
func TestCommentLanguage(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	configureTestAI(t)
	postID := createPublicPost(t, author, nil)
	commentID, _ := createComment(other, postID, 0, false)
	s := NewCommentTranslateService()
	var calls atomic.Int32
	s.complete = fakeCommentTranslate(&calls)
	defer func() { s.complete = commentTranslateCompletion }()
	translate := func(lang string) *dto.CommentTranslationDto {
		t.Helper()
		got, svcerr := s.Translate(context.Background(), &dto.TranslateCommentReq{ID: commentID, TargetLang: lang, RemoteAddr: "203.0.113.1"})
		if svcerr != nil {
			t.Fatalf("translate %s: %v", lang, svcerr)
		}
		return got
	}
	before, svcerr := NewCommentService().GetComment(context.Background(), commentID)
	if svcerr != nil || before.Language != "" {
		t.Fatalf("new comment = %+v, %v", before, svcerr)
	}

	// 语言未知时由模型判断出与目标语言相同，记下语言后不再调用模型
	if got := translate("zh"); !got.SameLanguage || calls.Load() != 1 {
		t.Fatalf("same language = %+v, calls = %d", got, calls.Load())
	}
	if got := translate("zh"); !got.SameLanguage || calls.Load() != 1 {
		t.Fatalf("known language = %+v, calls = %d", got, calls.Load())
	}
	after, _ := NewCommentService().GetComment(context.Background(), commentID)
	if after.Language != "zh" || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("comment after translate = %+v (updated_at before %v)", after, before.UpdatedAt)
	}

	// 内容不变的编辑保留语言，内容变化后清空
	update := func(content string) {
		t.Helper()
		if svcerr := NewCommentService().UpdateComment(other, &dto.UpdateCommentReq{ID: commentID, Content: content}); svcerr != nil {
			t.Fatalf("update comment: %v", svcerr)
		}
	}
	update("c")
	if lang := commentLanguage(t, commentID); lang != "zh" {
		t.Fatalf("language after unchanged edit = %q", lang)
	}
	update("hello")
	if lang := commentLanguage(t, commentID); lang != "" {
		t.Fatalf("language after edit = %q", lang)
	}

	// 翻译期间评论被修改：按旧内容识别的语言不写入
	if err := repo.Comment.SetLanguage(commentID, "c", "ja"); err != nil {
		t.Fatalf("set language: %v", err)
	}
	if lang := commentLanguage(t, commentID); lang != "" {
		t.Fatalf("language set for stale content = %q", lang)
	}

	// 命中已有译文时同样记下语言（如语言字段加入前保存的译文）
	translate("en")
	if err := repo.GetDB().Model(&model.Comment{}).Where("id = ?", commentID).UpdateColumn("language", "").Error; err != nil {
		t.Fatalf("clear language: %v", err)
	}
	before2 := calls.Load()
	translate("en")
	if lang := commentLanguage(t, commentID); lang != "zh" || calls.Load() != before2 {
		t.Fatalf("language from cache = %q, calls = %d", lang, calls.Load()-before2)
	}
}

// 缓存命中、多语言分开存储、源语言相同、MD5 变化后删除重建、编辑与删除评论时清理译文
func TestCommentTranslateCache(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	commentID, svcerr := createComment(other, postID, 0, false)
	if svcerr != nil {
		t.Fatalf("create comment: %v", svcerr)
	}
	s := NewCommentTranslateService()
	var calls atomic.Int32
	s.complete = fakeCommentTranslate(&calls)
	defer func() { s.complete = commentTranslateCompletion }()
	anonymous := context.Background()
	translate := func(lang string) *dto.CommentTranslationDto {
		t.Helper()
		got, svcerr := s.Translate(anonymous, &dto.TranslateCommentReq{ID: commentID, TargetLang: lang, RemoteAddr: "203.0.113.1"})
		if svcerr != nil {
			t.Fatalf("translate %s: %v", lang, svcerr)
		}
		return got
	}

	// 未配置 AI 时拒绝，配置后不支持的目标语言也拒绝
	_, svcerr = s.Translate(anonymous, &dto.TranslateCommentReq{ID: commentID, TargetLang: "en"})
	expectCode(t, svcerr, http.StatusBadRequest, "ai not configured")
	if s.Available() {
		t.Fatal("available before ai configured")
	}
	configureTestAI(t)
	if !s.Available() {
		t.Fatal("not available after ai configured")
	}
	_, svcerr = s.Translate(anonymous, &dto.TranslateCommentReq{ID: commentID, TargetLang: "fr"})
	expectCode(t, svcerr, http.StatusBadRequest, "unsupported language")

	// 首次翻译调用模型并保存，再次请求命中缓存（目标语言大小写不敏感）
	if got := translate("en"); got.Content != "[en] c" || got.SourceLang != "zh" || got.TargetLang != "en" || got.SameLanguage {
		t.Fatalf("en translation = %+v", got)
	}
	if got := translate("EN"); got.Content != "[en] c" || calls.Load() != 1 {
		t.Fatalf("cached translation = %+v, calls = %d", got, calls.Load())
	}

	// 不同目标语言分开存储，互不覆盖
	if got := translate("ja"); got.Content != "[ja] c" {
		t.Fatalf("ja translation = %+v", got)
	}
	// 翻译时记下 AI 识别出的评论语言；目标语言与它相同时直接说明无需翻译，不调用模型也不存译文
	if lang := commentLanguage(t, commentID); lang != "zh" {
		t.Fatalf("comment language = %q", lang)
	}
	if got := translate("zh"); !got.SameLanguage || got.Content != "" || got.SourceLang != "zh" {
		t.Fatalf("same language = %+v", got)
	}
	rows := countCommentTranslations(t, commentID)
	if len(rows) != 2 || rows["en"].Content != "[en] c" || rows["ja"].Content != "[ja] c" || calls.Load() != 2 {
		t.Fatalf("rows = %+v, calls = %d", rows, calls.Load())
	}
	if rows["en"].ContentMD5 != model.CommentContentMD5("c") {
		t.Fatalf("content md5 = %q", rows["en"].ContentMD5)
	}

	// 评论内容变化（不经过编辑接口，旧译文仍在库中）：MD5 不一致时删除全部语言的旧译文再重新翻译
	if err := repo.GetDB().Model(&model.Comment{}).Where("id = ?", commentID).UpdateColumn("content", "changed").Error; err != nil {
		t.Fatalf("change content: %v", err)
	}
	if got := translate("en"); got.Content != "[en] changed" || calls.Load() != 3 {
		t.Fatalf("retranslated = %+v, calls = %d", got, calls.Load())
	}
	rows = countCommentTranslations(t, commentID)
	if len(rows) != 1 || rows["en"].ContentMD5 != model.CommentContentMD5("changed") {
		t.Fatalf("rows after content change = %+v", rows)
	}

	// 编辑评论：内容不变时保留译文，内容变化时立即删除
	translate("ja")
	update := func(content string) {
		t.Helper()
		if svcerr := NewCommentService().UpdateComment(other, &dto.UpdateCommentReq{ID: commentID, Content: content}); svcerr != nil {
			t.Fatalf("update comment: %v", svcerr)
		}
	}
	update("changed")
	if rows := countCommentTranslations(t, commentID); len(rows) != 2 {
		t.Fatalf("rows after unchanged edit = %+v", rows)
	}
	update("edited")
	if rows := countCommentTranslations(t, commentID); len(rows) != 0 {
		t.Fatalf("rows after edit = %+v", rows)
	}

	// 删除评论（连同回复）时译文一并删除
	replyID, svcerr := createComment(author, postID, commentID, false)
	if svcerr != nil {
		t.Fatalf("create reply: %v", svcerr)
	}
	translate("en")
	if _, svcerr := s.Translate(anonymous, &dto.TranslateCommentReq{ID: replyID, TargetLang: "en"}); svcerr != nil {
		t.Fatalf("translate reply: %v", svcerr)
	}
	if svcerr := NewCommentService().DeleteComment(other, commentID); svcerr != nil {
		t.Fatalf("delete comment: %v", svcerr)
	}
	if len(countCommentTranslations(t, commentID)) != 0 || len(countCommentTranslations(t, replyID)) != 0 {
		t.Fatal("translations remain after comment deleted")
	}
}

// 只能翻译自己看得到的评论；模型调用按用户 / IP 限流，命中缓存不计
func TestCommentTranslatePermissionAndRateLimit(t *testing.T) {
	author, _, other, privatePost, _ := setupEditTest(t)
	configureTestAI(t)
	postID := createPublicPost(t, author, nil)
	s := NewCommentTranslateService()
	var calls atomic.Int32
	s.complete = fakeCommentTranslate(&calls)
	defer func() { s.complete, s.rateLimit = commentTranslateCompletion, commentTranslateRateLimit }()
	anonymous := context.Background()
	translate := func(ctx context.Context, id uint, ip string) *errs.ServiceError {
		_, svcerr := s.Translate(ctx, &dto.TranslateCommentReq{ID: id, TargetLang: "en", RemoteAddr: ip})
		return svcerr
	}

	// 私密文章下的评论：访客看不到，作者可以翻译
	onPrivate, svcerr := createComment(author, privatePost.ID, 0, false)
	if svcerr != nil {
		t.Fatalf("comment on private post: %v", svcerr)
	}
	expectCode(t, translate(anonymous, onPrivate, "203.0.113.1"), http.StatusNotFound, "guest translate comment on private post")
	if svcerr := translate(author, onPrivate, "203.0.113.1"); svcerr != nil {
		t.Fatalf("author translate own post comment: %v", svcerr)
	}
	// 私密评论：访客看不到，评论作者与文章作者可以翻译
	private, svcerr := createComment(other, postID, 0, true)
	if svcerr != nil {
		t.Fatalf("private comment: %v", svcerr)
	}
	expectCode(t, translate(anonymous, private, "203.0.113.1"), http.StatusForbidden, "guest translate private comment")
	for _, ctx := range []context.Context{other, author} {
		if svcerr := translate(ctx, private, "203.0.113.1"); svcerr != nil {
			t.Fatalf("translate visible private comment: %v", svcerr)
		}
	}
	expectCode(t, translate(anonymous, 99999, "203.0.113.1"), http.StatusNotFound, "missing comment")

	// 限流：同一 IP 第二次调用模型被拒，命中缓存不受影响，其他 IP 不受影响
	s.rateLimit = 1
	first, _ := createComment(other, postID, 0, false)
	second, _ := createComment(other, postID, 0, false)
	if svcerr := translate(anonymous, first, "198.51.100.1"); svcerr != nil {
		t.Fatalf("first translate: %v", svcerr)
	}
	expectCode(t, translate(anonymous, second, "198.51.100.1"), http.StatusTooManyRequests, "rate limited")
	if svcerr := translate(anonymous, first, "198.51.100.1"); svcerr != nil {
		t.Fatalf("cached translate should not be limited: %v", svcerr)
	}
	if svcerr := translate(anonymous, second, "198.51.100.2"); svcerr != nil {
		t.Fatalf("other ip: %v", svcerr)
	}

	// 模型出错或连续两次输出格式不对时提示翻译失败，不保存
	third, _ := createComment(other, postID, 0, false)
	s.rateLimit = commentTranslateRateLimit
	s.complete = func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		calls.Add(1)
		return "Sorry, I can't.", nil
	}
	before := calls.Load()
	expectCode(t, translate(anonymous, third, "198.51.100.3"), http.StatusServiceUnavailable, "invalid output")
	if calls.Load()-before != 2 || len(countCommentTranslations(t, third)) != 0 {
		t.Fatalf("invalid output: calls = %d, rows = %d", calls.Load()-before, len(countCommentTranslations(t, third)))
	}
	s.complete = func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return "", errors.New("upstream down")
	}
	expectCode(t, translate(anonymous, third, "198.51.100.3"), http.StatusServiceUnavailable, "upstream error")
}

// 多个请求同时翻译同一条评论的同一语言时只调用一次模型
func TestCommentTranslateSingleFlight(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	configureTestAI(t)
	postID := createPublicPost(t, author, nil)
	commentID, _ := createComment(other, postID, 0, false)
	s := NewCommentTranslateService()
	var calls atomic.Int32
	entered, release := make(chan struct{}, 5), make(chan struct{})
	translate := fakeCommentTranslate(&calls)
	s.complete = func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		entered <- struct{}{}
		<-release
		return translate(ctx, cfg, system, user)
	}
	defer func() { s.complete = commentTranslateCompletion }()

	var wg sync.WaitGroup
	results := make([]*dto.CommentTranslationDto, 5)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, svcerr := s.Translate(context.Background(), &dto.TranslateCommentReq{ID: commentID, TargetLang: "en", RemoteAddr: "203.0.113.1"})
			if svcerr != nil {
				t.Errorf("translate: %v", svcerr)
				return
			}
			results[i] = got
		}()
	}
	// 第一个请求进入模型调用后再等一会儿，让其余请求都排在锁上；没有互斥时它们也会进入模型调用
	<-entered
	time.Sleep(200 * time.Millisecond)
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("model calls = %d, want 1", calls.Load())
	}
	for _, got := range results {
		if got == nil || got.Content != "[en] c" {
			t.Fatalf("result = %+v", got)
		}
	}
}

func TestParseCommentTranslation(t *testing.T) {
	cases := []struct {
		raw, target, source, translation string
		ok                               bool
	}{
		{`{"source_lang": "en", "translation": "你好"}`, "zh", "en", "你好", true},
		{"<think>{}</think>\n```json\n{\"source_lang\": \"ja\", \"translation\": \" Hello {name} \"}\n```", "en", "ja", "Hello {name}", true},
		{`{"source_lang": "zh-Hans", "translation": ""}`, "zh", "zh", "", true},
		{`{"source_lang": "zh_TW", "translation": "简体"}`, "zh", "zh-tw", "简体", true},
		{`{"source_lang": "en-US", "translation": "same"}`, "en", "en", "", true},
		{`{"source_lang": "en", "translation": ""}`, "zh", "", "", false},
		{`{"source_lang": "", "translation": "x"}`, "zh", "", "", false},
		{`{"source_lang": "英语", "translation": "x"}`, "zh", "", "", false},
		{"Sorry, I can't.", "zh", "", "", false},
	}
	for _, c := range cases {
		source, translation, ok := parseCommentTranslation(c.raw, c.target)
		if source != c.source || translation != c.translation || ok != c.ok {
			t.Errorf("parse(%q, %s) = %q %q %v", c.raw, c.target, source, translation, ok)
		}
	}
}
