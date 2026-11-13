package agentrunner

import (
	"context"
	"fmt"
	"math/rand/v2"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
)

// pollInterval 计划时间到点的任务不会触发通知，空闲时定期检查一次（测试中调短）
var pollInterval = 15 * time.Second

const (
	// 多副本的负载分摊：本实例每有一个任务在执行，领取前多等这么久，让较空闲的实例先领到；再加一点随机，避免同时争抢
	busyClaimDelay = 300 * time.Millisecond
	claimJitter    = 200 * time.Millisecond
)

// Start 启动本实例的 worker：最多同时执行 workers 个任务，workers 为 0 时本实例不执行任务。
// 新任务入队时各实例都会被唤醒（单实例经进程内存，多副本经 Redis），领取在全局锁内用条件更新抢占，同一任务只会被一个实例领到。
// ctx 结束（收到退出信号）后不再领取新任务；已领取的任务继续执行，进程退出时未完成的任务在租约到期后重新入队
func Start(ctx context.Context, workers int) {
	if workers <= 0 {
		logrus.Info("ai agent workers are disabled on this instance")
		return
	}
	done := make(chan struct{})
	workersDone = done
	go func() {
		workLoop(ctx, workers)
		close(done)
	}()
}

type inflightRun struct {
	leaseToken string
	cancel     context.CancelFunc
}

var (
	workersDone chan struct{} // workLoop 退出且已领取的任务都执行完时关闭；本实例未启动 worker 时为 nil
	inflight    sync.Map      // 本实例正在执行的任务 ID -> inflightRun
)

// Drain 进程退出前调用（Start 的 ctx 应已结束，不再领取新任务）：等待已领取的任务执行完，最多 timeout；
// 仍未完成的立即取消本实例执行并放回队列，由其他实例接着执行，不必等租约到期
func Drain(timeout time.Duration) {
	if workersDone == nil {
		return
	}
	select {
	case <-workersDone:
		return
	case <-time.After(timeout):
	}
	svc := service.NewAIAgentService()
	inflight.Range(func(key, value any) bool {
		entry := value.(inflightRun)
		entry.cancel()
		svc.ReleaseRun(key.(uint), entry.leaseToken)
		return true
	})
}

// workLoop 领取并分发任务，直到 ctx 结束；返回前等待已领取的任务执行完
func workLoop(ctx context.Context, workers int) {
	svc := service.NewAIAgentService()
	var busy atomic.Int32
	var wg sync.WaitGroup
	defer wg.Wait()
	finished := make(chan struct{}, workers)
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	logrus.Infof("ai agent workers started: %d", workers)
	for {
		wake := service.AgentRunWake()
		service.MarkAgentWorkersOnline()
		if inFlight := int(busy.Load()); inFlight < workers {
			delay := time.Duration(inFlight)*busyClaimDelay + rand.N(claimJitter)
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			runs, err := svc.ClaimRuns(ctx, workers-inFlight)
			if err != nil {
				logrus.Warnf("claim agent runs: %v", err)
			}
			if len(runs) > 0 {
				site := svc.AgentSite()
				for i := range runs {
					run := runs[i]
					busy.Add(1)
					wg.Add(1)
					execCtx, execCancel := context.WithCancel(context.Background())
					inflight.Store(run.RunID, inflightRun{leaseToken: run.LeaseToken, cancel: execCancel})
					go func() {
						defer wg.Done()
						defer execCancel()
						defer inflight.Delete(run.RunID)
						defer func() {
							if r := recover(); r != nil {
								logrus.Errorf("agent run %d panic: %v\n%s", run.RunID, r, debug.Stack())
								reportPanic(run.RunID, run.LeaseToken, r)
							}
							busy.Add(-1)
							select {
							case finished <- struct{}{}:
							default:
							}
						}()
						// 已领取的任务不随退出信号立即中断，尽量在 Drain 宽限期内回报结果；超时后由 Drain 取消并释放租约
						processRun(execCtx, site, &run)
					}()
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-ticker.C:
		case <-finished:
		}
	}
}

// reportPanic 执行中 panic 的运行立即记为失败并写入 panic 摘要，不必等租约过期后重试（同样的输入多半还会 panic）
func reportPanic(runID uint, leaseToken string, r any) {
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("report panic of agent run %d: %v", runID, r)
		}
	}()
	result := &dto.AgentCompleteReq{ID: runID, LeaseToken: leaseToken, Status: "failed", Error: fmt.Sprintf("panic: %v", r)}
	if svcerr := service.NewAIAgentService().Complete(context.Background(), result); svcerr != nil {
		logrus.Warnf("report panic of agent run %d: %v", runID, svcerr)
	}
}
