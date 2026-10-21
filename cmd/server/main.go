package main

import (
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/router"
	"github.com/snowykami/neo-blog/internal/tasks"
	"github.com/snowykami/neo-blog/pkg/cache"
)

func main() {
	err := repo.InitDatabase()
	if err != nil {
		panic(err)
	}

	err = tasks.InitStorageProvider()
	if err != nil {
		panic(err)
	}

	// 初始化文件缓存
	cache.InitFileCache()

	// 定期清理超过保留期的访问记录
	tasks.StartVisitLogCleanup()
	// 定期清理过期会话
	tasks.StartSessionCleanup()

	err = router.Run()
	if err != nil {
		panic(err)
	}
}
