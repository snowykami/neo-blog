package service

import (
	"context"
	"net/http"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 分类全站共享：编辑者可以新建（写文章时用），改名与删除只有管理员可以；普通用户什么都不能写
func TestCategoryPermissions(t *testing.T) {
	editor, admin, _, _, _ := setupEditTest(t)
	user := &model.User{Username: "plain", Email: "plain@test.local", Role: constant.RoleUser}
	if err := repo.GetDB().Create(user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	userCtx := context.WithValue(context.Background(), "user_id", user.ID)
	svc := NewCategoryService()

	_, svcerr := svc.CreateCategory(userCtx, &dto.CategoryDto{Name: "u", Slug: "u"})
	expectCode(t, svcerr, http.StatusForbidden, "user create category")
	_, svcerr = svc.CreateCategory(context.Background(), &dto.CategoryDto{Name: "g", Slug: "g"})
	expectCode(t, svcerr, http.StatusForbidden, "guest create category")

	id, svcerr := svc.CreateCategory(editor, &dto.CategoryDto{Name: "Go", Slug: "go"})
	if svcerr != nil {
		t.Fatalf("editor create category: %v", svcerr)
	}
	_, svcerr = svc.CreateCategory(editor, &dto.CategoryDto{Name: "Go2", Slug: "go"})
	expectCode(t, svcerr, http.StatusConflict, "duplicate slug")
	if svcerr.Field != "slug" {
		t.Fatalf("duplicate slug should point at slug, got %q", svcerr.Field)
	}
	_, svcerr = svc.CreateCategory(editor, &dto.CategoryDto{Name: "Go", Slug: "go-2"})
	expectCode(t, svcerr, http.StatusConflict, "duplicate name")
	if svcerr.Field != "name" {
		t.Fatalf("duplicate name should point at name, got %q", svcerr.Field)
	}

	_, svcerr = svc.UpdateCategory(editor, &dto.CategoryDto{ID: id, Name: "Golang", Slug: "golang"})
	expectCode(t, svcerr, http.StatusForbidden, "editor rename category")
	expectCode(t, svc.DeleteCategory(editor, id), http.StatusForbidden, "editor delete category")
	if category, err := repo.Category.GetByID(id); err != nil || category.Name != "Go" {
		t.Fatalf("category should be untouched after forbidden writes, got %+v (%v)", category, err)
	}

	if _, svcerr := svc.UpdateCategory(admin, &dto.CategoryDto{ID: id, Name: "Golang", Slug: "golang"}); svcerr != nil {
		t.Fatalf("admin rename category: %v", svcerr)
	}
	if category, _ := repo.Category.GetByID(id); category.Name != "Golang" || category.Slug != "golang" {
		t.Fatalf("rename should apply, got %+v", category)
	}
	_, svcerr = svc.UpdateCategory(admin, &dto.CategoryDto{ID: 99999, Name: "x", Slug: "x"})
	expectCode(t, svcerr, http.StatusNotFound, "rename missing category")
	expectCode(t, svc.DeleteCategory(admin, 99999), http.StatusNotFound, "delete missing category")
}

// 删除分类后原属该分类的文章变为未分类，名称与 slug 可以立即复用
func TestDeleteCategoryClearsPostReference(t *testing.T) {
	editor, admin, _, post, _ := setupEditTest(t)
	id, svcerr := NewCategoryService().CreateCategory(editor, &dto.CategoryDto{Name: "Go", Slug: "go"})
	if svcerr != nil {
		t.Fatalf("create category: %v", svcerr)
	}
	if _, svcerr := NewPostService().UpdatePost(editor, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{CategoryID: &id}}); svcerr != nil {
		t.Fatalf("set category: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); got.CategoryID == nil || *got.CategoryID != id {
		t.Fatalf("category should be set")
	}
	if svcerr := NewCategoryService().DeleteCategory(admin, id); svcerr != nil {
		t.Fatalf("admin delete category: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); got.CategoryID != nil {
		t.Fatalf("post category should be cleared, got %d", *got.CategoryID)
	}
	var count int64
	repo.GetDB().Unscoped().Model(&model.Category{}).Where("id = ?", id).Count(&count)
	if count != 0 {
		t.Fatalf("category should be hard deleted")
	}
	if _, svcerr := NewCategoryService().CreateCategory(editor, &dto.CategoryDto{Name: "Go", Slug: "go"}); svcerr != nil {
		t.Fatalf("recreate category with same name and slug: %v", svcerr)
	}
}

// 标签同理：编辑者可以新建，改名与删除只有管理员可以；删除时解除与文章的关联
func TestLabelPermissionsAndDelete(t *testing.T) {
	editor, admin, _, post, label := setupEditTest(t)
	svc := NewLabelService()

	if _, svcerr := svc.CreateLabel(editor, &dto.CreateLabelReq{LabelBase: dto.LabelBase{Name: "rust", Slug: "rust"}}); svcerr != nil {
		t.Fatalf("editor create label: %v", svcerr)
	}
	_, svcerr := svc.CreateLabel(context.Background(), &dto.CreateLabelReq{LabelBase: dto.LabelBase{Name: "g", Slug: "g"}})
	expectCode(t, svcerr, http.StatusForbidden, "guest create label")

	_, svcerr = svc.UpdateLabel(editor, &dto.UpdateLabelReq{ID: label.ID, LabelBase: dto.LabelBase{Name: "golang", Slug: "golang"}})
	expectCode(t, svcerr, http.StatusForbidden, "editor rename label")
	expectCode(t, svc.DeleteLabel(editor, label.ID), http.StatusForbidden, "editor delete label")
	expectCode(t, svc.DeleteLabel(admin, 99999), http.StatusNotFound, "delete missing label")
	_, svcerr = svc.UpdateLabel(admin, &dto.UpdateLabelReq{ID: 99999, LabelBase: dto.LabelBase{Name: "x", Slug: "x"}})
	expectCode(t, svcerr, http.StatusNotFound, "rename missing label")

	if _, svcerr := svc.UpdateLabel(admin, &dto.UpdateLabelReq{ID: label.ID, LabelBase: dto.LabelBase{Name: "golang", Slug: "golang"}}); svcerr != nil {
		t.Fatalf("admin rename label: %v", svcerr)
	}
	if svcerr := svc.DeleteLabel(admin, label.ID); svcerr != nil {
		t.Fatalf("admin delete label: %v", svcerr)
	}
	var links int64
	repo.GetDB().Table("post_labels").Where("post_id = ? AND label_id = ?", post.ID, label.ID).Count(&links)
	if links != 0 {
		t.Fatalf("post label link should be removed")
	}
}
