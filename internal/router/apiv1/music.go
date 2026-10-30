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
		// 同一播放地址以 JSON 返回（允许跨源读取），供需要按字节范围只加载片段的页面使用（如沙箱中的歌词特效演示页）
		musicGroup.GET("/song/:id/audio/url", controller.Music.SongAudioURL)
		musicGroup.GET("/song/:id/lyric", controller.Music.SongLyric)
		// 歌词流（SSE）：一次推送各来源与后端选出的全站歌词版本；下面各来源的接口保留，供歌词流不可用时使用
		musicGroup.GET("/song/:id/lyric/stream", controller.Music.SongLyricStream)
		musicGroup.GET("/song/:id/lyric/ttml", controller.Music.SongTTMLLyric)
		musicGroup.GET("/song/:id/lyric/qq", controller.Music.SongQQLyric)
		musicGroup.GET("/song/:id/lyric/kugou", controller.Music.SongKugouLyric)
		musicGroup.GET("/song/:id/lyric/annotations", controller.Music.SongLyricAnnotations)
		musicGroup.GET("/song/:id/chorus", controller.Music.SongChorus)
		// 歌词缓存：全站歌词版本的快照，由后端选出版本后用自己获取的来源数据写入（歌词流会先推送它，这里供歌词流不可用时使用）
		musicGroup.GET("/song/:id/lyric/cache", controller.Music.SongLyricCache)
		// 歌词的人工设置（整体偏移）：所有人播放时都要用到，公开读取
		musicGroup.GET("/song/:id/lyric/settings", controller.Music.SongLyricSettings)

		// 搜索歌曲只在编辑器中使用，限编辑者及以上，避免被当作公开的搜索代理
		musicGroupWithEditor.GET("/search", controller.Music.Search)

		// 手动重新生成歌词标注会消耗模型额度，仅管理员可用
		musicGroupWithAdmin.POST("/song/:id/lyric/annotations/refresh", controller.Music.RefreshLyricAnnotations)
		// 后台歌词特效页：列表、编辑器数据与保存手动编辑的标注，仅管理员可用
		musicGroupWithAdmin.GET("/lyric/annotations", controller.Music.ListLyricAnnotations)
		musicGroupWithAdmin.GET("/song/:id/lyric/annotations/editor", controller.Music.LyricAnnotationEditor)
		musicGroupWithAdmin.PUT("/song/:id/lyric/annotations", controller.Music.SaveLyricAnnotations)
		// 歌词整体偏移对所有人生效，仅管理员可以调整
		musicGroupWithAdmin.PUT("/song/:id/lyric/offset", controller.Music.SaveLyricOffset)
		// 全站默认歌词来源：所有读者默认显示这一来源（并按它重新选出全站歌词版本、生成歌词特效），仅管理员可以设置
		musicGroupWithAdmin.PUT("/song/:id/lyric/pin", controller.Music.SaveLyricPin)
		// 请求体中含 Cookie，使用 POST 避免出现在地址中
		musicGroupWithAdmin.POST("/ncm/playlists", controller.Music.NCMPlaylists)
	}
}
