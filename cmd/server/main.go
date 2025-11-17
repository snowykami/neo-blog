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

	err = router.Run()
	if err != nil {
		panic(err)
	}
}
