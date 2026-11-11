package sharedstate

import (
	"sync"
	"sync/atomic"
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
	// lost 发现已被他人占用（过期后被其他实例接手）时关闭；renewedAt 最近一次成功占用或续期的时间（UnixNano）
	lost      chan struct{}
	lostOnce  sync.Once
	renewedAt atomic.Int64
}

// AcquireLease 键不存在时以随机令牌占用并开始续期；已被占用时返回 nil
func AcquireLease(key string, ttl time.Duration) (*Lease, error) {
	token := randomToken()
	ok, err := Current().SetNX(key, token, ttl)
	if err != nil || !ok {
		return nil, err
	}
	l := &Lease{key: key, token: token, ttl: ttl, stop: make(chan struct{}), lost: make(chan struct{})}
	l.renewedAt.Store(time.Now().UnixNano())
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
				l.markLost()
				return
			}
			l.renewedAt.Store(time.Now().UnixNano())
		}
	}
}

func (l *Lease) markLost() {
	l.lostOnce.Do(func() { close(l.lost) })
}

// Lost 发现租约已丢失（过期后被其他实例接手）时关闭的通道，用于中止持有期间进行中的工作；释放（Release）不会关闭它
func (l *Lease) Lost() <-chan struct{} {
	return l.lost
}

// Held 是否仍持有：已释放、已丢失，或共享状态中的值已不是自己的令牌时返回 false。
// 读取共享状态出错时按最近一次成功续期是否还在 ttl 内判断（超过 ttl 时键可能已过期并被他人占用）。
// 长时间运行的任务在开始下一步、写入进度前调用，丢失后应停止，交给接手的实例
func (l *Lease) Held() bool {
	select {
	case <-l.stop:
		return false
	case <-l.lost:
		return false
	default:
	}
	value, ok, err := Current().Get(l.key)
	if err != nil {
		return time.Since(time.Unix(0, l.renewedAt.Load())) < l.ttl
	}
	if !ok || value != l.token {
		l.markLost()
		return false
	}
	return true
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
