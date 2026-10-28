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
	musicGroupWithEditor := group.Group("/music").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleEditor))
	{
		musicGroup.GET("/playlist", controller.Music.Playlist)
		musicGroup.GET("/song/:id", controller.Music.Song)
		musicGroup.GET("/song/:id/audio", controller.Music.SongAudio)
		musicGroup.GET("/song/:id/lyric", controller.Music.SongLyric)
		musicGroup.GET("/song/:id/lyric/ttml", controller.Music.SongTTMLLyric)
		musicGroup.GET("/song/:id/lyric/qq", controller.Music.SongQQLyric)
		musicGroup.GET("/song/:id/lyric/kugou", controller.Music.SongKugouLyric)
		musicGroup.GET("/song/:id/lyric/annotations", controller.Music.SongLyricAnnotations)
		musicGroup.GET("/song/:id/chorus", controller.Music.SongChorus)
		// 歌词缓存：前端只上报最佳来源的类型，内容由后端用自己获取的来源数据写入
		musicGroup.GET("/song/:id/lyric/cache", controller.Music.SongLyricCache)
		musicGroup.POST("/song/:id/lyric/cache", controller.Music.SaveLyricCache)

		// 搜索歌曲只在编辑器中使用，限编辑者及以上，避免被当作公开的搜索代理
		musicGroupWithEditor.GET("/search", controller.Music.Search)

		// 手动重新生成歌词标注会消耗模型额度，仅管理员可用
		musicGroupWithAdmin.POST("/song/:id/lyric/annotations/refresh", controller.Music.RefreshLyricAnnotations)
		// 请求体中含 Cookie，使用 POST 避免出现在地址中
		musicGroupWithAdmin.POST("/ncm/playlists", controller.Music.NCMPlaylists)
	}
}
