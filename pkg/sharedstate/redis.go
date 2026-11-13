package sharedstate

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
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
	extendScript = redis.NewScript(`if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
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

	subMu       sync.Mutex
	subChannels map[string]bool
	closed      bool
	pubsub      *redis.PubSub
	cancel      context.CancelFunc
}

func newRedisStore(redisURL, prefix string) (*redisStore, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		// url.Error 会带上完整地址（含密码），只保留原因
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
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

func (s *redisStore) Extend(key, value string, ttl time.Duration) (bool, error) {
	if ttl <= 0 {
		return false, nil
	}
	ctx, cancel := s.ctx()
	defer cancel()
	n, err := extendScript.Run(ctx, s.client, []string{s.key(key)}, value, ttl.Milliseconds()).Int64()
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

// globEscaper 转义 SCAN MATCH 中的通配符
var globEscaper = strings.NewReplacer(`\`, `\\`, `*`, `\*`, `?`, `\?`, `[`, `\[`, `]`, `\]`)

func (s *redisStore) GetByPrefix(prefix string) (map[string]string, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	var keys []string
	iter := s.client.Scan(ctx, 0, globEscaper.Replace(s.key(prefix))+"*", 100).Iterator()
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	result := make(map[string]string, len(keys))
	if len(keys) == 0 {
		return result, nil
	}
	values, err := s.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	for i, value := range values {
		// 扫描与读取之间过期的键 MGet 返回 nil，跳过
		if str, ok := value.(string); ok {
			result[strings.TrimPrefix(keys[i], s.prefix)] = str
		}
	}
	return result, nil
}

func (s *redisStore) Publish(channel, message string) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return s.client.Publish(ctx, s.key(channel), message).Err()
}

// subscribe 订阅频道；同一频道多次注册回调时只向 Redis 发送一次 SUBSCRIBE，避免重复订阅确认被误判为断线重连。
// 连接中断后 go-redis 会自动重连并重新订阅，重新订阅成功时以空消息通知订阅者全量刷新（期间的广播可能已经错过）
func (s *redisStore) subscribe(channel string) {
	s.subMu.Lock()
	if s.closed {
		s.subMu.Unlock()
		return
	}
	if s.subChannels == nil {
		s.subChannels = make(map[string]bool)
	}
	if s.subChannels[channel] {
		s.subMu.Unlock()
		return
	}
	if s.pubsub == nil {
		ctx, cancel := context.WithCancel(context.Background())
		s.cancel = cancel
		s.pubsub = s.client.Subscribe(ctx)
		go s.receive(ctx, s.pubsub)
	}
	pubsub := s.pubsub
	s.subChannels[channel] = true
	s.subMu.Unlock()

	ctx, cancel := s.ctx()
	defer cancel()
	if err := pubsub.Subscribe(ctx, s.key(channel)); err != nil {
		s.subMu.Lock()
		delete(s.subChannels, channel)
		s.subMu.Unlock()
		logrus.Errorf("subscribe %s failed: %v", channel, err)
	}
}

func (s *redisStore) receive(ctx context.Context, pubsub *redis.PubSub) {
	subscribed := map[string]bool{}
	for {
		msg, err := pubsub.Receive(ctx)
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
			channel := strings.TrimPrefix(m.Channel, s.prefix)
			// 同一频道再次收到订阅确认说明是断线重连
			if subscribed[channel] {
				dispatch(channel, "")
			}
			subscribed[channel] = true
		case *redis.Message:
			dispatch(strings.TrimPrefix(m.Channel, s.prefix), m.Payload)
		}
	}
}

func (s *redisStore) Close() error {
	s.subMu.Lock()
	s.closed = true
	cancel := s.cancel
	pubsub := s.pubsub
	s.subMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if pubsub != nil {
		_ = pubsub.Close()
	}
	return s.client.Close()
}
