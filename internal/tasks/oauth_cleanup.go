package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
)

const (
	oauthCleanupInterval      = 6 * time.Hour
	oauthExpiredRetention     = 7 * 24 * time.Hour
	oauthOrphanClientLifetime = 30 * 24 * time.Hour
)

// StartOAuthCleanup 后台定期清理早已过期的 OAuth 令牌及从未产生有效授权的孤儿动态注册客户端
func StartOAuthCleanup() {
	runPeriodically("oauth_cleanup", oauthCleanupInterval, func() {
		now := time.Now().UTC()
		deletedTokens, deletedClients, err := repo.OAuth.CleanupExpired(
			now.Add(-oauthExpiredRetention),
			now.Add(-oauthOrphanClientLifetime),
		)
		if err != nil {
			logrus.Errorf("oauth cleanup failed: %v", err)
			return
		}
		if deletedTokens > 0 || deletedClients > 0 {
			logrus.Infof("oauth cleanup: deleted %d expired tokens, %d orphan clients", deletedTokens, deletedClients)
		}
	})
}
