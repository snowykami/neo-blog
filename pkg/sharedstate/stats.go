package sharedstate

import (
	"strings"
)

// 共享状态所在 Redis 的运行信息，供后台「系统运行」的依赖服务展示；未使用 Redis（进程内存）时不提供

// RedisServerInfo Redis 的 INFO 输出（各段的键值合并在一起）与连接位置（不含密码）
type RedisServerInfo struct {
	Addr   string
	DB     int
	Fields map[string]string
}

// ServerInfo 读取 Redis 的 INFO；未使用 Redis 时 ok 为 false
func ServerInfo() (info *RedisServerInfo, ok bool, err error) {
	s, isRedis := Current().(*redisStore)
	if !isRedis {
		return nil, false, nil
	}
	ctx, cancel := s.ctx()
	defer cancel()
	raw, err := s.client.Info(ctx, "server", "clients", "memory", "stats", "cpu", "keyspace").Result()
	if err != nil {
		return nil, true, err
	}
	opt := s.client.Options()
	return &RedisServerInfo{Addr: opt.Addr, DB: opt.DB, Fields: parseRedisInfo(raw)}, true, nil
}

// parseRedisInfo 解析 INFO 的「key:value」行，忽略段标题与空行
func parseRedisInfo(raw string) map[string]string {
	fields := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if key, value, found := strings.Cut(line, ":"); found {
			fields[key] = value
		}
	}
	return fields
}

// CountKeys 统计本应用在 Redis 中的键：按去掉键前缀后、第一个冒号之前的部分分组；最多扫描 limit 个键，
// 超过时 complete 为 false。未使用 Redis 时 ok 为 false
func CountKeys(limit int) (groups map[string]int, complete, ok bool, err error) {
	s, isRedis := Current().(*redisStore)
	if !isRedis {
		return nil, false, false, nil
	}
	ctx, cancel := s.ctx()
	defer cancel()
	groups = map[string]int{}
	scanned := 0
	iter := s.client.Scan(ctx, 0, globEscaper.Replace(s.prefix)+"*", 1000).Iterator()
	for iter.Next(ctx) {
		if scanned >= limit {
			return groups, false, true, nil
		}
		scanned++
		group, _, _ := strings.Cut(strings.TrimPrefix(iter.Val(), s.prefix), ":")
		groups[group]++
	}
	return groups, true, true, iter.Err()
}
