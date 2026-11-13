package tasks

import (
	"context"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

var (
	tasksCtxMu sync.RWMutex
	tasksCtx   = context.Background()
)

// SetContext 绑定进程退出信号上下文：收到退出信号后不再启动新一轮定时任务
func SetContext(ctx context.Context) {
	if ctx == nil {
		return
	}
	tasksCtxMu.Lock()
	tasksCtx = ctx
	tasksCtxMu.Unlock()
}

func stopDone() <-chan struct{} {
	tasksCtxMu.RLock()
	ch := tasksCtx.Done()
	tasksCtxMu.RUnlock()
	return ch
}

// runPeriodically 启动后立即执行一次 fn，之后每隔 interval 执行一次；收到退出信号后立即停止。
// 多实例部署时每一轮只有一个实例认领执行；认领有效期略短于周期，各实例的时间差不会导致整轮都被跳过
func runPeriodically(task string, interval time.Duration, fn func()) {
	go func() {
		done := stopDone()
		for {
			select {
			case <-done:
				return
			default:
			}
			if sharedstate.ClaimRound(task, interval*9/10) {
				runSafely(task, fn)
			}
			timer := time.NewTimer(interval)
			select {
			case <-done:
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}()
}

// runSafely 执行一轮后台任务：panic 时写日志并记为后端错误报告，不让整个进程退出（HTTP 请求有 recovery，后台协程没有）；
// 下一轮照常执行
func runSafely(task string, fn func()) {
	defer func() {
		if r := recover(); r != nil {
			stack := debug.Stack()
			logrus.Errorf("[task %s] panic: %v\n%s", task, r, stack)
			service.NewErrorReportService().RecordBackendError(context.Background(), service.BackendError{
				Panic:  true,
				Cause:  fmt.Sprint(r),
				Stack:  stack,
				Method: "TASK",
				Path:   task,
			})
		}
	}()
	fn()
}
