package service

import (
	"net/http"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"gorm.io/gorm"
)

func TestPostNeighbors(t *testing.T) {
	author, _, _, basePost, _ := setupEditTest(t)
	db := repo.GetDB()
	svc := NewPostService()

	// 先清空 setupEditTest 默认文章干扰
	if err := db.Unscoped().Where("id = ?", basePost.ID).Delete(&model.Post{}).Error; err != nil {
		t.Fatal(err)
	}
	repo.InvalidatePostCache()

	catA := model.Category{Name: "NB Tech", Slug: "nb-tech"}
	catB := model.Category{Name: "NB Life", Slug: "nb-life"}
	if err := db.Create(&catA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&catB).Error; err != nil {
		t.Fatal(err)
	}
	lblGo := model.Label{Name: "NB Go", Slug: "nb-go"}
	lblOtel := model.Label{Name: "NB OTel", Slug: "nb-otel"}
	if err := db.Create(&lblGo).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&lblOtel).Error; err != nil {
		t.Fatal(err)
	}

	var authorModel model.User
	if err := db.First(&authorModel).Error; err != nil {
		t.Fatal(err)
	}

	t0 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	makePost := func(title string, created time.Time, catID *uint, labels []model.Label, isPrivate, isDraft bool) model.Post {
		p := model.Post{
			Model:  gorm.Model{CreatedAt: created, UpdatedAt: created},
			UserID: authorModel.ID,
			PostBase: model.PostBase{
				Title:      title,
				Content:    "<p>" + title + "</p>",
				Type:       "markdown",
				CategoryID: catID,
				Labels:     labels,
				IsPrivate:  isPrivate,
				IsDraft:    isDraft,
			},
		}
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
		return p
	}

	pOldPublic := makePost("Old Public", t0, &catB.ID, nil, false, false)
	pPrevPrivate := makePost("Prev Private", t0.Add(time.Hour), &catA.ID, []model.Label{lblGo, lblOtel}, true, false)
	pPrevPublic := makePost("Prev Public", t0.Add(2*time.Hour), &catA.ID, []model.Label{lblGo}, false, false)
	pTarget := makePost("Target Post", t0.Add(3*time.Hour), &catA.ID, []model.Label{lblGo, lblOtel}, false, false)
	pNextDraft := makePost("Next Draft", t0.Add(4*time.Hour), &catA.ID, []model.Label{lblGo, lblOtel}, false, true)
	pNextPublic := makePost("Next Public", t0.Add(5*time.Hour), &catB.ID, nil, false, false)

	// 相关候选：
	// rBothLabelsAndCat: 2 个共享标签 (+4) + 同分类 (+1) = 5 分
	// rOneLabel: 1 个共享标签 (+2) = 2 分
	// rSameCatOnly: 同分类 (+1) = 1 分
	// rPrivateHighScore: 私密文章，即使满分也绝不可泄露
	// rDraftHighScore: 草稿文章，即使满分也绝不可泄露
	rSameCatOnly := makePost("Related Same Cat", t0.Add(6*time.Hour), &catA.ID, nil, false, false)
	rOneLabel := makePost("Related One Label", t0.Add(7*time.Hour), &catB.ID, []model.Label{lblGo}, false, false)
	rBothLabelsAndCat := makePost("Related Best Match", t0.Add(8*time.Hour), &catA.ID, []model.Label{lblGo, lblOtel}, false, false)
	rPrivateHighScore := makePost("Private Secret", t0.Add(9*time.Hour), &catA.ID, []model.Label{lblGo, lblOtel}, true, false)
	rDraftHighScore := makePost("Draft Secret", t0.Add(10*time.Hour), &catA.ID, []model.Label{lblGo, lblOtel}, false, true)
	repo.InvalidatePostCache()

	// 1. 私密 / 草稿 / 不存在的目标文章一律返回 404
	for _, badID := range []uint{pPrevPrivate.ID, pNextDraft.ID, rPrivateHighScore.ID, rDraftHighScore.ID, 999999} {
		if _, svcerr := svc.GetPostNeighbors(badID); svcerr == nil || svcerr.Code != http.StatusNotFound {
			t.Fatalf("id=%d expected 404, got %v", badID, svcerr)
		}
	}

	// 2. 公开目标文章：严格跳过中间私密/草稿，返回正确的上下篇，并按相关度排序 + 最新公开文章兜底凑满 4 篇
	res, svcerr := svc.GetPostNeighbors(pTarget.ID)
	if svcerr != nil {
		t.Fatalf("GetPostNeighbors failed: %v", svcerr)
	}
	if res.Prev == nil || res.Prev.ID != pPrevPublic.ID {
		t.Fatalf("expected Prev=%d, got %+v", pPrevPublic.ID, res.Prev)
	}
	if res.Next == nil || res.Next.ID != pNextPublic.ID {
		t.Fatalf("expected Next=%d, got %+v", pNextPublic.ID, res.Next)
	}
	if len(res.Related) != 4 {
		t.Fatalf("expected 4 related posts (3 scored + 1 fallback), got %d: %+v", len(res.Related), res.Related)
	}
	wantRelatedOrder := []uint{rBothLabelsAndCat.ID, rOneLabel.ID, rSameCatOnly.ID, pOldPublic.ID}
	for i, wantID := range wantRelatedOrder {
		if res.Related[i].ID != wantID {
			t.Fatalf("related[%d] = %d (%s), want %d", i, res.Related[i].ID, res.Related[i].Title, wantID)
		}
	}

	// 3. 将 Next 转为私密后，缓存立即失效，再次查询不再包含已私密化的文章
	isPriv := true
	if _, svcerr := svc.UpdatePost(author, &dto.CreateOrUpdatePostReq{
		ID:        pNextPublic.ID,
		IsPrivate: &isPriv,
	}); svcerr != nil {
		t.Fatalf("privatize next post: %v", svcerr)
	}
	resAfter, svcerr := svc.GetPostNeighbors(pTarget.ID)
	if svcerr != nil {
		t.Fatalf("GetPostNeighbors after privatize failed: %v", svcerr)
	}
	if resAfter.Next == nil || resAfter.Next.ID == pNextPublic.ID {
		t.Fatalf("expected privatized post %d to disappear from Next, got %+v", pNextPublic.ID, resAfter.Next)
	}
	for _, item := range resAfter.Related {
		if item.ID == pNextPublic.ID || item.ID == rPrivateHighScore.ID || item.ID == rDraftHighScore.ID {
			t.Fatalf("leaked non-public post in Related: %+v", item)
		}
	}
}
