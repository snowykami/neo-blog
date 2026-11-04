package sharedstate

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

const (
	redisOpTimeout     = 3 * time.Second
	redisDialTimeout   = 5 * time.Second
	defaultRedisPrefix = "neo-blog:"
)

// 用脚本保证原子性，兼容 Redis 6.2 以前没有 GETDEL 的版本
var (
	takeScript = redis.NewScript(`local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`)
	compareAndDeleteScript = redis.NewScript(`if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`)
	incrScript = redis.NewScript(`local v = redis.call('INCR', KEYS[1])
if v == 1 and tonumber(ARGV[1]) > 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return v`)
)

// redisStore Redis 实现，所有键与频道都加上前缀，便于与其他应用共用一个 Redis
type redisStore struct {
	client *redis.Client
	prefix string

	pubsubOnce sync.Once
	pubsub     *redis.PubSub
	cancel     context.CancelFunc
}

func newRedisStore(redisURL, prefix string) (*redisStore, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid REDIS_URL: %w", err)
	}
	opt.DialTimeout = redisDialTimeout
	client := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), redisDialTimeout)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("connect redis: %w", err)
	}
	if prefix == "" {
		prefix = defaultRedisPrefix
	}
	s := &redisStore{client: client, prefix: prefix}
	for _, channel := range subscribedChannels() {
		s.subscribe(channel)
	}
	return s, nil
}

func (s *redisStore) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), redisOpTimeout)
}

func (s *redisStore) key(key string) string {
	return s.prefix + key
}

func (s *redisStore) Get(key string) (string, bool, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	value, err := s.client.Get(ctx, s.key(key)).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	return value, err == nil, err
}

func (s *redisStore) GetMany(keys ...string) (map[string]string, error) {
	result := make(map[string]string, len(keys))
	if len(keys) == 0 {
		return result, nil
	}
	full := make([]string, len(keys))
	for i, key := range keys {
		full[i] = s.key(key)
	}
	ctx, cancel := s.ctx()
	defer cancel()
	values, err := s.client.MGet(ctx, full...).Result()
	if err != nil {
		return nil, err
	}
	for i, value := range values {
		if str, ok := value.(string); ok {
			result[keys[i]] = str
		}
	}
	return result, nil
}

func (s *redisStore) Set(key, value string, ttl time.Duration) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return s.client.Set(ctx, s.key(key), value, max(ttl, 0)).Err()
}

func (s *redisStore) SetNX(key, value string, ttl time.Duration) (bool, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return s.client.SetNX(ctx, s.key(key), value, max(ttl, 0)).Result()
}

func (s *redisStore) Take(key string) (string, bool, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	value, err := takeScript.Run(ctx, s.client, []string{s.key(key)}).Text()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	return value, err == nil, err
}

func (s *redisStore) CompareAndDelete(key, value string) (bool, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	n, err := compareAndDeleteScript.Run(ctx, s.client, []string{s.key(key)}, value).Int64()
	return n > 0, err
}

func (s *redisStore) Delete(keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	full := make([]string, len(keys))
	for i, key := range keys {
		full[i] = s.key(key)
	}
	ctx, cancel := s.ctx()
	defer cancel()
	return s.client.Del(ctx, full...).Err()
}

func (s *redisStore) Incr(key string, ttl time.Duration) (int64, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return incrScript.Run(ctx, s.client, []string{s.key(key)}, max(ttl, 0).Milliseconds()).Int64()
}

func (s *redisStore) Publish(channel, message string) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return s.client.Publish(ctx, s.key(channel), message).Err()
}

// subscribe 订阅频道；首次调用时启动接收循环。连接中断后 go-redis 会自动重连并重新订阅，
// 重新订阅成功时以空消息通知订阅者全量刷新（期间的广播可能已经错过）
func (s *redisStore) subscribe(channel string) {
	s.pubsubOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		s.cancel = cancel
		s.pubsub = s.client.Subscribe(ctx)
		go s.receive(ctx)
	})
	ctx, cancel := s.ctx()
	defer cancel()
	if err := s.pubsub.Subscribe(ctx, s.key(channel)); err != nil {
		logrus.Errorf("subscribe %s failed: %v", channel, err)
	}
}

func (s *redisStore) receive(ctx context.Context) {
	subscribed := map[string]bool{}
	for {
		msg, err := s.pubsub.Receive(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logrus.Warnf("redis pubsub receive failed, retrying: %v", err)
			time.Sleep(time.Second)
			continue
		}
		switch m := msg.(type) {
		case *redis.Subscription:
			if m.Kind != "subscribe" {
				continue
			}
			channel := m.Channel[len(s.prefix):]
			// 同一频道再次收到订阅确认说明是断线重连
			if subscribed[channel] {
				dispatch(channel, "")
			}
			subscribed[channel] = true
		case *redis.Message:
			dispatch(m.Channel[len(s.prefix):], m.Payload)
		}
	}
}

func (s *redisStore) Close() error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.pubsub != nil {
		_ = s.pubsub.Close()
	}
	return s.client.Close()
}
