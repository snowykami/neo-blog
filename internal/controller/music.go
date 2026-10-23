package v1

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type musicType struct {
	service *service.MusicService
}

// Music 悬浮音乐播放器的网易云歌单
var Music = &musicType{service: service.NewMusicService()}

// Playlist 博客歌单的曲目
func (m *musicType) Playlist(ctx context.Context, c *app.RequestContext) {
	tracks, svcerr := m.service.GetPlaylist(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, tracks)
}

// SongAudio 跳转到歌曲的临时播放地址
func (m *musicType) SongAudio(ctx context.Context, c *app.RequestContext) {
	songURL, svcerr := m.service.GetSongURL(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	// 播放地址会过期，不让浏览器缓存跳转
	c.Response.Header.Set("Cache-Control", "no-store")
	c.Redirect(http.StatusFound, []byte(songURL))
}

// SongLyric 歌曲歌词
func (m *musicType) SongLyric(ctx context.Context, c *app.RequestContext) {
	lyric, svcerr := m.service.GetLyric(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, lyric)
}

// NCMPlaylists 获取网易云账号的歌单，供后台选择博客歌单
func (m *musicType) NCMPlaylists(ctx context.Context, c *app.RequestContext) {
	var req dto.NCMPlaylistsReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	result, svcerr := m.service.ListNCMPlaylists(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}
