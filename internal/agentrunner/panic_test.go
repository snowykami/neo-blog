package agentrunner

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 执行中 panic 的运行立即记为失败并带上 panic 摘要，不再停在执行中等租约过期
func TestReportPanicMarksRunFailed(t *testing.T) {
	setupWorkerTest(t)
	now := time.Now()
	until := now.Add(time.Minute)
	run := &model.AgentRun{AgentID: 1, Kind: constant.AgentRunKindBrowse, Trigger: constant.AgentTriggerBrowse, Status: constant.AgentRunStatusLeased, ScheduledAt: now, LeaseUntil: &until, Attempts: 1}
	if err := repo.AIAgent.CreateRun(run); err != nil {
		t.Fatal(err)
	}
	reportPanic(run.ID, "boom")
	got, err := repo.AIAgent.GetRun(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != constant.AgentRunStatusFailed || got.Error != "panic: boom" || got.FinishedAt == nil || got.LeaseUntil != nil {
		t.Fatalf("run after panic = %+v", got)
	}
	// 已经结束的运行再回报不会出错
	reportPanic(run.ID, "again")
}
