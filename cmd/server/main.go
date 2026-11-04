package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/router"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/tasks"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func main() {
	// 共享状态：未配置 Redis 时为进程内存（单实例）；配置了但连不上时直接退出，避免多副本各自为政
	err := sharedstate.Init(utils.Env.Get(constant.EnvKeyRedisURL), utils.Env.Get(constant.EnvKeyRedisKeyPrefix))
	if err != nil {
		panic(err)
	}
	dbConfig, err := repo.LoadDBConfig()
	if err != nil {
		panic(err)
	}
	if sharedstate.Shared() && dbConfig.Driver == "sqlite" {
		logrus.Warn("已配置 Redis 但数据库为 SQLite：SQLite 只支持单实例，多副本部署请改用 Postgres")
	}
	if sharedstate.Shared() && utils.Env.Get(constant.EnvKeyJwtSecrete) == "" {
		logrus.Warnf("已配置 Redis 但未设置 %s：未设置时每个实例随机生成密钥，登录令牌无法在实例间通用，多副本部署须为所有实例设置相同的值", constant.EnvKeyJwtSecrete)
	}
	// 其他实例修改配置、存储提供者后同步清除本实例的缓存
	repo.KV.ListenChanges()
	tasks.ListenStorageProviderChanges()
	service.ListenFileLinkChanges()

	err = repo.InitDatabase()
	if err != nil {
		panic(err)
	}

	err = tasks.InitStorageProvider()
	if err != nil {
		panic(err)
	}

	// 初始化文件缓存
	cache.InitFileCache()

	// 令牌有效期读取后台配置（环境变量优先）
	utils.Jwt.Durations = tools.GetAuthDurations

	// 初始化完成后由此统一接收退出信号：通知 worker 停止领取新任务，并让 HTTP 服务优雅关停后退出
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// 定期清理超过保留期的访问记录
	tasks.StartVisitLogCleanup()
	// 定期重算文章热度（随时间衰减）
	tasks.StartPostHeatRefresh()
	// 定期清理过期会话
	tasks.StartSessionCleanup()
	// 定期清理超出保留上限的文章 / 页面历史版本
	tasks.StartRevisionPrune()
	// AI 用户：时间引擎唤醒、记忆整理与过期清理，并启动本实例执行任务的 worker
	tasks.StartAIAgentScheduler(ctx)
	// 每个实例定时上报运行时指标，控制台可按实例查看
	tasks.StartRuntimeMetricsReporter()

	err = router.Run(ctx)
	if err != nil {
		panic(err)
	}
}
