package tasks

import (
	"context"
	"fmt"
	"runtime/debug"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// runPeriodically 启动后立即执行一次 fn，之后每隔 interval 执行一次。
// 多实例部署时每一轮只有一个实例认领执行；认领有效期略短于周期，各实例的时间差不会导致整轮都被跳过
func runPeriodically(task string, interval time.Duration, fn func()) {
	go func() {
		for {
			if sharedstate.ClaimRound(task, interval*9/10) {
				runSafely(task, fn)
			}
			time.Sleep(interval)
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
