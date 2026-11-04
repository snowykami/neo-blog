// neo-blog AI 用户的 Runner：与后端分开部署，详见 docs/ai-agents.md
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/agentrunner"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := agentrunner.Run(ctx, agentrunner.LoadConfig()); err != nil {
		logrus.Fatal(err)
	}
}
