package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
)

// 热度随时间衰减，需定期重算；点赞、评论后最迟在一个周期内反映到排序
const postHeatRefreshInterval = 10 * time.Minute

// StartPostHeatRefresh 启动时立即重算一次文章热度，之后定期重算
func StartPostHeatRefresh() {
	go func() {
		heatService := service.NewPostHeatService()
		for {
			if updated, err := heatService.Refresh(time.Now()); err != nil {
				logrus.Errorf("refresh post heat failed: %v", err)
			} else if updated > 0 {
				logrus.Debugf("refreshed heat of %d posts", updated)
			}
			time.Sleep(postHeatRefreshInterval)
		}
	}()
}
