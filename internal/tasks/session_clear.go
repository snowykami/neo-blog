package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const sessionCleanupInterval = 6 * time.Hour

// StartSessionCleanup 后台定期清理过期会话：
// 会话每次刷新令牌时都会更新活跃时间，超过最长 refresh token 有效期仍未活跃的会话不可能再被使用
func StartSessionCleanup() {
	go func() {
		for {
			deleted, err := repo.Session.DeleteSessionsInactiveBefore(time.Now().Add(-utils.Jwt.RefreshTokenDurationWithRememberMe))
			if err != nil {
				logrus.Errorf("session cleanup failed: %v", err)
			} else if deleted > 0 {
				logrus.Infof("session cleanup: deleted %d expired sessions", deleted)
			}
			time.Sleep(sessionCleanupInterval)
		}
	}()
}
