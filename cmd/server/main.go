package main

import "github.com/snowykami/neo-blog/internal/router"

func main() {
	err := router.Run()
	if err != nil {
		panic(err)
	}
}
