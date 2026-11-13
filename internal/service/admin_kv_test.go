package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

type publishCaptureStore struct {
	sharedstate.Store
	mu        sync.Mutex
	published map[string][]string
}

func (p *publishCaptureStore) Publish(channel, payload string) error {
	p.mu.Lock()
	if p.published == nil {
		p.published = make(map[string][]string)
	}
	_, msg, found := strings.Cut(payload, "|")
	if !found {
		msg = payload
	}
	p.published[channel] = append(p.published[channel], msg)
	p.mu.Unlock()
	return p.Store.Publish(channel, payload)
}

func (p *publishCaptureStore) Close() error { return nil }

func TestAdminKVService_SecretProtectionEnvReadonlyAndConfigSync(t *testing.T) {
	setupEditTest(t)
	capture := &publishCaptureStore{Store: sharedstate.Current()}
	sharedstate.UseStore(capture)
	t.Cleanup(sharedstate.UseMemory)

	svc := NewAdminService()

	// 1. 敏感凭据保存与脱敏返回、掩码占位写回保护
	if svcerr := svc.SetKV("email_password", &dto.SetKVReq{Key: "email_password", Value: "real-smtp-secret"}); svcerr != nil {
		t.Fatalf("SetKV secret failed: %v", svcerr)
	}
	isSecret := true
	if svcerr := svc.SetKV("custom_api_token", &dto.SetKVReq{Key: "custom_api_token", Value: "tok-12345", Secret: &isSecret}); svcerr != nil {
		t.Fatalf("SetKV custom secret failed: %v", svcerr)
	}

	items, svcerr := svc.ListKV("")
	if svcerr != nil {
		t.Fatalf("ListKV failed: %v", svcerr)
	}
	byKey := make(map[string]dto.KVDto, len(items))
	for _, it := range items {
		byKey[it.Key] = it
	}
	for _, secretKey := range []string{"email_password", "custom_api_token"} {
		got, ok := byKey[secretKey]
		if !ok || !got.Secret || !got.HasValue || got.Value != nil {
			t.Fatalf("ListKV(%s) desensitization broken: %+v", secretKey, got)
		}
	}

	// 掩码占位符写回不覆盖真实密钥（覆盖 SetKV 与 SaveConfig 两条路径）
	if svcerr := svc.SetKV("email_password", &dto.SetKVReq{Key: "email_password", Value: "******"}); svcerr != nil {
		t.Fatalf("SetKV mask writeback failed: %v", svcerr)
	}
	if svcerr := svc.SetKV("custom_api_token", &dto.SetKVReq{Key: "custom_api_token", Value: "••••••••"}); svcerr != nil {
		t.Fatalf("SetKV custom mask writeback failed: %v", svcerr)
	}
	if svcerr := svc.SaveConfig(&dto.SaveConfigReq{
		Items: []dto.KVDto{{Key: "email_password", Value: "********"}},
	}); svcerr != nil {
		t.Fatalf("SaveConfig mask writeback failed: %v", svcerr)
	}
	if got := config.String("email_password"); got != "real-smtp-secret" {
		t.Fatalf("email_password overwritten by mask: got %q, want real-smtp-secret", got)
	}
	if got, _ := repo.KV.GetKV("custom_api_token"); got != "tok-12345" {
		t.Fatalf("custom_api_token overwritten by mask: got %v, want tok-12345", got)
	}

	// 2. 只读环境变量接管项拒绝覆盖与删除
	t.Setenv(constant.EnvKeyEmailHost, "smtp.env.locked")
	if svcerr := svc.SetKV("email_host", &dto.SetKVReq{Key: "email_host", Value: "smtp.db.attempt"}); svcerr == nil || svcerr.Message != "config_readonly_env" {
		t.Fatalf("SetKV on ENV key = %v, want config_readonly_env", svcerr)
	}
	if svcerr := svc.SaveConfig(&dto.SaveConfigReq{Items: []dto.KVDto{{Key: "email_host", Value: "smtp.db.attempt"}}}); svcerr == nil || svcerr.Message != "config_readonly_env" {
		t.Fatalf("SaveConfig on ENV key = %v, want config_readonly_env", svcerr)
	}
	if svcerr := svc.DeleteKV("email_host"); svcerr == nil || svcerr.Message != "config_readonly_env" {
		t.Fatalf("DeleteKV on ENV key = %v, want config_readonly_env", svcerr)
	}

	// 3. 注册表配置项经 SetKV 修改时触发类型/范围校验、site_info 同步与跨实例广播
	if svcerr := svc.SetKV("email_port", &dto.SetKVReq{Key: "email_port", Value: float64(70000)}); svcerr == nil || svcerr.Message != "invalid_config_value" {
		t.Fatalf("SetKV out-of-range email_port = %v, want invalid_config_value", svcerr)
	}
	if svcerr := svc.SetKV("site_name", &dto.SetKVReq{Key: "site_name", Value: "NeoKVUpdated"}); svcerr != nil {
		t.Fatalf("SetKV site_name failed: %v", svcerr)
	}
	if got := config.String("site_name"); got != "NeoKVUpdated" {
		t.Fatalf("config.String(site_name) = %q, want NeoKVUpdated", got)
	}
	siteInfo := config.SiteInfo()
	meta, _ := siteInfo["metadata"].(map[string]any)
	if meta["name"] != "NeoKVUpdated" {
		t.Fatalf("site_info.metadata.name = %v, want NeoKVUpdated", meta["name"])
	}

	// 4. DeleteKV 删除注册表配置项时重置回默认值并清理 site_info 聚合路径
	if svcerr := svc.DeleteKV("site_name"); svcerr != nil {
		t.Fatalf("DeleteKV site_name failed: %v", svcerr)
	}
	wantDefault, _ := config.Lookup("site_name").Default.(string)
	if got := config.String("site_name"); got != wantDefault {
		t.Fatalf("after DeleteKV, config.String(site_name) = %q, want default %q", got, wantDefault)
	}

	capture.mu.Lock()
	msgs := append([]string(nil), capture.published["config_changed"]...)
	capture.mu.Unlock()
	sawSiteInfo := false
	for _, k := range msgs {
		if k == "site_info" || k == "site_name" {
			sawSiteInfo = true
			break
		}
	}
	if !sawSiteInfo {
		t.Fatalf("expected sharedstate config_changed Publish broadcast, got %v", msgs)
	}
}

func TestGetRandomPost_PreloadsAndFiltersPrivateDraft(t *testing.T) {
	setupEditTest(t)
	db := repo.GetDB()
	postSvc := NewPostService()

	// 清空默认初始化创建的测试文章，验证空库返回 404
	if err := db.Where("1 = 1").Delete(&model.Post{}).Error; err != nil {
		t.Fatal(err)
	}
	if _, svcerr := postSvc.GetRandomPost(context.Background()); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("empty DB GetRandomPost = %v, want 404", svcerr)
	}

	author := &model.User{Username: "rand_author", Nickname: "RandAuthor", Email: "author-secret@example.com", Role: constant.RoleEditor}
	collab := &model.User{Username: "rand_collab", Nickname: "RandCollab", Email: "collab-secret@example.com", Role: constant.RoleEditor}
	if err := db.Create(author).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(collab).Error; err != nil {
		t.Fatal(err)
	}
	cat := &model.Category{Name: "Architecture", Slug: "arch"}
	if err := db.Create(cat).Error; err != nil {
		t.Fatal(err)
	}
	lbl := model.Label{Name: "GolangRand", Slug: "golang-rand"}
	if err := db.Create(&lbl).Error; err != nil {
		t.Fatal(err)
	}

	// 只有私密文章与未发布草稿时仍必须返回 404
	privSlug := "priv-post"
	draftSlug := "draft-post"
	for _, p := range []*model.Post{
		{UserID: author.ID, PostBase: model.PostBase{Title: "Private", Content: "secret", IsPrivate: true, Slug: &privSlug}},
		{UserID: author.ID, PostBase: model.PostBase{Title: "Draft", Content: "", IsDraft: true, Slug: &draftSlug}},
	} {
		if err := db.Create(p).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, svcerr := postSvc.GetRandomPost(context.Background()); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("only private/draft GetRandomPost = %v, want 404", svcerr)
	}

	// 新增一篇公开已发布文章（带作者、分类、标签、协作者与未发布草稿字段）
	pubSlug := "pub-random"
	draftText := "unpublished-draft-body"
	pub := &model.Post{
		UserID:        author.ID,
		Collaborators: []model.User{*collab},
		PostBase: model.PostBase{
			Title:        "Public Random",
			Content:      "<p>published</p>",
			DraftContent: &draftText,
			CategoryID:   &cat.ID,
			Labels:       []model.Label{lbl},
			Slug:         &pubSlug,
		},
	}
	if err := db.Create(pub).Error; err != nil {
		t.Fatal(err)
	}

	got, svcerr := postSvc.GetRandomPost(context.Background())
	if svcerr != nil {
		t.Fatalf("GetRandomPost failed: %v", svcerr)
	}
	if got.ID != pub.ID || got.DraftContent != nil || got.HasDraft || got.DraftVersion != 0 {
		t.Fatalf("unexpected random post dto: %+v", got)
	}
	if got.User.Username != "rand_author" || got.Category == nil || got.Category.Slug != "arch" || len(got.Labels) != 1 || got.Labels[0].Slug != "golang-rand" {
		t.Fatalf("associations not preloaded: user=%+v category=%+v labels=%+v", got.User, got.Category, got.Labels)
	}
	if len(got.Collaborators) != 1 || got.Collaborators[0].Username != "rand_collab" {
		t.Fatalf("collaborators not preloaded: %+v", got.Collaborators)
	}
	rawJSON, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rawJSON), "collab-secret@example.com") || strings.Contains(string(rawJSON), "author-secret@example.com") {
		t.Fatalf("email leaked in GetRandomPost JSON: %s", string(rawJSON))
	}
}
