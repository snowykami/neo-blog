package apiv1

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// getJSONAs 带登录态读取接口，cookie 为空时等同访客
func getJSONAs(t *testing.T, url, cookie string, out any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request %s: %v", url, err)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d", url, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
}

type postCardsResp struct {
	Data struct {
		Cards []struct {
			ID           uint   `json:"id"`
			Title        string `json:"title"`
			Content      string `json:"content"`
			DraftContent string `json:"draft_content"`
		} `json:"cards"`
	} `json:"data"`
}

// 正文「文章引用」卡片的批量接口：一次请求取多篇，只返回公开文章（不看当前用户是谁），
// 已删除与私密的文章不返回，返回顺序与请求一致
func TestPostCardsRoute(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	other := &model.User{Username: "other", Email: "other@test.local", Role: constant.RoleEditor}
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	repo.GetDB().Create(author)
	repo.GetDB().Create(other)
	repo.GetDB().Create(admin)

	create := func(user *model.User, title string, isPrivate bool) uint {
		ctx := context.WithValue(context.Background(), "user_id", user.ID)
		id, svcerr := service.NewPostService().CreatePost(ctx, &dto.CreateOrUpdatePostReq{
			PostBaseDto: dto.PostBaseDto{Title: title, Content: "<p>body</p>"},
			IsPrivate:   &isPrivate,
		})
		if svcerr != nil {
			t.Fatal(svcerr)
		}
		return id
	}
	publicID := create(author, "public", false)
	privateID := create(author, "private", true)
	otherPrivateID := create(other, "other private", true)
	deletedID := create(author, "deleted", false)
	if _, err := repo.Post.DeletePost(deletedID); err != nil {
		t.Fatalf("delete post: %v", err)
	}

	base := startRoutes(t, registerPostRoutes)
	// 请求里的顺序是 private 在前，接口按请求顺序返回；重复的 id 只返回一次
	url := base + "/post/cards?ids=" + joinIDs(privateID, publicID, publicID, deletedID, otherPrivateID)

	var guest postCardsResp
	getJSONAs(t, url, "", &guest)
	if len(guest.Data.Cards) != 1 || guest.Data.Cards[0].ID != publicID {
		t.Fatalf("guest cards = %+v, want only the public post %d", guest.Data.Cards, publicID)
	}
	// 卡片只带展示字段，不返回正文与草稿
	if guest.Data.Cards[0].Content != "" || guest.Data.Cards[0].DraftContent != "" {
		t.Fatalf("guest card carries content: %+v", guest.Data.Cards[0])
	}

	// 私密文章只在后台可见：作者本人与管理员读取卡片同样只拿到公开文章，前台数据对所有人一致
	for name, user := range map[string]*model.User{"author": author, "other": other, "admin": admin} {
		var view postCardsResp
		getJSONAs(t, url, loginCookie(t, user), &view)
		if len(view.Data.Cards) != 1 || view.Data.Cards[0].ID != publicID {
			t.Fatalf("%s cards = %+v, want only the public post %d", name, view.Data.Cards, publicID)
		}
	}

	// 请求顺序：多篇公开文章按请求顺序返回
	secondID := create(other, "second", false)
	var ordered postCardsResp
	getJSONAs(t, base+"/post/cards?ids="+joinIDs(secondID, privateID, publicID), "", &ordered)
	if len(ordered.Data.Cards) != 2 || ordered.Data.Cards[0].ID != secondID || ordered.Data.Cards[1].ID != publicID {
		t.Fatalf("ordered cards = %+v, want [%d %d]", ordered.Data.Cards, secondID, publicID)
	}

	// 非法 id 与空参数
	resp, err := http.Get(base + "/post/cards?ids=abc")
	if err != nil {
		t.Fatalf("GET invalid ids: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid ids status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	var empty postCardsResp
	getJSONAs(t, base+"/post/cards", "", &empty)
	if len(empty.Data.Cards) != 0 {
		t.Fatalf("empty request cards = %+v, want none", empty.Data.Cards)
	}
}

// joinIDs 把 id 拼成逗号分隔的查询参数
func joinIDs(ids ...uint) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, strconv.FormatUint(uint64(id), 10))
	}
	return strings.Join(parts, ",")
}
