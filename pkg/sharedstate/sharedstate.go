// Package sharedstate 跨实例共享的临时状态：一次性凭据（OIDC state、邮箱验证码）、限流计数、后台任务状态、分布式锁与跨实例通知。
//
// 未配置 REDIS_URL 时使用进程内存，只适用于单实例部署；多副本部署必须配置 Redis，否则各实例的状态互不可见。
// 新增「跨请求保存、且其他实例也要看到」的状态时一律走这里，不要再用进程内的 map
package sharedstate

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// Store 键值均为字符串；ttl <= 0 表示不过期
type Store interface {
	Get(key string) (string, bool, error)
	// GetMany 批量读取，返回存在的键
	GetMany(keys ...string) (map[string]string, error)
	Set(key, value string, ttl time.Duration) error
	// SetNX 键不存在时写入，返回是否写入
	SetNX(key, value string, ttl time.Duration) (bool, error)
	// Take 读取并删除（原子），用于只能使用一次的凭据
	Take(key string) (string, bool, error)
	// CompareAndDelete 值等于 value 时删除（原子），用于释放自己持有的锁
	CompareAndDelete(key, value string) (bool, error)
	// Extend 值等于 value 时把过期时间重设为 ttl（原子），用于续期自己持有的锁；已过期或被他人占用时返回 false
	Extend(key, value string, ttl time.Duration) (bool, error)
	Delete(keys ...string) error
	// Incr 计数加一并返回当前值；键不存在时从 1 开始并按 ttl 计时（固定窗口，期间再自增不延长）
	Incr(key string, ttl time.Duration) (int64, error)
	// GetByPrefix 读取以 prefix 开头的全部未过期键值（如各实例上报的快照）；键数量应保持很少
	GetByPrefix(prefix string) (map[string]string, error)
	// Publish 向其他实例广播消息
	Publish(channel, message string) error
	Close() error
}

var (
	mu      sync.RWMutex
	current Store = newMemoryStore()
	shared  bool  // 当前是否为 Redis（多实例可见）

	// instanceID 本实例标识：广播时带上，收到自己发出的消息时忽略
	instanceID = randomToken()

	handlersMu sync.RWMutex
	handlers   = map[string][]func(message string){}
)

// Init 按 Redis 地址选择存储：为空时使用进程内存（单实例），否则连接 Redis 并在连接失败时返回错误
func Init(redisURL, keyPrefix string) error {
	if strings.TrimSpace(redisURL) == "" {
		UseMemory()
		logrus.Info("shared state: in-memory (single instance only; set REDIS_URL for multi-replica deployments)")
		return nil
	}
	store, err := newRedisStore(redisURL, keyPrefix)
	if err != nil {
		return err
	}
	replace(store, true)
	logrus.Info("shared state: redis")
	return nil
}

// UseMemory 切换为新的进程内存存储（单实例部署，或测试中清空状态）
func UseMemory() {
	replace(newMemoryStore(), false)
}

// UseStore 换成指定的存储，按多实例共享处理；只用于测试（如注入模拟 Redis 故障的存储），业务代码请用 Init / UseMemory
func UseStore(store Store) {
	replace(store, true)
}

func replace(store Store, isShared bool) {
	mu.Lock()
	old := current
	current, shared = store, isShared
	mu.Unlock()
	if old != nil && old != store {
		_ = old.Close()
	}
}

// InstanceID 本实例的随机标识，进程启动时生成
func InstanceID() string {
	return instanceID
}

// Current 当前使用的存储
func Current() Store {
	mu.RLock()
	defer mu.RUnlock()
	return current
}

// Shared 状态是否在多个实例间共享（已配置 Redis）
func Shared() bool {
	mu.RLock()
	defer mu.RUnlock()
	return shared
}

// GetJSON 读取 JSON 值到 dst，返回是否存在
func GetJSON(key string, dst any) (bool, error) {
	value, ok, err := Current().Get(key)
	if err != nil || !ok {
		return false, err
	}
	return true, json.Unmarshal([]byte(value), dst)
}

// SetJSON 以 JSON 写入
func SetJSON(key string, value any, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return Current().Set(key, string(data), ttl)
}

// TakeJSON 读取并删除 JSON 值（原子），返回是否存在
func TakeJSON(key string, dst any) (bool, error) {
	value, ok, err := Current().Take(key)
	if err != nil || !ok {
		return false, err
	}
	return true, json.Unmarshal([]byte(value), dst)
}

// TryLock 尝试获取锁，获取成功时返回释放函数；ttl 为持有上限，进程崩溃时锁会自动过期
func TryLock(key string, ttl time.Duration) (release func(), ok bool, err error) {
	token := randomToken()
	ok, err = Current().SetNX("lock:"+key, token, ttl)
	if err != nil || !ok {
		return func() {}, ok, err
	}
	return func() {
		if _, err := Current().CompareAndDelete("lock:"+key, token); err != nil {
			logrus.Warnf("release lock %s failed: %v", key, err)
		}
	}, true, nil
}

// lockRetryInterval 等待锁时的重试间隔
const lockRetryInterval = 50 * time.Millisecond

// Lock 获取锁，被占用时等待直到获取或 ctx 结束
func Lock(ctx context.Context, key string, ttl time.Duration) (func(), error) {
	for {
		release, ok, err := TryLock(key, ttl)
		if err != nil {
			return release, err
		}
		if ok {
			return release, nil
		}
		select {
		case <-ctx.Done():
			return func() {}, ctx.Err()
		case <-time.After(lockRetryInterval):
		}
	}
}

// ClaimRound 定时任务认领本轮执行：同一任务在 ttl 内只有一个实例认领成功，其余实例跳过本轮。
// 出错时返回 false（跳过本轮，下一轮再试）
func ClaimRound(task string, ttl time.Duration) bool {
	ok, err := Current().SetNX("task_round:"+task, instanceID, ttl)
	if err != nil {
		logrus.Warnf("claim task round %s failed: %v", task, err)
		return false
	}
	return ok
}

// Notify 通知其他实例（如配置缓存失效）；本实例需自行同步处理，不会收到自己的消息。单实例时为空操作
func Notify(channel, message string) {
	if err := Current().Publish(channel, instanceID+"|"+message); err != nil {
		logrus.Warnf("notify %s failed: %v", channel, err)
	}
}

// OnNotify 订阅其他实例的通知。与 Redis 的连接中断并恢复后会以空消息调用 handler，表示期间可能错过了通知，应全量刷新
func OnNotify(channel string, handler func(message string)) {
	handlersMu.Lock()
	handlers[channel] = append(handlers[channel], handler)
	handlersMu.Unlock()
	if s, ok := Current().(*redisStore); ok {
		s.subscribe(channel)
	}
}

// dispatch 把收到的广播交给订阅者，忽略本实例发出的消息
func dispatch(channel, payload string) {
	origin, message, found := strings.Cut(payload, "|")
	if found && origin == instanceID {
		return
	}
	if !found {
		message = payload
	}
	handlersMu.RLock()
	list := append([]func(string){}, handlers[channel]...)
	handlersMu.RUnlock()
	for _, handler := range list {
		callHandler(channel, handler, message)
	}
}

// callHandler 调用一个订阅回调：回调 panic 时只打日志，不能让订阅协程（Redis 订阅循环）连同整个进程退出
func callHandler(channel string, handler func(string), message string) {
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("sharedstate: handler of channel %q panicked: %v\n%s", channel, r, debug.Stack())
		}
	}()
	handler(message)
}

// subscribedChannels 已注册订阅的频道，Redis 存储初始化时据此订阅
func subscribedChannels() []string {
	handlersMu.RLock()
	defer handlersMu.RUnlock()
	channels := make([]string, 0, len(handlers))
	for channel := range handlers {
		channels = append(channels, channel)
	}
	return channels
}

func randomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(errors.New("sharedstate: crypto/rand unavailable"))
	}
	return hex.EncodeToString(b)
}
