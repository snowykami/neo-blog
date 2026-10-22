package service

import (
	"context"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// setupFileTest 创建普通用户、编辑者、管理员，并各自上传若干文件记录
func setupFileTest(t *testing.T) (user, editor, admin context.Context) {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	users := []*model.User{
		{Username: "user", Email: "user@test.local", Role: constant.RoleUser},
		{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor},
		{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin},
	}
	for _, u := range users {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	files := []*model.File{
		{Hash: "a", UserID: users[0].ID, Name: "avatar.png", MimeType: "image/png"},
		{Hash: "b", UserID: users[1].ID, Name: "cover.jpg", MimeType: "image/jpeg"},
		{Hash: "c", UserID: users[1].ID, Name: "song.mp3", MimeType: "audio/mpeg"},
		{Hash: "d", UserID: users[1].ID, Name: "doc.pdf", MimeType: "application/pdf"},
		{Hash: "e", UserID: users[2].ID, Name: "logo.webp", MimeType: "image/webp"},
	}
	for _, f := range files {
		if err := repo.File.Create(f); err != nil {
			t.Fatalf("create file: %v", err)
		}
	}
	ctxOf := func(u *model.User) context.Context { return context.WithValue(context.Background(), "user_id", u.ID) }
	return ctxOf(users[0]), ctxOf(users[1]), ctxOf(users[2])
}

func listFileNames(t *testing.T, ctx context.Context, req *dto.FileListReq) []string {
	t.Helper()
	req.Page = 1
	files, total, svcerr := NewFileService().ListFiles(ctx, req)
	if svcerr != nil {
		t.Fatalf("list files: %v", svcerr)
	}
	if int(total) != len(files) {
		t.Fatalf("total %d != len %d", total, len(files))
	}
	names := make([]string, 0, len(files))
	for _, f := range files {
		names = append(names, f.Name)
	}
	return names
}

// 普通用户与编辑者默认只能看到自己的文件
func TestListFilesOnlyOwnByDefault(t *testing.T) {
	user, editor, admin := setupFileTest(t)
	if got := listFileNames(t, user, &dto.FileListReq{}); len(got) != 1 || got[0] != "avatar.png" {
		t.Fatalf("user files = %v", got)
	}
	if got := listFileNames(t, editor, &dto.FileListReq{Scope: constant.FileScopeMine}); len(got) != 3 {
		t.Fatalf("editor files = %v", got)
	}
	// 管理员不传 scope 时同样只看自己的
	if got := listFileNames(t, admin, &dto.FileListReq{}); len(got) != 1 || got[0] != "logo.webp" {
		t.Fatalf("admin own files = %v", got)
	}
}

// 只有管理员可以查看全部文件
func TestListFilesScopeAllRequiresAdmin(t *testing.T) {
	user, editor, admin := setupFileTest(t)
	for name, ctx := range map[string]context.Context{"user": user, "editor": editor} {
		_, _, svcerr := NewFileService().ListFiles(ctx, &dto.FileListReq{Scope: constant.FileScopeAll})
		if svcerr == nil || svcerr.Code != http.StatusForbidden {
			t.Fatalf("%s scope=all should be forbidden, got %v", name, svcerr)
		}
	}
	if got := listFileNames(t, admin, &dto.FileListReq{Scope: constant.FileScopeAll}); len(got) != 5 {
		t.Fatalf("admin all files = %v", got)
	}
	// 未登录不可访问
	if _, _, svcerr := NewFileService().ListFiles(context.Background(), &dto.FileListReq{}); svcerr == nil || svcerr.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous should be unauthorized, got %v", svcerr)
	}
}

// 按类型与关键字筛选，非法参数报错
func TestListFilesFilters(t *testing.T) {
	_, editor, admin := setupFileTest(t)
	if got := listFileNames(t, editor, &dto.FileListReq{Type: constant.FileTypeImage}); len(got) != 1 || got[0] != "cover.jpg" {
		t.Fatalf("editor images = %v", got)
	}
	if got := listFileNames(t, editor, &dto.FileListReq{Type: constant.FileTypeOther}); len(got) != 1 || got[0] != "doc.pdf" {
		t.Fatalf("editor other = %v", got)
	}
	if got := listFileNames(t, admin, &dto.FileListReq{Scope: constant.FileScopeAll, Type: constant.FileTypeImage}); len(got) != 3 {
		t.Fatalf("admin all images = %v", got)
	}
	if got := listFileNames(t, admin, &dto.FileListReq{Scope: constant.FileScopeAll, Query: "co"}); len(got) != 1 || got[0] != "cover.jpg" {
		t.Fatalf("admin query = %v", got)
	}
	for _, req := range []*dto.FileListReq{{Scope: "everyone"}, {Type: "exe"}} {
		if _, _, svcerr := NewFileService().ListFiles(admin, req); svcerr == nil || svcerr.Code != http.StatusBadRequest {
			t.Fatalf("invalid req %+v should be bad request, got %v", req, svcerr)
		}
	}
}
