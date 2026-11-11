package apiv1

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 点赞头像墙（GET /like/liked_users）：可见性与点赞一致，私密文章 / 私密评论 / 不存在的目标对看不到的人一律 404；
// 返回的用户只有头像墙需要的最小字段
func TestLikedUsersVisibility(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	other := &model.User{Username: "other", Email: "other@test.local", Role: constant.RoleUser}
	liker := &model.User{Username: "liker", Nickname: "Liker", Email: "liker@test.local", Role: constant.RoleUser}
	for _, u := range []*model.User{author, admin, other, liker} {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	publicPost := &model.Post{UserID: author.ID, PostBase: model.PostBase{Title: "public", Content: "<p>public</p>"}}
	privatePost := &model.Post{UserID: author.ID, PostBase: model.PostBase{Title: "secret", Content: "<p>secret</p>", IsPrivate: true}}
	for _, p := range []*model.Post{publicPost, privatePost} {
		if err := repo.GetDB().Create(p).Error; err != nil {
			t.Fatalf("create post: %v", err)
		}
	}
	// 公开文章下的公开评论与私密评论（私密评论只有评论者、文章作者与管理员可见）
	publicComment := &model.Comment{UserID: liker.ID, TargetID: publicPost.ID, TargetType: constant.TargetTypePost, Content: "hi"}
	privateComment := &model.Comment{UserID: liker.ID, TargetID: publicPost.ID, TargetType: constant.TargetTypePost, Content: "psst", IsPrivate: true}
	for _, c := range []*model.Comment{publicComment, privateComment} {
		if err := repo.GetDB().Create(c).Error; err != nil {
			t.Fatalf("create comment: %v", err)
		}
		repo.GetDB().Model(c).Update("root_id", c.ID)
	}
	for _, target := range []struct {
		kind string
		id   uint
	}{
		{constant.TargetTypePost, publicPost.ID},
		{constant.TargetTypePost, privatePost.ID},
		{constant.TargetTypeComment, publicComment.ID},
		{constant.TargetTypeComment, privateComment.ID},
	} {
		if err := repo.GetDB().Create(&model.Like{TargetType: target.kind, TargetID: target.id, UserID: liker.ID}).Error; err != nil {
			t.Fatalf("create like: %v", err)
		}
	}

	base := startRoutes(t, registerLikeRoutes)
	likedUsers := func(kind string, id uint, cookie string) (int, string) {
		t.Helper()
		status, body := getAs(t, base+"/like/liked_users?target_type="+kind+"&target_id="+strconv.Itoa(int(id)), cookie)
		return status, string(body)
	}
	guest, otherCookie := "", loginCookie(t, other)

	// 公开目标：任何人可读，只返回最小字段
	for _, target := range []struct {
		kind string
		id   uint
	}{{constant.TargetTypePost, publicPost.ID}, {constant.TargetTypeComment, publicComment.ID}} {
		status, body := likedUsers(target.kind, target.id, guest)
		if status != http.StatusOK {
			t.Fatalf("guest liked users of public %s: status %d body %s", target.kind, status, body)
		}
		var resp struct {
			Data struct {
				Users []map[string]any `json:"users"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(body), &resp); err != nil || len(resp.Data.Users) != 1 {
			t.Fatalf("liked users of public %s: %v %s", target.kind, err, body)
		}
		got := resp.Data.Users[0]
		if got["username"] != "liker" || got["nickname"] != "Liker" || got["gravatar_hash"] == nil {
			t.Errorf("liked user misses avatar fields: %v", got)
		}
		for _, field := range []string{"role", "email", "language", "gender", "show_likes", "background_url", "created_at"} {
			if _, ok := got[field]; ok {
				t.Errorf("liked user should not carry %q: %v", field, got)
			}
		}
	}

	// 私密文章：访客与无关用户 404（与不存在一样），作者与管理员可读（后台预览里的点赞头像墙）
	for name, cookie := range map[string]string{"guest": guest, "other": otherCookie} {
		if status, body := likedUsers(constant.TargetTypePost, privatePost.ID, cookie); status != http.StatusNotFound || strings.Contains(body, "liker") {
			t.Errorf("%s liked users of private post: status %d body %s", name, status, body)
		}
		if status, body := likedUsers(constant.TargetTypeComment, privateComment.ID, cookie); status != http.StatusNotFound || strings.Contains(body, "liker") {
			t.Errorf("%s liked users of private comment: status %d body %s", name, status, body)
		}
	}
	for name, cookie := range map[string]string{"author": loginCookie(t, author), "admin": loginCookie(t, admin)} {
		if status, body := likedUsers(constant.TargetTypePost, privatePost.ID, cookie); status != http.StatusOK || !strings.Contains(body, "liker") {
			t.Errorf("%s liked users of private post: status %d body %s", name, status, body)
		}
		if status, body := likedUsers(constant.TargetTypeComment, privateComment.ID, cookie); status != http.StatusOK || !strings.Contains(body, "liker") {
			t.Errorf("%s liked users of private comment: status %d body %s", name, status, body)
		}
	}
	// 私密评论的作者本人可读
	if status, _ := likedUsers(constant.TargetTypeComment, privateComment.ID, loginCookie(t, liker)); status != http.StatusOK {
		t.Errorf("commenter liked users of own private comment: status %d", status)
	}

	// 不存在的目标与未知类型
	if status, _ := likedUsers(constant.TargetTypePost, 9999, guest); status != http.StatusNotFound {
		t.Errorf("liked users of missing post: status %d, want 404", status)
	}
	if status, _ := likedUsers(constant.TargetTypeComment, 9999, guest); status != http.StatusNotFound {
		t.Errorf("liked users of missing comment: status %d, want 404", status)
	}
	if status, _ := likedUsers("user", liker.ID, guest); status != http.StatusBadRequest {
		t.Errorf("liked users of unknown target type: status %d, want 400", status)
	}
}
