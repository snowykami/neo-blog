package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// registerMusicRoutes 悬浮音乐播放器：歌单、播放与歌词公开访问（播放仅限所选歌单）；读取网易云账号歌单仅管理员可用
// 单曲信息供文章内的单曲卡展示，只返回公开元信息、不使用 Cookie
func registerMusicRoutes(group *route.RouterGroup) {
	musicGroup := group.Group("/music").Use(middleware.UseAuth(false))
	musicGroupWithAdmin := group.Group("/music").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleAdmin))
	{
		musicGroup.GET("/playlist", controller.Music.Playlist)
		musicGroup.GET("/song/:id", controller.Music.Song)
		musicGroup.GET("/song/:id/audio", controller.Music.SongAudio)
		musicGroup.GET("/song/:id/lyric", controller.Music.SongLyric)

		// 请求体中含 Cookie，使用 POST 避免出现在地址中
		musicGroupWithAdmin.POST("/ncm/playlists", controller.Music.NCMPlaylists)
	}
}
