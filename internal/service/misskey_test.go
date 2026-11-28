package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func strPtr(s string) *string { return &s }

func TestMisskeyNormalizeAndSSRF(t *testing.T) {
	u, ok := NormalizeMisskeyUsername("  @snowykami  ")
	if !ok || u != "snowykami" {
		t.Fatalf("expected snowykami, got %q (%v)", u, ok)
	}
	for _, bad := range []string{"", "@", "a/b", "a\\b", "snowy kami", "snowy\nkami", "user@evil.example", "a?b", "a#b", strings.Repeat("a", 65)} {
		if got, valid := NormalizeMisskeyUsername(bad); valid {
			t.Fatalf("expected username %q to be rejected, got %q", bad, got)
		}
	}

	utils.SafeFetchAllowPrivate = false
	for _, blockedURL := range []string{
		"",
		"http://127.0.0.1",
		"http://localhost/misskey",
		"http://10.0.0.8",
		"http://192.168.1.10",
		"http://169.254.169.254/latest/meta-data",
		"http://[::1]",
		"https://misskey.io:8443",
		"https://misskey.io/@snowykami",
		"ftp://misskey.io",
		"javascript:alert(1)",
		"https://user:pass@misskey.io",
	} {
		if got, err := NormalizeMisskeyInstanceURL(blockedURL); err == nil {
			t.Fatalf("expected SSRF/invalid URL %q to be rejected, got %q", blockedURL, got)
		}
	}

	normURL, err := NormalizeMisskeyInstanceURL("https://Lab.Liteyuki.org///")
	if err != nil || normURL != "https://lab.liteyuki.org" {
		t.Fatalf("unexpected normalized URL: %q, err=%v", normURL, err)
	}

	for _, badHref := range []string{"javascript:alert(1)", "data:text/html,<h1>x</h1>", "vbscript:msgbox(1)", "//evil.com/a.png", "https://u:p@example.com/a.png", "http://:8080/a.png", "http://127.0.0.1:8080/a.png"} {
		if got := SanitizeMisskeyHTTPURL(badHref); got != "" {
			t.Fatalf("expected unsafe URL %q to be stripped, got %q", badHref, got)
		}
	}
	if got := SanitizeMisskeyHTTPURL("https://lab.liteyuki.org/files/a.webp"); got != "https://lab.liteyuki.org/files/a.webp" {
		t.Fatalf("expected valid https URL preserved, got %q", got)
	}
}

func TestMisskeyMFMAndVisibilityFilter(t *testing.T) {
	mfm := "<center>$[tada $[x2 Hello :blobcat::neko: :wave@.:]]</center>\n<plain>$[tada literal]</plain> `<plain>code_tag</plain>` `p := **ptr` std::vector::iterator [Liteyuki](https://lab.liteyuki.org) **bold** 12:30:45 (:30:45)"
	cleaned := StripMisskeyMFM(mfm)
	if strings.Contains(cleaned, "<center>") || strings.Contains(cleaned, ":blobcat:") || strings.Contains(cleaned, ":neko:") || strings.Contains(cleaned, "\x00") {
		t.Fatalf("expected MFM tags/adjacent emojis stripped without NUL leak, got %q", cleaned)
	}
	for _, want := range []string{"Hello", "$[tada literal]", "<plain>code_tag</plain>", "p := **ptr", "std::vector::iterator", "Liteyuki", "12:30:45", "(:30:45)"} {
		if !strings.Contains(cleaned, want) {
			t.Fatalf("expected %q preserved in %q", want, cleaned)
		}
	}

	// 防 $O(N^2)$ CPU DoS 验证：超长连续未闭合 "$[" 在毫秒级线性时间完成
	start := time.Now()
	_ = StripMisskeyMFM(strings.Repeat("$[", 200_000))
	if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
		t.Fatalf("expected linear O(N) MFM stripping, took %v", elapsed)
	}

	chID := "chan123"
	rawNotes := []misskeyAPINote{
		{
			ID:         "pub1",
			CreatedAt:  "2026-11-28T01:00:00Z",
			Visibility: "public",
			Text:       strPtr("$[sparkle 公开帖子] :neko:"),
			CW:         strPtr(":spoiler:"),
			Files: []misskeyAPIFile{
				{Type: "image/webp", ThumbnailURL: "https://lab.liteyuki.org/thumb1.webp", Comment: strPtr("封面说明")},
				{Type: "image/png", ThumbnailURL: "https://lab.liteyuki.org/nsfw.png", IsSensitive: true},
				{Type: "image/png", ThumbnailURL: "javascript:alert(1)"},
			},
			Reactions: map[string]int{"❤️": 3, ":like:": 2},
		},
		{
			ID:         "localonly1",
			CreatedAt:  "2026-11-28T01:00:30Z",
			Visibility: "public",
			LocalOnly:  true,
			Text:       strPtr("仅限站内帖子不应跨出实例"),
		},
		{
			ID:         "channel1",
			CreatedAt:  "2026-11-28T01:00:45Z",
			Visibility: "public",
			ChannelID:  &chID,
			Text:       strPtr("频道帖子不应进入个人动态卡"),
		},
		{
			ID:         "home1",
			CreatedAt:  "2026-11-28T01:01:00Z",
			Visibility: "home",
			Text:       strPtr("仅主页可见（unlisted）不应展示"),
		},
		{
			ID:         "followers1",
			CreatedAt:  "2026-11-28T01:02:00Z",
			Visibility: "followers",
			Text:       strPtr("仅关注者可见不应展示"),
		},
		{
			ID:         "badrenote1",
			CreatedAt:  "2026-11-28T01:03:00Z",
			Visibility: "public",
			Renote: &misskeyAPINote{
				ID:         "secret_orig",
				Visibility: "followers",
				Text:       strPtr("私密原帖不应通过公开转帖泄露"),
			},
		},
		{
			ID:         "nestedbadrenote1",
			CreatedAt:  "2026-11-28T01:03:30Z",
			Visibility: "public",
			Text:       strPtr("引用外层公开"),
			Renote: &misskeyAPINote{
				ID:         "mid_pub",
				Visibility: "public",
				Renote: &misskeyAPINote{
					ID:         "deep_dm",
					Visibility: "specified",
					Text:       strPtr("深层私信绝不泄露"),
				},
			},
		},
		{
			ID:         "quotecw1",
			CreatedAt:  "2026-11-28T01:03:45Z",
			Visibility: "public",
			Text:       strPtr("带评论引用剧透帖"),
			Renote: &misskeyAPINote{
				ID:         "cw_orig_1",
				Visibility: "public",
				User:       misskeyAPIUser{Username: "bob"},
				CW:         strPtr("结局剧透预警"),
				Text:       strPtr("隐藏的凶手名字绝不能直接拼出来"),
			},
		},
		{
			ID:         "goodrenote1",
			CreatedAt:  "2026-11-28T01:04:00Z",
			Visibility: "public",
			Renote: &misskeyAPINote{
				ID:         "orig_pub_99",
				Visibility: "public",
				User:       misskeyAPIUser{Username: "alice", Name: strPtr("Alice :star:")},
				Text:       strPtr("被公开转帖的正文"),
			},
		},
	}

	got := FilterAndSanitizeMisskeyNotes("https://lab.liteyuki.org", rawNotes, 10)
	if len(got) != 3 {
		t.Fatalf("expected exactly 3 safe public notes, got %d: %+v", len(got), got)
	}
	// 纯表情 CW (:spoiler:) 回退为非空 "CW"，确保折叠保护不失效
	if got[0].ID != "pub1" || got[0].CW != "CW" || got[0].Text != "公开帖子" || got[0].ReactionsCount != 5 {
		t.Fatalf("unexpected first note: %+v", got[0])
	}
	if len(got[0].Images) != 1 || got[0].Images[0].ThumbnailURL != "https://lab.liteyuki.org/thumb1.webp" {
		t.Fatalf("expected only 1 safe non-sensitive image, got %+v", got[0].Images)
	}
	// 引用转帖遇到原帖 CW 时仅在 Quote.CW 中暴露预警标题，严禁拼出或下发被折叠的原帖正文
	if got[1].ID != "quotecw1" || got[1].Quote == nil || got[1].Quote.CW != "结局剧透预警" || got[1].Quote.Text != "" || strings.Contains(got[1].Text, "隐藏的凶手名字") {
		t.Fatalf("quote renote leaked CW body or missing structured quote: %+v (quote=%+v)", got[1], got[1].Quote)
	}
	if got[2].ID != "goodrenote1" || !got[2].IsRenote || got[2].RenoteUser != "Alice" || got[2].URL != "https://lab.liteyuki.org/notes/orig_pub_99" {
		t.Fatalf("unexpected pure renote result: %+v", got[2])
	}
}

func TestMisskeyCacheConfigHashAndNoTokenLeak(t *testing.T) {
	setupEditTest(t)
	sharedstate.UseMemory()

	prevAllowPrivate := utils.SafeFetchAllowPrivate
	utils.SafeFetchAllowPrivate = true
	prevClient := misskeyHTTPClient
	misskeyHTTPClient = newMisskeySafeClient()
	t.Cleanup(func() {
		// 等待后台可能启动的异步刷新协程退出后再清理测试环境
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			release, ok, _ := sharedstate.TryLock(misskeyRefreshLockKey, time.Second)
			if ok {
				release()
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		utils.SafeFetchAllowPrivate = prevAllowPrivate
		misskeyHTTPClient = prevClient
		sharedstate.UseMemory()
	})

	const secretToken = "super-secret-misskey-token-do-not-leak"
	var upstreamHits atomic.Int32
	var receivedTokens atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamHits.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if tok, _ := body["i"].(string); tok == secretToken {
			receivedTokens.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/users/show":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":        "user123",
				"username":  "snowykami",
				"name":      "Snowykami",
				"avatarUrl": "https://lab.liteyuki.org/avatar.webp",
			})
		case "/api/users/notes":
			if untilID, _ := body["untilId"].(string); untilID == "notefollowers" {
				_ = json.NewEncoder(w).Encode([]map[string]any{
					{
						"id":         "notepage2",
						"createdAt":  "2026-11-28T01:58:00Z",
						"visibility": "public",
						"text":       "Second page note via untilId!",
					},
				})
				return
			}
			notesResp := make([]map[string]any, 0, 30)
			for idx := 1; idx <= 29; idx++ {
				notesResp = append(notesResp, map[string]any{
					"id":         "note_p1_" + strconv.Itoa(idx),
					"createdAt":  "2026-11-28T02:00:00Z",
					"visibility": "public",
					"text":       "Hello from cached Misskey!",
				})
			}
			notesResp[0]["id"] = "noteabc"
			notesResp = append(notesResp, map[string]any{
				"id":         "notefollowers",
				"createdAt":  "2026-11-28T01:59:00Z",
				"visibility": "followers",
				"text":       "Secret followers note",
			})
			_ = json.NewEncoder(w).Encode(notesResp)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	// 1. 未启用时返回 enabled=false, notes=[]；且 crossChecks 拦截启用但未填完整参数的非法保存
	feedDisabled, svcerr := GetMisskeyFeed(context.Background(), nil)
	if svcerr != nil || feedDisabled.Enabled || feedDisabled.Notes == nil || len(feedDisabled.Notes) != 0 {
		t.Fatalf("expected disabled empty feed, got %+v, err=%v", feedDisabled, svcerr)
	}
	if badErr := config.Save([]config.Change{{Key: "misskey_enabled", Value: true}}); badErr == nil {
		t.Fatal("expected crossChecks to reject enabling misskey without instance_url and username")
	}
	if okDisabledErr := config.Save([]config.Change{
		{Key: "misskey_enabled", Value: false},
		{Key: "misskey_instance_url", Value: "not-a-valid-url"},
	}); okDisabledErr != nil {
		t.Fatalf("expected disabled misskey save not to block hidden draft fields, got %v", okDisabledErr)
	}

	// 2. 保存配置并检验冷启动读接口绝不阻塞（先占住刷新锁模拟冷未命中）
	if err := config.Save([]config.Change{
		{Key: "misskey_enabled", Value: true},
		{Key: "misskey_instance_url", Value: srv.URL},
		{Key: "misskey_username", Value: "@snowykami"},
		{Key: "misskey_api_token", Value: secretToken},
		{Key: "misskey_cache_count", Value: 30},
	}); err != nil {
		t.Fatalf("save config failed: %v", err)
	}

	holdRelease, locked, _ := sharedstate.TryLock(misskeyRefreshLockKey, 5*time.Second)
	if !locked {
		t.Fatal("expected lock acquired")
	}
	coldFeed, svcerr := GetMisskeyFeed(context.Background(), nil)
	holdRelease()
	if svcerr != nil || !coldFeed.Enabled || len(coldFeed.Notes) != 0 {
		t.Fatalf("expected non-blocking cold miss {enabled:true, notes:[]}, got %+v, err=%v", coldFeed, svcerr)
	}
	if upstreamHits.Load() != 0 {
		t.Fatalf("GetMisskeyFeed must not synchronously hit upstream, hits=%d", upstreamHits.Load())
	}

	// 3. 执行后台刷新（含 untilId 翻页补齐到 30 条）后分页读取缓存，验证公开帖子存在、私密帖剔除、Token 零泄露
	if err := RefreshMisskeyFeed(context.Background()); err != nil {
		t.Fatalf("RefreshMisskeyFeed failed: %v", err)
	}
	if receivedTokens.Load() < 3 {
		t.Fatalf("expected token sent to users/show and 2 pages of users/notes, got %d", receivedTokens.Load())
	}

	page1, svcerr := GetMisskeyFeed(context.Background(), &dto.MisskeyFeedQueryReq{Limit: 12})
	if svcerr != nil || !page1.Enabled || page1.Total != 30 || len(page1.Notes) != 12 || !page1.HasMore || page1.NextCursor == "" || page1.Notes[0].ID != "noteabc" {
		t.Fatalf("unexpected page1 feed: %+v, err=%v", page1, svcerr)
	}
	hitsBeforePage2 := upstreamHits.Load()
	page2, svcerr := GetMisskeyFeed(context.Background(), &dto.MisskeyFeedQueryReq{Limit: 20, Cursor: page1.NextCursor, Offset: 12})
	if svcerr != nil || len(page2.Notes) != 18 || page2.HasMore || page2.Notes[len(page2.Notes)-1].ID != "notepage2" {
		t.Fatalf("unexpected page2 cursor slice: len=%d hasMore=%v err=%v", len(page2.Notes), page2.HasMore, svcerr)
	}
	if upstreamHits.Load() != hitsBeforePage2 {
		t.Fatalf("cursor pagination must read sharedstate only without upstream requests")
	}
	// 纯游标未命中（offset=0）时返回空切片而非回绕到第 1 页；非法游标字符返回 400
	staleCursorPage, svcerr := GetMisskeyFeed(context.Background(), &dto.MisskeyFeedQueryReq{Limit: 10, Cursor: "deleted_note_id"})
	if svcerr != nil || len(staleCursorPage.Notes) != 0 || staleCursorPage.HasMore {
		t.Fatalf("expected empty page on stale pure cursor, got %+v, err=%v", staleCursorPage, svcerr)
	}
	if _, badErr := GetMisskeyFeed(context.Background(), &dto.MisskeyFeedQueryReq{Cursor: "../bad"}); badErr == nil || badErr.Message != "invalid_request_parameters" {
		t.Fatalf("expected invalid_request_parameters on bad cursor, got %v", badErr)
	}
	encoded, _ := json.Marshal(page1)
	if strings.Contains(string(encoded), secretToken) || strings.Contains(string(encoded), "config_hash") {
		t.Fatalf("sensitive token or internal hash leaked in public DTO: %s", string(encoded))
	}

	// 4. 修改用户名后 ConfigHash 立即失配，旧账号缓存不会串号返回
	holdRelease2, _, _ := sharedstate.TryLock(misskeyRefreshLockKey, 5*time.Second)
	_ = config.Save([]config.Change{{Key: "misskey_username", Value: "@otheruser"}})
	mismatchFeed, _ := GetMisskeyFeed(context.Background(), nil)
	holdRelease2()
	if !mismatchFeed.Enabled || len(mismatchFeed.Notes) != 0 {
		t.Fatalf("expected ConfigHash mismatch to hide stale user notes immediately, got %+v", mismatchFeed)
	}

	// 5. 跨源 307 重定向拦截：防止 POST 请求体中的 Token 被重定向带往第三方站点
	evilTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("cross-origin redirect target must never be reached!")
	}))
	defer evilTarget.Close()
	redirectSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evilTarget.URL+"/api/users/show", http.StatusTemporaryRedirect)
	}))
	defer redirectSrv.Close()
	_ = config.Save([]config.Change{{Key: "misskey_instance_url", Value: redirectSrv.URL}})
	if err := RefreshMisskeyFeed(context.Background()); err == nil {
		t.Fatal("expected cross-origin redirect to be rejected")
	}
}
