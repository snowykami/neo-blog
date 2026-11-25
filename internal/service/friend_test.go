package service

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"slices"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func setupFriendTest(t *testing.T) (user, otherUser, editor, admin *model.User) {
	t.Helper()
	_ = sharedstate.Init("", "")
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "friend_test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	// 开启 SQLite 外键强约束，与生产环境 PostgreSQL 外键检查行为保持一致
	if err := repo.GetDB().Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable sqlite foreign_keys: %v", err)
	}
	users := []*model.User{
		{Username: "alice", Email: "alice@test.local", Role: constant.RoleUser},
		{Username: "bob", Email: "bob@test.local", Role: constant.RoleUser},
		{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor},
		{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin},
	}
	for _, u := range users {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	return users[0], users[1], users[2], users[3]
}

func TestFriendQuotaReviewAndAccessControl(t *testing.T) {
	alice, bob, editor, admin := setupFriendTest(t)
	svc := NewFriendService()

	// 1. 默认预设分组自动初始化且顺序与 Spec 对齐
	pubInitial, svcerr := svc.ListPublicFriends(context.Background(), "")
	if svcerr != nil {
		t.Fatalf("list public friends: %v", svcerr)
	}
	gotSlugs := make([]string, 0, len(pubInitial.Groups))
	for _, g := range pubInitial.Groups {
		gotSlugs = append(gotSlugs, g.Slug)
	}
	wantSlugs := []string{"friends", "seniors", "official", "projects", "others"}
	if !slices.Equal(gotSlugs, wantSlugs) {
		t.Fatalf("default group slugs got %v, want %v", gotSlugs, wantSlugs)
	}
	firstGroupID := pubInitial.Groups[0].ID

	// 2. 普通用户最多可添加 5 条，第 6 条被拦截；删除 1 条后额度立即恢复
	var createdIDs []uint
	for i := 1; i <= 5; i++ {
		item, err := svc.CreateMyFriendLink(userCtx(alice), &dto.UpsertMyFriendLinkReq{
			GroupID:     firstGroupID,
			Name:        fmt.Sprintf("Alice Blog %d", i),
			URL:         fmt.Sprintf("https://alice-%d.example.com", i),
			Avatar:      "https://alice.example.com/avatar.png",
			Description: "Personal tech blog",
			ColorKey:    "cherry-blossom",
		})
		if err != nil {
			t.Fatalf("create link %d: %v", i, err)
		}
		// 未配置 AI 接口时默认进入 pre_approved 待人工复核，不直接对外公开
		if item.Status != model.FriendStatusPreApproved {
			t.Fatalf("expected pre_approved without AI config, got %s", item.Status)
		}
		createdIDs = append(createdIDs, item.ID)
	}

	if _, err := svc.CreateMyFriendLink(userCtx(alice), &dto.UpsertMyFriendLinkReq{
		GroupID: firstGroupID,
		Name:    "Overflow",
		URL:     "https://alice-6.example.com",
		Avatar:  "https://alice.example.com/avatar.png",
	}); err == nil || err.Code != http.StatusBadRequest {
		t.Fatalf("expected 6th link to fail quota check, got %v", err)
	}

	// 他人与编辑者不可越权删除或审核 Alice 的友链
	if err := svc.DeleteMyFriendLink(userCtx(bob), createdIDs[0]); err == nil || err.Code != http.StatusForbidden {
		t.Fatalf("expected bob delete forbidden, got %v", err)
	}
	if _, err := svc.AdminReviewLink(userCtx(editor), createdIDs[0], &dto.AdminReviewFriendLinkReq{Status: model.FriendStatusApproved}); err == nil || err.Code != http.StatusForbidden {
		t.Fatalf("expected editor review forbidden, got %v", err)
	}

	// Alice 删除第 5 条后可再次创建新友链
	if err := svc.DeleteMyFriendLink(userCtx(alice), createdIDs[4]); err != nil {
		t.Fatalf("alice delete link: %v", err)
	}
	replacement, err := svc.CreateMyFriendLink(userCtx(alice), &dto.UpsertMyFriendLinkReq{
		GroupID: firstGroupID,
		Name:    "Alice Replacement",
		URL:     "https://alice-new.example.com",
		Avatar:  "https://alice.example.com/avatar.png",
	})
	if err != nil {
		t.Fatalf("create after delete quota recovery failed: %v", err)
	}
	_ = replacement

	// 3. 管理员审核通过第 1 条后对外公开可见；随后普通用户修改该友链，必须重新退回待审状态且从公开列表隐藏
	if _, err := svc.AdminReviewLink(userCtx(admin), createdIDs[0], &dto.AdminReviewFriendLinkReq{
		Status:     model.FriendStatusApproved,
		ReviewNote: "Looks great",
	}); err != nil {
		t.Fatalf("admin approve: %v", err)
	}
	pubAfterApprove, _ := svc.ListPublicFriends(context.Background(), "friends")
	if len(pubAfterApprove.Groups) != 1 || len(pubAfterApprove.Groups[0].Links) != 1 {
		t.Fatalf("expected 1 public approved link, got %+v", pubAfterApprove.Groups)
	}

	updatedMine, err := svc.UpdateMyFriendLink(userCtx(alice), createdIDs[0], &dto.UpsertMyFriendLinkReq{
		GroupID:     firstGroupID,
		Name:        "Alice Blog 1 Renamed",
		URL:         "https://alice-1.example.com",
		Avatar:      "https://alice.example.com/avatar2.png",
		Description: "Updated bio",
		ColorKey:    "lavender",
	})
	if err != nil {
		t.Fatalf("alice update: %v", err)
	}
	if updatedMine.Status == model.FriendStatusApproved {
		t.Fatalf("user modification must re-enter review, got status=%s", updatedMine.Status)
	}
	pubAfterEdit, _ := svc.ListPublicFriends(context.Background(), "friends")
	if len(pubAfterEdit.Groups[0].Links) != 0 {
		t.Fatalf("re-reviewed link must not stay public before approval")
	}

	// 4. 私有分组（is_public=false）对访客与普通用户完全不可见，但携带管理员 friends:read Token 可按 ?group=slug 读取
	privGroup, err := svc.AdminCreateGroup(userCtx(admin), &dto.AdminUpsertFriendGroupReq{
		PresetKey:         model.FriendGroupPresetCustom,
		Name:              "Internal Sites",
		Slug:              "internal-sites",
		IsPublic:          false,
		SkipBacklinkCheck: true,
	})
	if err != nil {
		t.Fatalf("create private group: %v", err)
	}
	if _, err := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:  privGroup.ID,
		Name:     "Liteyuki Internal",
		URL:      "https://internal.liteyuki.org",
		Avatar:   "https://internal.liteyuki.org/logo.png",
		ColorKey: "sky",
		Status:   model.FriendStatusApproved,
	}); err != nil {
		t.Fatalf("create link in private group: %v", err)
	}

	anonPriv, _ := svc.ListPublicFriends(context.Background(), "internal-sites")
	if len(anonPriv.Groups) != 0 {
		t.Fatalf("anonymous request must not see private group, got %+v", anonPriv.Groups)
	}
	userPriv, _ := svc.ListPublicFriends(userCtx(alice), "internal-sites")
	if len(userPriv.Groups) != 0 {
		t.Fatalf("regular user must not see private group, got %+v", userPriv.Groups)
	}

	tokenCtx := ctxutils.WithAPIToken(context.Background(), &ctxutils.APITokenInfo{
		Name:   "partner-site",
		Scopes: []string{constant.ScopeFriendsRead},
	})
	tokPriv, err := svc.ListPublicFriends(tokenCtx, "internal-sites")
	if err != nil || len(tokPriv.Groups) != 1 || len(tokPriv.Groups[0].Links) != 1 {
		t.Fatalf("friends:read token should read private group, got err=%v groups=%+v", err, tokPriv)
	}

	// 5. 后台分组重排同步改变公开返回顺序
	if err := svc.AdminReorderGroups(userCtx(admin), &dto.AdminReorderFriendGroupsReq{
		IDs: []uint{pubInitial.Groups[1].ID, pubInitial.Groups[0].ID},
	}); err != nil {
		t.Fatalf("reorder groups: %v", err)
	}
	reorderedPub, _ := svc.ListPublicFriends(context.Background(), "")
	if len(reorderedPub.Groups) < 2 || reorderedPub.Groups[0].Slug != "seniors" || reorderedPub.Groups[1].Slug != "friends" {
		t.Fatalf("expected reordered groups [seniors, friends, ...], got %s, %s", reorderedPub.Groups[0].Slug, reorderedPub.Groups[1].Slug)
	}

	// 6. 管理员新建友链默认站长托管（user_id=0），可转移给已注册用户管理并受 5 条额度约束，也可收回为站长托管
	adminSeedLink, err := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:  pubInitial.Groups[0].ID,
		Name:     "Migrated Friend",
		URL:      "https://migrated.sfkm.me",
		Avatar:   "https://migrated.sfkm.me/avatar.png",
		ColorKey: "ocean",
		Status:   model.FriendStatusApproved,
	})
	if err != nil || adminSeedLink.UserID != 0 {
		t.Fatalf("admin created link should default to user_id=0, got %+v err=%v", adminSeedLink, err)
	}

	// alice 当前已满 5 条，转入应被额度拦截；转给 bob（0 条）应成功且保持 approved 状态
	if _, err := svc.AdminTransferLink(userCtx(admin), adminSeedLink.ID, &dto.AdminTransferFriendLinkReq{UserID: alice.ID}); err == nil || err.Message != "friend_quota_exceeded" {
		t.Fatalf("expected friend_quota_exceeded when transferring to full user alice, got %v", err)
	}
	transferred, err := svc.AdminTransferLink(userCtx(admin), adminSeedLink.ID, &dto.AdminTransferFriendLinkReq{UserID: bob.ID})
	if err != nil || transferred.UserID != bob.ID || transferred.Status != model.FriendStatusApproved {
		t.Fatalf("transfer to bob failed: got %+v err=%v", transferred, err)
	}
	bobMine, err := svc.GetMyFriendLinks(userCtx(bob))
	if err != nil || len(bobMine.Links) != 1 || bobMine.Links[0].ID != adminSeedLink.ID {
		t.Fatalf("bob should now own transferred link, got %+v err=%v", bobMine, err)
	}

	// 收回为站长托管（user_id=0）后，bob 名下友链清空
	reclaimed, err := svc.AdminTransferLink(userCtx(admin), adminSeedLink.ID, &dto.AdminTransferFriendLinkReq{UserID: 0})
	if err != nil || reclaimed.UserID != 0 || reclaimed.User != nil {
		t.Fatalf("reclaim to system failed: got %+v err=%v", reclaimed, err)
	}
	bobAfterReclaim, _ := svc.GetMyFriendLinks(userCtx(bob))
	if len(bobAfterReclaim.Links) != 0 {
		t.Fatalf("expected bob links back to 0 after reclaim, got %d", len(bobAfterReclaim.Links))
	}
}
