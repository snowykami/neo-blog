package repo

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 按指纹累计次数：已解决的问题再次出现时回到未处理并清掉解决时间；发布版本为空时保留上一次的（SQLite 与 Postgres 的 upsert 语句都要能跑）
func TestErrorReportUpsertIssue(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		at := time.Now()
		first, err := ErrorReport.UpsertIssue(&model.ErrorIssue{Fingerprint: "fp1", Source: constant.ErrorSourceBrowser, Kind: constant.ErrorKindError, Title: "TypeError: x", LastRelease: "v1", FirstSeenAt: at, LastSeenAt: at})
		if err != nil || first.Count != 1 || first.Status != constant.ErrorStatusUnresolved {
			t.Fatalf("first: %+v err=%v", first, err)
		}
		if err := ErrorReport.UpdateIssueStatus(first.ID, constant.ErrorStatusResolved, at); err != nil {
			t.Fatal(err)
		}
		later := at.Add(time.Minute)
		second, err := ErrorReport.UpsertIssue(&model.ErrorIssue{Fingerprint: "fp1", Title: "TypeError: x", FirstSeenAt: later, LastSeenAt: later})
		if err != nil || second.ID != first.ID || second.Count != 2 || second.Status != constant.ErrorStatusUnresolved || second.ResolvedAt != nil || second.LastRelease != "v1" {
			t.Fatalf("second: %+v err=%v", second, err)
		}
		// 忽略的问题继续计数但保持忽略
		if err := ErrorReport.UpdateIssueStatus(first.ID, constant.ErrorStatusIgnored, at); err != nil {
			t.Fatal(err)
		}
		third, err := ErrorReport.UpsertIssue(&model.ErrorIssue{Fingerprint: "fp1", LastRelease: "v2", FirstSeenAt: later, LastSeenAt: later})
		if err != nil || third.Count != 3 || third.Status != constant.ErrorStatusIgnored || third.LastRelease != "v2" {
			t.Fatalf("third: %+v err=%v", third, err)
		}
		// 清理：过期的事件与之后没再出现的问题一起删掉
		if err := ErrorReport.CreateEvent(&model.ErrorEvent{IssueID: first.ID, CreatedAt: at.AddDate(0, 0, -40)}); err != nil {
			t.Fatal(err)
		}
		events, issues, err := ErrorReport.DeleteBefore(at.AddDate(0, 0, -30))
		if err != nil || events != 1 || issues != 0 {
			t.Fatalf("cleanup: events=%d issues=%d err=%v", events, issues, err)
		}
	})
}
