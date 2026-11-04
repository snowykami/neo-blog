package agentrunner

import (
	"context"
	"math/rand/v2"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/sirupsen/logrus"
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
// 收到退出信号后不再领取新任务；已领取的任务继续执行，进程退出时未完成的任务在租约到期后重新入队
func Start(workers int) {
	if workers <= 0 {
		logrus.Info("ai agent workers are disabled on this instance")
		return
	}
	ctx, _ := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	go workLoop(ctx, workers)
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
					go func() {
						defer wg.Done()
						defer func() {
							if r := recover(); r != nil {
								logrus.Errorf("agent run %d panic: %v", run.RunID, r)
							}
							busy.Add(-1)
							select {
							case finished <- struct{}{}:
							default:
							}
						}()
						// 已领取的任务不随退出信号中断，尽量在进程退出前回报结果
						processRun(context.Background(), site, &run)
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
