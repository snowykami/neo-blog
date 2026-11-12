package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

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

// aiAgentDrainTimeout 退出时等待 AI 用户任务执行完的最长时间；与就绪检查摘流（默认 5 秒）、HTTP 优雅关停（5 秒）
// 合计不超过 Kubernetes 默认的 30 秒退出时间
const aiAgentDrainTimeout = 15 * time.Second

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
	err = repo.InitDatabase()
	if err != nil {
		panic(err)
	}

	// 数据库就绪后再注册跨实例广播监听，避免滚动发布或重连时回调在数据库未初始化前访问 repo
	repo.KV.ListenChanges()
	tasks.ListenStorageProviderChanges()
	service.ListenFileLinkChanges()
	// 公开的文章与页面变化后，各实例作废音乐白名单中文章引用的歌曲
	service.ListenMusicWhitelistChanges()
	// 搜索配置在后台更新后，各实例重置客户端并确保目标索引结构就绪
	service.ListenSearchConfigChanges()

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
	// 定期清理超过保留期的错误报告
	tasks.StartErrorReportCleanup()
	// 定期清理超过保留期的模型调用用量记录
	tasks.StartLLMUsageCleanup()
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
	// 接手其他实例中途退出时没做完的 AI 摘要与存储迁移
	tasks.StartJobRecovery()
	// 启动时预热歌单（网易云返回上千首、1～2MB，现拉十几秒；重启后进程内的歌单缓存会丢）
	tasks.StartMusicPlaylistWarm()
	// 定期清理超过保留期的旧版本歌词标注（手动编辑过的保留）
	tasks.StartLyricAnnotationCleanup()
	// 站内通知的跨实例广播：任一实例写入通知后唤醒各实例上的 SSE 连接
	service.StartNotificationHub()
	// 站内互动通知的邮件汇总投递（只有真人评论 / 回复触发发信，点赞等附带项搭车）
	tasks.StartNotificationEmailWorker()
	// 通知与互动事件按保留期清理，并处理长期没搭上车的附带行
	tasks.StartNotificationCleanup()
	// 公开搜索索引启动检查与定期轻量对账（未启用 Meilisearch 时为空操作）
	tasks.StartSearchSync()

	err = router.Run(ctx)
	// 已领取的 AI 用户任务尽量执行完，来不及的立即放回队列由其他实例接着执行
	tasks.DrainAIAgentWorkers(aiAgentDrainTimeout)
	if err != nil {
		panic(err)
	}
}
