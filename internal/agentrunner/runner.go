package agentrunner

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
)

// Run 主循环：按空闲的并发名额长轮询领取任务，交给 worker 执行；ctx 结束后等待执行中的任务完成
func Run(ctx context.Context, cfg Config) error {
	if cfg.RunnerToken == "" {
		return errors.New("AGENT_RUNNER_TOKEN is required")
	}
	b := newBackend(cfg)
	slots := make(chan struct{}, cfg.Concurrency)
	for i := 0; i < cfg.Concurrency; i++ {
		slots <- struct{}{}
	}
	var wg sync.WaitGroup
	defer wg.Wait()
	backoff := time.Second
	logrus.Infof("agent runner started: backend=%s concurrency=%d", cfg.BackendURL, cfg.Concurrency)
	for {
		// 至少有一个空闲名额才去领取
		select {
		case <-ctx.Done():
			return nil
		case <-slots:
		}
		free := 1
	drain:
		for free < cfg.Concurrency {
			select {
			case <-slots:
				free++
			default:
				break drain
			}
		}
		resp, err := b.lease(ctx, free)
		if err != nil {
			for i := 0; i < free; i++ {
				slots <- struct{}{}
			}
			if ctx.Err() != nil {
				return nil
			}
			logrus.Warnf("lease agent runs: %v (retry in %s)", err, backoff)
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, time.Minute)
			continue
		}
		backoff = time.Second
		for i := range resp.Runs {
			run := resp.Runs[i]
			free--
			wg.Add(1)
			go func(site dto.AgentLeaseSite, run dto.AgentLeaseRun) {
				defer func() {
					if r := recover(); r != nil {
						logrus.Errorf("agent run %d panic: %v", run.RunID, r)
					}
					slots <- struct{}{}
					wg.Done()
				}()
				// 任务自身不随主循环退出而中断，保证已领取的任务能回报结果
				processRun(context.Background(), b, site, &run)
			}(resp.Site, run)
		}
		for ; free > 0; free-- {
			slots <- struct{}{}
		}
	}
}
