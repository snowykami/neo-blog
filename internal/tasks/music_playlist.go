package tasks

import (
	"context"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
)

// 歌单曲目缓存的 TTL 是 10 分钟（见 service/music.go 的 musicPlaylistTTL），过期后先返回旧数据再后台刷新，
// 所以平时请求不会等上游；但进程内的歌单在重启后会丢，而网易云那边的歌单是一次上千首、1～2MB 的大响应，
// 现拉要十几二十秒（慢的线路更久），重启后第一位访客就得等这么久、甚至等不到（前端请求超时）。
// 这里启动时先取一次，之后定期确认（未过期时只读缓存，不会真的请求上游）
const musicPlaylistWarmInterval = 5 * time.Minute

// StartMusicPlaylistWarm 启动时立即预热歌单，之后定期确认缓存仍然可用
func StartMusicPlaylistWarm() {
	musicService := service.NewMusicService()
	runPeriodically("music_playlist_warm", musicPlaylistWarmInterval, func() {
		if _, err := musicService.GetPlaylist(context.Background()); err != nil {
			logrus.Warnf("warm music playlist failed: %v", err)
		}
	})
}
