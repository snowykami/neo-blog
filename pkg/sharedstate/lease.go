package sharedstate

import (
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// Lease 持有一个带过期时间的键（任务令牌、并发名额等）：持有期间后台按 ttl/3 续期，
// 进程退出或崩溃后最多 ttl 自动释放，其他实例即可接手；只会续期、释放自己持有的值
type Lease struct {
	key   string
	token string
	ttl   time.Duration
	stop  chan struct{}
	once  sync.Once
}

// AcquireLease 键不存在时以随机令牌占用并开始续期；已被占用时返回 nil
func AcquireLease(key string, ttl time.Duration) (*Lease, error) {
	token := randomToken()
	ok, err := Current().SetNX(key, token, ttl)
	if err != nil || !ok {
		return nil, err
	}
	l := &Lease{key: key, token: token, ttl: ttl, stop: make(chan struct{})}
	go l.keepAlive()
	return l, nil
}

func (l *Lease) keepAlive() {
	ticker := time.NewTicker(l.ttl / 3)
	defer ticker.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-ticker.C:
			ok, err := Current().Extend(l.key, l.token, l.ttl)
			if err != nil {
				logrus.Warnf("renew lease %s failed: %v", l.key, err)
				continue
			}
			if !ok {
				// 已过期并被其他实例接手（例如长时间无法连接 Redis），不再续期
				logrus.Warnf("lease %s lost", l.key)
				return
			}
		}
	}
}

// Release 停止续期并释放；可重复调用
func (l *Lease) Release() {
	l.once.Do(func() {
		close(l.stop)
		if _, err := Current().CompareAndDelete(l.key, l.token); err != nil {
			logrus.Warnf("release lease %s failed: %v", l.key, err)
		}
	})
}
