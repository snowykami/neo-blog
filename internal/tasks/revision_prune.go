package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
)

const revisionPruneInterval = 6 * time.Hour

// StartRevisionPrune 启动时清理一次超出保留上限的历史版本，之后定期清理
// 新版本写入时会即时清理所在的文章 / 页面，这里兜底处理存量数据与调低上限后未再编辑的内容
func StartRevisionPrune() {
	go func() {
		revisionService := service.NewRevisionService()
		for {
			if deleted, err := revisionService.PruneAll(); err != nil {
				logrus.Errorf("revision prune failed: %v", err)
			} else if deleted > 0 {
				logrus.Infof("revision prune: deleted %d revisions beyond the limit", deleted)
			}
			time.Sleep(revisionPruneInterval)
		}
	}()
}
