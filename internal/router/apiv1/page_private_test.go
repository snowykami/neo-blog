package apiv1

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// pageDetailResp 页面详情中本用例关心的字段
type pageDetailResp struct {
	Data struct {
		ID           uint    `json:"id"`
		DraftContent *string `json:"draft_content"`
	} `json:"data"`
}

// pageIDsResp 页面列表中的 id
type pageIDsResp struct {
	Data struct {
		Pages []struct {
			ID uint `json:"id"`
		} `json:"pages"`
		Total int64 `json:"total"`
	} `json:"data"`
}

func (r pageIDsResp) ids() []uint {
	ids := make([]uint, 0, len(r.Data.Pages))
	for _, p := range r.Data.Pages {
		ids = append(ids, p.ID)
	}
	return ids
}

// 私密页面只在后台可见（与文章一致）：前台接口对访客、作者本人与管理员都 404，不认 ?type=draft、不返回草稿；
// 后台接口（编辑器读取、我的页面、管理员页面管理）照常返回给有权限的人
func TestPrivatePagesOnlyInConsole(t *testing.T) {
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
	// 被降级为普通用户的原作者：后台接口按当前角色拒绝
	demoted := &model.User{Username: "demoted", Email: "demoted@test.local", Role: constant.RoleUser}
	for _, u := range []*model.User{author, admin, other, demoted} {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	draft := "<p>unpublished draft</p>"
	create := func(owner *model.User, title, slug string, isPrivate bool) uint {
		page := &model.Page{UserID: owner.ID, PageBase: model.PageBase{
			Title: title, Slug: slug, Content: "<p>" + title + " body</p>", DraftContent: &draft, IsPrivate: isPrivate, ShowInNav: true,
		}}
		if err := repo.GetDB().Create(page).Error; err != nil {
			t.Fatalf("create page: %v", err)
		}
		return page.ID
	}
	publicID := create(author, "public words", "public-page", false)
	privateID := create(author, "secret words", "secret-page", true)
	otherPrivateID := create(other, "other secret", "other-secret", true)
	demotedPrivateID := create(demoted, "demoted secret", "demoted-secret", true)

	base := startRoutes(t, func(g *route.RouterGroup) {
		registerPageRoutes(g)
		registerAdminRoutes(g)
	})
	privateKey, publicKey := strconv.Itoa(int(privateID)), strconv.Itoa(int(publicID))
	identities := map[string]string{"guest": "", "author": loginCookie(t, author), "admin": loginCookie(t, admin)}

	for name, cookie := range identities {
		// 页面详情：私密页面按 id、slug、带不带 ?type=draft 都是 404（与不存在的页面一样，不可探测存在）
		for _, path := range []string{"/page/p/" + privateKey, "/page/p/secret-page", "/page/p/" + privateKey + "?type=draft", "/page/p/9999"} {
			if status, body := getAs(t, base+path, cookie); status != http.StatusNotFound || strings.Contains(string(body), "secret") {
				t.Errorf("%s GET %s: status %d, want 404 (%s)", name, path, status, body)
			}
		}
		// 公开页面的前台详情不带草稿，?type=draft 被忽略
		status, body := getAs(t, base+"/page/p/"+publicKey+"?type=draft", cookie)
		var detail pageDetailResp
		if err := json.Unmarshal(body, &detail); status != http.StatusOK || err != nil || detail.Data.ID != publicID {
			t.Fatalf("%s public page detail: status %d err %v body %s", name, status, err, body)
		}
		if detail.Data.DraftContent != nil || strings.Contains(string(body), "unpublished draft") {
			t.Errorf("%s public page detail carries the draft: %s", name, body)
		}
		// 前台列表（导航、按作者）只有公开页面
		for _, query := range []string{"only_nav=true&no_content=true", "user_id=" + strconv.Itoa(int(author.ID)), "query=secret"} {
			path := "/page/list?" + query
			status, body := getAs(t, base+path, cookie)
			var list pageIDsResp
			if err := json.Unmarshal(body, &list); status != http.StatusOK || err != nil {
				t.Fatalf("%s GET %s: status %d err %v", name, path, status, err)
			}
			if strings.Contains(string(body), "secret") {
				t.Errorf("%s GET %s returns a private page: %s", name, path, body)
			}
			if query != "query=secret" && !containsID(list.ids(), publicID) {
				t.Errorf("%s GET %s misses the public page: %s", name, path, body)
			}
		}
	}

	// 后台：编辑器读取私密页面与草稿，仅作者本人与管理员
	for name, cookie := range map[string]string{"author": identities["author"], "admin": identities["admin"]} {
		for _, key := range []string{privateKey, "secret-page"} {
			status, body := getAs(t, base+"/page/p/"+key+"/draft", cookie)
			var detail pageDetailResp
			if err := json.Unmarshal(body, &detail); status != http.StatusOK || err != nil || detail.Data.ID != privateID ||
				detail.Data.DraftContent == nil || *detail.Data.DraftContent != draft {
				t.Errorf("%s console page draft %s: status %d body %s", name, key, status, body)
			}
		}
	}
	if status, _ := getAs(t, base+"/page/p/"+privateKey+"/draft", loginCookie(t, other)); status != http.StatusForbidden {
		t.Errorf("other editor console page draft: status %d, want 403", status)
	}
	if status, _ := getAs(t, base+"/page/p/"+strconv.Itoa(int(demotedPrivateID))+"/draft", loginCookie(t, demoted)); status != http.StatusForbidden {
		t.Errorf("demoted author console page draft: status %d, want 403", status)
	}
	if status, _ := getAs(t, base+"/page/p/"+privateKey+"/draft", ""); status != http.StatusUnauthorized {
		t.Errorf("guest console page draft: status %d, want 401", status)
	}

	listIDs := func(path, cookie string) []uint {
		t.Helper()
		status, body := getAs(t, base+path, cookie)
		var list pageIDsResp
		if err := json.Unmarshal(body, &list); status != http.StatusOK || err != nil {
			t.Fatalf("GET %s: status %d err %v body %s", path, status, err, body)
		}
		return list.ids()
	}
	// 后台：我的页面含自己的私密页面，不含别人的；普通用户（含被降级的原作者）没有后台页面列表
	if ids := listIDs("/page/mine", identities["author"]); !(containsID(ids, privateID) && containsID(ids, publicID)) || containsID(ids, otherPrivateID) {
		t.Errorf("author mine = %v, want own pages only", ids)
	}
	if status, _ := getAs(t, base+"/page/mine", loginCookie(t, demoted)); status != http.StatusForbidden {
		t.Errorf("demoted user /page/mine: status %d, want 403", status)
	}
	// 管理员页面管理：所有人的页面（含私密页面），user_id 只看某人的；非管理员 403
	if ids := listIDs("/admin/pages", identities["admin"]); !(containsID(ids, privateID) && containsID(ids, otherPrivateID) && containsID(ids, publicID)) {
		t.Errorf("admin pages = %v, want all pages", ids)
	}
	if ids := listIDs("/admin/pages?user_id="+strconv.Itoa(int(admin.ID)), identities["admin"]); len(ids) != 0 {
		t.Errorf("admin pages of admin = %v, want none", ids)
	}
	if ids := listIDs("/admin/pages?user_id="+strconv.Itoa(int(other.ID)), identities["admin"]); len(ids) != 1 || ids[0] != otherPrivateID {
		t.Errorf("admin pages of other = %v, want [%d]", ids, otherPrivateID)
	}
	if status, _ := getAs(t, base+"/admin/pages", identities["author"]); status != http.StatusForbidden {
		t.Errorf("editor /admin/pages: status %d, want 403", status)
	}
}
