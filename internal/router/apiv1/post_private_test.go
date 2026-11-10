package apiv1

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// getAs 带登录态读取接口，返回状态码与响应体；cookie 为空时等同访客
func getAs(t *testing.T, url, cookie string) (int, []byte) {
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
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s: %v", url, err)
	}
	return resp.StatusCode, body
}

// postDetailResp 文章详情中本用例关心的字段
type postDetailResp struct {
	Data struct {
		ID           uint    `json:"id"`
		DraftContent *string `json:"draft_content"`
	} `json:"data"`
}

// postIDsResp 文章列表中本用例关心的字段
type postIDsResp struct {
	Data struct {
		Posts []struct {
			ID uint `json:"id"`
		} `json:"posts"`
		Pinned []struct {
			ID uint `json:"id"`
		} `json:"pinned"`
	} `json:"data"`
}

// ids 列表与置顶里出现的全部文章 id
func (r postIDsResp) ids() []uint {
	ids := make([]uint, 0, len(r.Data.Posts)+len(r.Data.Pinned))
	for _, p := range r.Data.Posts {
		ids = append(ids, p.ID)
	}
	for _, p := range r.Data.Pinned {
		ids = append(ids, p.ID)
	}
	return ids
}

func containsID(ids []uint, id uint) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

// 私密文章只在后台可见：前台接口对访客、作者本人与管理员都不返回私密文章，也不认 ?type=draft；
// 后台接口（编辑器读取、我的文章、后台文章管理、后台置顶）照常返回给有权限的人
func TestPrivatePostsOnlyInConsole(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	other := &model.User{Username: "other", Email: "other@test.local", Role: constant.RoleEditor}
	for _, u := range []*model.User{author, admin, other} {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	ctxOf := func(u *model.User) context.Context { return context.WithValue(context.Background(), "user_id", u.ID) }

	label := &model.Label{Name: "go", Slug: "go"}
	category := &model.Category{Name: "tech", Slug: "tech"}
	repo.GetDB().Create(label)
	repo.GetDB().Create(category)
	create := func(title string, slug string, isPrivate bool) uint {
		id, svcerr := service.NewPostService().CreatePost(ctxOf(author), &dto.CreateOrUpdatePostReq{
			PostBaseDto: dto.PostBaseDto{Title: title, Content: "<p>" + title + " body</p>", Slug: &slug, LabelIds: []uint{label.ID}, CategoryID: &category.ID},
			IsPrivate:   &isPrivate,
		})
		if svcerr != nil {
			t.Fatalf("create post: %v", svcerr)
		}
		return id
	}
	publicID := create("public words", "public-slug", false)
	privateID := create("secret words", "secret-slug", true)
	draft := "<p>unpublished draft</p>"
	for _, id := range []uint{publicID, privateID} {
		if _, svcerr := service.NewPostService().UpdatePost(ctxOf(author), &dto.CreateOrUpdatePostReq{ID: id, PostBaseDto: dto.PostBaseDto{DraftContent: &draft}}); svcerr != nil {
			t.Fatalf("save draft: %v", svcerr)
		}
		if _, svcerr := service.NewPostService().SetPostPin(ctxOf(admin), &dto.SetPostPinReq{ID: id, Pinned: true}); svcerr != nil {
			t.Fatalf("pin post: %v", svcerr)
		}
	}

	base := startRoutes(t, func(g *route.RouterGroup) {
		registerPostRoutes(g)
		registerAdminRoutes(g)
		registerMiscRoutes(g)
	})
	privateKey, publicKey := strconv.Itoa(int(privateID)), strconv.Itoa(int(publicID))
	identities := map[string]string{"guest": "", "author": loginCookie(t, author), "admin": loginCookie(t, admin)}

	for name, cookie := range identities {
		// 文章详情：私密文章按 id、slug、带不带 ?type=draft 都是 404
		for _, path := range []string{"/post/p/" + privateKey, "/post/p/secret-slug", "/post/p/" + privateKey + "?type=draft"} {
			if status, _ := getAs(t, base+path, cookie); status != http.StatusNotFound {
				t.Errorf("%s GET %s: status %d, want 404", name, path, status)
			}
		}
		// 公开文章的前台详情不带草稿，?type=draft 被忽略
		status, body := getAs(t, base+"/post/p/"+publicKey+"?type=draft", cookie)
		var detail postDetailResp
		if err := json.Unmarshal(body, &detail); status != http.StatusOK || err != nil || detail.Data.ID != publicID {
			t.Fatalf("%s public detail: status %d err %v body %s", name, status, err, body)
		}
		if detail.Data.DraftContent != nil || strings.Contains(string(body), "unpublished draft") {
			t.Errorf("%s public detail carries the draft: %s", name, body)
		}

		// 列表：首页（含置顶）、标签、分类、搜索、用户主页、归档都只有公开文章
		for _, query := range []string{
			"with_pinned=true",
			"label=go",
			"category=tech",
			"query=secret",
			"user_id=" + strconv.Itoa(int(author.ID)),
			"no_content=true&size=500",
		} {
			path := "/post/list?" + query
			status, body := getAs(t, base+path, cookie)
			var list postIDsResp
			if err := json.Unmarshal(body, &list); status != http.StatusOK || err != nil {
				t.Fatalf("%s GET %s: status %d err %v", name, path, status, err)
			}
			if containsID(list.ids(), privateID) {
				t.Errorf("%s GET %s returns the private post: %s", name, path, body)
			}
			if query != "query=secret" && !containsID(list.ids(), publicID) {
				t.Errorf("%s GET %s misses the public post: %s", name, path, body)
			}
		}

		// 正文引用卡片、sitemap、RSS
		for _, path := range []string{"/post/cards?ids=" + privateKey + "," + publicKey, "/misc/sitemap-data", "/misc/rss-data"} {
			status, body := getAs(t, base+path, cookie)
			if status != http.StatusOK || strings.Contains(string(body), "secret") {
				t.Errorf("%s GET %s: status %d, private post leaked: %s", name, path, status, body)
			}
		}
	}

	// 后台：编辑器读取私密文章与草稿，仅作者本人与管理员
	for name, cookie := range map[string]string{"author": identities["author"], "admin": identities["admin"]} {
		for _, key := range []string{privateKey, "secret-slug"} {
			status, body := getAs(t, base+"/post/p/"+key+"/draft", cookie)
			var detail postDetailResp
			if err := json.Unmarshal(body, &detail); status != http.StatusOK || err != nil || detail.Data.ID != privateID ||
				detail.Data.DraftContent == nil || *detail.Data.DraftContent != draft {
				t.Errorf("%s console draft %s: status %d body %s", name, key, status, body)
			}
		}
	}
	if status, _ := getAs(t, base+"/post/p/"+privateKey+"/draft", loginCookie(t, other)); status != http.StatusForbidden {
		t.Errorf("other user console draft: status %d, want 403", status)
	}
	if status, _ := getAs(t, base+"/post/p/"+privateKey+"/draft", ""); status != http.StatusUnauthorized {
		t.Errorf("guest console draft: status %d, want 401", status)
	}

	// 后台：我的文章含自己的私密文章，别人看不到
	listIDs := func(path, cookie string) []uint {
		t.Helper()
		status, body := getAs(t, base+path, cookie)
		var list postIDsResp
		if err := json.Unmarshal(body, &list); status != http.StatusOK || err != nil {
			t.Fatalf("GET %s: status %d err %v body %s", path, status, err, body)
		}
		return list.ids()
	}
	if ids := listIDs("/post/mine", identities["author"]); !(containsID(ids, privateID) && containsID(ids, publicID)) {
		t.Errorf("author mine = %v, want both posts", ids)
	}
	if ids := listIDs("/post/mine", loginCookie(t, other)); len(ids) != 0 {
		t.Errorf("other mine = %v, want none", ids)
	}
	// 后台文章管理与后台置顶（管理员）含私密文章
	if ids := listIDs("/admin/posts", identities["admin"]); !containsID(ids, privateID) {
		t.Errorf("admin posts = %v, want the private post", ids)
	}
	if ids := listIDs("/admin/posts/pinned", identities["admin"]); !containsID(ids, privateID) {
		t.Errorf("admin pinned = %v, want the private post", ids)
	}
}
