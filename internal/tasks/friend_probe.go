package tasks

import (
	"time"

	"github.com/snowykami/neo-blog/internal/service"
)

const friendProbeInterval = 6 * time.Hour

// StartFriendLinksProbe 定期拨测已公开友链的可达性与延迟，并按低频周期复核反链状态（多副本每轮仅一个实例执行）
func StartFriendLinksProbe() {
	runPeriodically("friend_links_probe", friendProbeInterval, func() {
		service.RunFriendLinksProbeRound(false)
	})
}
