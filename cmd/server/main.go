package main

import (
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/router"
)

func main() {
	err := repo.InitDatabase()
	if err != nil {
		panic(err)
	}

	err = router.Run()
	if err != nil {
		panic(err)
	}
}
