package service

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func createPublicPosts(t *testing.T, userID uint, titles ...string) []uint {
	t.Helper()
	ids := make([]uint, 0, len(titles))
	for _, title := range titles {
		post := &model.Post{UserID: userID, PostBase: model.PostBase{Title: title, Content: "<p>" + title + "</p>"}}
		if err := repo.GetDB().Create(post).Error; err != nil {
			t.Fatalf("create post: %v", err)
		}
		ids = append(ids, post.ID)
	}
	return ids
}

func pinnedIDs(t *testing.T, ctx context.Context) []uint {
	t.Helper()
	posts, svcerr := NewPostService().ListPinnedPosts(ctx)
	if svcerr != nil {
		t.Fatalf("list pinned: %v", svcerr)
	}
	ids := make([]uint, 0, len(posts))
	for _, p := range posts {
		ids = append(ids, p.ID)
	}
	return ids
}

func assertCode(t *testing.T, svcerr *errs.ServiceError, status int, code string) {
	t.Helper()
	if svcerr == nil || svcerr.Code != status || svcerr.Message != code {
		t.Fatalf("error = %v, want %d %s", svcerr, status, code)
	}
}

// 只有管理员能置顶；最多 3 篇，后置顶的在前；已置顶的再次置顶只改到期时间
func TestSetPostPin(t *testing.T) {
	author, admin, _, privatePost, _ := setupEditTest(t)
	authorUser, _ := repo.User.GetUserByUsername("author")
	ids := createPublicPosts(t, authorUser.ID, "a", "b", "c", "d")
	svc := NewPostService()

	_, svcerr := svc.SetPostPin(author, &dto.SetPostPinReq{ID: ids[0], Pinned: true})
	assertCode(t, svcerr, http.StatusForbidden, "permission_denied")

	for _, id := range ids[:3] {
		if _, svcerr := svc.SetPostPin(admin, &dto.SetPostPinReq{ID: id, Pinned: true}); svcerr != nil {
			t.Fatalf("pin %d: %v", id, svcerr)
		}
		time.Sleep(5 * time.Millisecond) // 置顶时间不同，顺序确定
	}
	if got := pinnedIDs(t, context.Background()); len(got) != 3 || got[0] != ids[2] || got[2] != ids[0] {
		t.Fatalf("pinned = %v, want latest first %v", got, []uint{ids[2], ids[1], ids[0]})
	}

	_, svcerr = svc.SetPostPin(admin, &dto.SetPostPinReq{ID: ids[3], Pinned: true})
	assertCode(t, svcerr, http.StatusConflict, "pinned_posts_limit")

	// 已置顶的文章再次置顶：不占新名额，置顶时间不变，只改到期时间
	until := time.Now().Add(48 * time.Hour)
	post, svcerr := svc.SetPostPin(admin, &dto.SetPostPinReq{ID: ids[0], Pinned: true, PinnedUntil: &until})
	if svcerr != nil || post.PinnedUntil == nil || !post.Pinned {
		t.Fatalf("update until: %v %+v", svcerr, post)
	}
	if got := pinnedIDs(t, context.Background()); got[2] != ids[0] {
		t.Fatalf("re-pin should keep order, got %v", got)
	}

	past := time.Now().Add(-time.Hour)
	_, svcerr = svc.SetPostPin(admin, &dto.SetPostPinReq{ID: ids[3], Pinned: true, PinnedUntil: &past})
	assertCode(t, svcerr, http.StatusBadRequest, "pinned_until_in_past")

	// 取消一篇后可以置顶新的
	if _, svcerr := svc.SetPostPin(admin, &dto.SetPostPinReq{ID: ids[1], Pinned: false}); svcerr != nil {
		t.Fatalf("unpin: %v", svcerr)
	}
	if _, svcerr := svc.SetPostPin(admin, &dto.SetPostPinReq{ID: ids[3], Pinned: true}); svcerr != nil {
		t.Fatalf("pin after unpin: %v", svcerr)
	}
	if got := pinnedIDs(t, context.Background()); len(got) != 3 || got[0] != ids[3] {
		t.Fatalf("pinned = %v, want %d first", got, ids[3])
	}

	// 到期的置顶不算数：不显示、不占名额
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", ids[2]).Update("pinned_until", past).Error; err != nil {
		t.Fatalf("expire pin: %v", err)
	}
	// 直接改库模拟时间流逝：访客读取的置顶列表有短时缓存（到期最多晚 repo.PostGuestCacheTTL 生效），这里手动作废
	repo.InvalidatePostCache()
	if got := pinnedIDs(t, context.Background()); len(got) != 2 {
		t.Fatalf("expired pin still listed: %v", got)
	}
	// 私密文章置顶后读者看不到，后台能看到
	if _, svcerr := svc.SetPostPin(admin, &dto.SetPostPinReq{ID: privatePost.ID, Pinned: true}); svcerr != nil {
		t.Fatalf("pin private post: %v", svcerr)
	}
	if got := pinnedIDs(t, context.Background()); len(got) != 2 {
		t.Fatalf("private pinned post visible to readers: %v", got)
	}
	all, svcerr := svc.ListPinnedPostsAdmin(admin)
	if svcerr != nil || len(all) != 3 || all[0].ID != privatePost.ID {
		t.Fatalf("admin pinned list: %v %d", svcerr, len(all))
	}
	_, svcerr = svc.ListPinnedPostsAdmin(author)
	assertCode(t, svcerr, http.StatusForbidden, "permission_denied")
}

// 置顶只在首页默认列表生效：首页列表排除置顶文章，有筛选或其他列表时按正常顺序出现
func TestListPostsWithPinned(t *testing.T) {
	_, admin, _, _, label := setupEditTest(t)
	authorUser, _ := repo.User.GetUserByUsername("author")
	ids := createPublicPosts(t, authorUser.ID, "old", "pinned", "new")
	labeled := &model.Post{}
	labeled.ID = ids[1]
	if err := repo.GetDB().Model(labeled).Association("Labels").Append(label); err != nil {
		t.Fatalf("label post: %v", err)
	}
	if _, svcerr := NewPostService().SetPostPin(admin, &dto.SetPostPinReq{ID: ids[1], Pinned: true}); svcerr != nil {
		t.Fatalf("pin: %v", svcerr)
	}
	list := func(req dto.ListPostReq) []uint {
		req.Page, req.Size, req.OrderBy, req.Desc = 1, 10, "created_at", true
		posts, _, svcerr := NewPostService().ListPosts(context.Background(), &req)
		if svcerr != nil {
			t.Fatalf("list: %v", svcerr)
		}
		ids := []uint{}
		for _, p := range posts {
			ids = append(ids, p.ID)
		}
		return ids
	}
	if got := list(dto.ListPostReq{WithPinned: true}); len(got) != 2 || got[0] != ids[2] || got[1] != ids[0] {
		t.Fatalf("home list = %v, want pinned post excluded", got)
	}
	// 没有请求置顶的列表（归档、侧栏等）按发布时间排，置顶文章在它本来的位置
	if got := list(dto.ListPostReq{}); len(got) != 3 || got[1] != ids[1] {
		t.Fatalf("plain list = %v, want natural order", got)
	}
	// 有筛选时忽略 with_pinned
	if got := list(dto.ListPostReq{WithPinned: true, Label: label.Slug}); len(got) != 1 || got[0] != ids[1] {
		t.Fatalf("filtered list = %v, want the pinned post in place", got)
	}
}
