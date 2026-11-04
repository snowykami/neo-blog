package tasks

import (
	"time"

	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// runPeriodically 启动后立即执行一次 fn，之后每隔 interval 执行一次。
// 多实例部署时每一轮只有一个实例认领执行；认领有效期略短于周期，各实例的时间差不会导致整轮都被跳过
func runPeriodically(task string, interval time.Duration, fn func()) {
	go func() {
		for {
			if sharedstate.ClaimRound(task, interval*9/10) {
				fn()
			}
			time.Sleep(interval)
		}
	}()
}
