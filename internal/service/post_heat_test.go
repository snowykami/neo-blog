package service

import (
	"context"
	"math"
	"strconv"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestPostHeatScore(t *testing.T) {
	now := time.Now()
	day := 24 * time.Hour
	cases := []struct {
		name   string
		views  uint64
		events []weightedEvent
		want   float64
	}{
		{"无互动", 0, nil, 0},
		{"累计浏览取对数", 99, nil, math.Log(100)},
		{"刚发生的访问", 0, []weightedEvent{{heatWeightVisit, now}}, 1},
		{"一个半衰期前的点赞", 0, []weightedEvent{{heatWeightLike, now.Add(-14 * day)}}, 2.5},
		{"超出统计窗口不计", 0, []weightedEvent{{heatWeightComment, now.Add(-91 * day)}}, 0},
		{"未来时间按当前处理", 0, []weightedEvent{{heatWeightVisit, now.Add(time.Hour)}}, 1},
	}
	for _, c := range cases {
		if got := postHeatScore(c.views, c.events, now); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestViewCountFromVisitReport(t *testing.T) {
	author, admin, _, post, _ := setupEditTest(t)
	svc := NewVisitService()
	anon := context.Background()
	views := func() uint64 { return reloadPost(t, post.ID).ViewCount }
	report := func(ctx context.Context, key, ua string, dnt bool) string {
		k, svcerr := svc.Report(ctx, &dto.ReportVisitReq{Path: "/p/1", TargetType: constant.TargetTypePost, TargetID: post.ID}, key, testIP, ua, dnt)
		if svcerr != nil {
			t.Fatalf("report: %v", svcerr)
		}
		return k
	}

	// 读取文章（含编辑器加载草稿）不再计数
	if _, svcerr := NewPostService().GetPostSlugOrId(author, strconv.Itoa(int(post.ID))); svcerr != nil || views() != 0 {
		t.Fatalf("get post should not count view: err=%v views=%d", svcerr, views())
	}

	key := report(anon, "", testChromeUA, false)
	if views() != 1 {
		t.Fatalf("first visit should count, views=%d", views())
	}
	// 去重窗口内的刷新、爬虫、管理员不计数
	report(anon, key, testChromeUA, false)
	report(anon, "", "Mozilla/5.0 (compatible; Googlebot/2.1)", false)
	report(admin, "", testChromeUA, false)
	if views() != 1 {
		t.Fatalf("dedup/bot/admin should not count, views=%d", views())
	}
	// 请勿追踪的访问只匿名计数，同样累加浏览量
	report(anon, "", testChromeUA, true)
	if views() != 2 {
		t.Fatalf("dnt visit should count, views=%d", views())
	}
}

func TestPostHeatRefresh(t *testing.T) {
	author, _, _, postA, _ := setupEditTest(t)
	db := repo.GetDB()
	var authorUser, otherUser model.User
	db.Where("username = ?", "author").First(&authorUser)
	db.Where("username = ?", "other").First(&otherUser)
	postBID, svcerr := NewPostService().CreatePost(author, &dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{Title: "b", Content: "<p>b</p>"}})
	if svcerr != nil {
		t.Fatalf("create post: %v", svcerr)
	}
	now := time.Now()
	ago := func(days int) time.Time { return now.Add(-time.Duration(days) * 24 * time.Hour) }
	visit := func(postID uint, userID *uint, at time.Time) {
		db.Create(&model.VisitLog{Action: constant.VisitActionVisit, TargetType: constant.TargetTypePost, TargetID: postID, UserID: userID, Path: "/p", CreatedAt: at})
	}
	create := func(v any) {
		if err := db.Create(v).Error; err != nil {
			t.Fatalf("create %T: %v", v, err)
		}
	}

	// A：3 次访问 + 1 个他人点赞 = 3 + 5
	for range 3 {
		visit(postA.ID, nil, now)
	}
	create(&model.Like{TargetType: constant.TargetTypePost, TargetID: postA.ID, UserID: otherUser.ID})
	// B：30 天前 1 次访问；他人 2 条评论只算 1 次；作者本人的访问、点赞、评论都不计
	visit(postBID, nil, ago(30))
	visit(postBID, &authorUser.ID, now)
	create(&model.Like{TargetType: constant.TargetTypePost, TargetID: postBID, UserID: authorUser.ID})
	for _, c := range []*model.Comment{
		{UserID: otherUser.ID, TargetID: postBID, TargetType: constant.TargetTypePost, Content: "1"},
		{UserID: otherUser.ID, TargetID: postBID, TargetType: constant.TargetTypePost, Content: "2"},
		{UserID: authorUser.ID, TargetID: postBID, TargetType: constant.TargetTypePost, Content: "3"},
	} {
		create(c)
	}
	// 超出统计窗口的访问不计
	visit(postBID, nil, ago(120))

	svc := NewPostHeatService()
	if updated, err := svc.Refresh(now); err != nil || updated != 2 {
		t.Fatalf("refresh: updated=%d err=%v", updated, err)
	}
	wantB := uint64(math.Round((math.Exp2(-30.0/14) + heatWeightComment) * heatScale))
	if a, b := reloadPost(t, postA.ID).Heat, reloadPost(t, postBID).Heat; a != 80 || b != wantB {
		t.Fatalf("heat: A=%d want 80, B=%d want %d", a, b, wantB)
	}
	// 数据未变时不重复写入
	if updated, err := svc.Refresh(now); err != nil || updated != 0 {
		t.Fatalf("second refresh: updated=%d err=%v", updated, err)
	}
	// 一个半衰期后互动的贡献减半
	if _, err := svc.Refresh(now.Add(14 * 24 * time.Hour)); err != nil || reloadPost(t, postA.ID).Heat != 40 {
		t.Fatalf("decayed heat of A: %d", reloadPost(t, postA.ID).Heat)
	}
}
