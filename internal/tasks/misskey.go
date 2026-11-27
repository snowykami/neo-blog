package tasks

import (
	"time"

	"github.com/snowykami/neo-blog/internal/service"
)

// misskeyTickInterval 每分钟检查一次是否到达后台配置的 misskey_fetch_interval_minutes（1~60 分钟可调）
const misskeyTickInterval = time.Minute

// StartMisskeyFeedRefresh 启动侧边栏 Misskey 公开动态后台刷新任务（多副本每轮仅一个实例执行）
func StartMisskeyFeedRefresh() {
	runPeriodically("misskey_feed_refresh", misskeyTickInterval, func() {
		service.RefreshMisskeyFeedIfDue()
	})
}
