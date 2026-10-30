package v1

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
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

// streamLyrics 歌词流的事件来源（测试时替换，只验证 SSE 的写出）
var streamLyrics = (*service.MusicService).StreamLyrics

// Playlist 博客歌单的曲目
func (m *musicType) Playlist(ctx context.Context, c *app.RequestContext) {
	tracks, svcerr := m.service.GetPlaylist(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, tracks)
}

// Song 单曲公开信息（文章内的单曲卡）
func (m *musicType) Song(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Int64
	song, svcerr := m.service.GetSong(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	// 单曲信息按歌曲缓存，能否播放随访客而定，返回前再填写
	result := *song
	result.Playable = m.service.SongPlayable(ctx, id)
	resps.Ok(c, resps.Success, result)
}

// Search 搜索网易云歌曲（编辑器中为单曲卡选择歌曲）
func (m *musicType) Search(ctx context.Context, c *app.RequestContext) {
	songs, svcerr := m.service.SearchSongs(ctx, c.Query("keywords"))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, songs)
}

// SongAudio 跳转到歌曲的临时播放地址
func (m *musicType) SongAudio(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicSongAudioReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	songURL, svcerr := m.service.GetSongURL(ctx, ctxutils.GetIDParam(c).Int64, req.Level)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	// 播放地址会过期，不让浏览器缓存跳转
	c.Response.Header.Set("Cache-Control", "no-store")
	c.Redirect(http.StatusFound, []byte(songURL))
}

// SongAudioURL 以 JSON 返回歌曲的临时播放地址（与 SongAudio 的跳转目标相同、同样只对白名单内的歌曲开放）：
// 页面可以直接向 CDN 按字节范围只加载需要的片段。地址本身公开可得，允许任意来源（包括沙箱中的不透明源）读取，不携带凭据
func (m *musicType) SongAudioURL(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicSongAudioReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	c.Response.Header.Set("Access-Control-Allow-Origin", "*")
	c.Response.Header.Set("Cache-Control", "no-store")
	songURL, svcerr := m.service.GetSongURL(ctx, ctxutils.GetIDParam(c).Int64, req.Level)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, dto.MusicSongAudioURLDto{URL: songURL})
}

// SongLyric 歌曲歌词
func (m *musicType) SongLyric(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicLyricReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	id := ctxutils.GetIDParam(c).Int64
	if req.Refresh {
		ctx = service.WithLyricRefresh(ctx, "ncm", id)
	}
	lyric, svcerr := m.service.GetLyric(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, lyric)
}

// SongLyricStream 歌词流（SSE）：歌词缓存快照、各来源（到达即推送）与后端选出的全站歌词版本，最后推送 done。
// 参数无效时返回普通 JSON 错误；推送期间客户端断开不影响后台完成选择。各来源的接口保留，供歌词流不可用时使用
func (m *musicType) SongLyricStream(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicLyricReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	id := ctxutils.GetIDParam(c).Int64
	if id <= 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	c.SetStatusCode(http.StatusOK)
	c.Response.Header.Set("Content-Type", "text/event-stream; charset=utf-8")
	// no-transform：反向代理与 CDN（以及 Next.js 的压缩）不压缩、不改写，事件逐条到达
	c.Response.Header.Set("Cache-Control", "no-cache, no-transform")
	// 关闭反向代理（Nginx / OpenResty 等）的响应缓冲
	c.Response.Header.Set("X-Accel-Buffering", "no")
	c.Response.HijackWriter(resp.NewChunkedBodyWriter(&c.Response, c.GetWriter()))
	streamLyrics(m.service, ctx, id, req.Refresh, func(event string, data any) error {
		payload, _ := json.Marshal(data)
		if _, err := c.Write([]byte("event: " + event + "\ndata: " + string(payload) + "\n\n")); err != nil {
			return err
		}
		return c.Flush()
	})
}

// SongTTMLLyric 歌曲的 TTML 歌词（自定义源 / AMLL TTML DB），没有时返回 404
func (m *musicType) SongTTMLLyric(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicTTMLReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	id := ctxutils.GetIDParam(c).Int64
	if req.Refresh {
		ctx = service.WithLyricRefresh(ctx, "ttml", id)
	}
	lyric, svcerr := m.service.GetTTMLLyric(ctx, id, req.Source)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, lyric)
}

// SongQQLyric 在 QQ 音乐匹配同一首歌并返回它的歌词（逐字 QRC、翻译、音译，以及按 QQ 歌曲收录的 TTML），没有时返回 404
func (m *musicType) SongQQLyric(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicLyricReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	id := ctxutils.GetIDParam(c).Int64
	if req.Refresh {
		ctx = service.WithLyricRefresh(ctx, "qq", id)
	}
	lyric, svcerr := m.service.GetQQLyric(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, lyric)
}

// SongKugouLyric 在酷狗音乐匹配同一首歌并返回歌词（已转换为与 QQ 音乐相同的格式），没有时返回 404
func (m *musicType) SongKugouLyric(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicLyricReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	id := ctxutils.GetIDParam(c).Int64
	if req.Refresh {
		ctx = service.WithLyricRefresh(ctx, "kugou", id)
	}
	lyric, svcerr := m.service.GetKugouLyric(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, lyric)
}

// SongLyricAnnotations 歌词标注（强调的词句、特效类型、情绪基调）：只为博客歌单内的歌曲生成，生成中返回 status=pending
func (m *musicType) SongLyricAnnotations(ctx context.Context, c *app.RequestContext) {
	result, svcerr := m.service.GetLyricAnnotations(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// RefreshLyricAnnotations 管理员手动重新生成一首歌的歌词标注，返回 status=pending，之后通过 SongLyricAnnotations 取结果
func (m *musicType) RefreshLyricAnnotations(ctx context.Context, c *app.RequestContext) {
	result, svcerr := m.service.RefreshLyricAnnotations(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// ListLyricAnnotations 后台歌词特效列表：已有标注的歌曲与生成 / 编辑时间（仅管理员）
func (m *musicType) ListLyricAnnotations(ctx context.Context, c *app.RequestContext) {
	result, svcerr := m.service.ListLyricAnnotations(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// LyricAnnotationEditor 后台编辑一首歌的歌词标注所需的数据：完整歌词与当前标注（仅管理员）
func (m *musicType) LyricAnnotationEditor(ctx context.Context, c *app.RequestContext) {
	result, svcerr := m.service.GetLyricAnnotationEditor(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// SaveLyricAnnotations 保存管理员手动编辑的歌词标注（仅管理员），返回保存后的编辑器数据
func (m *musicType) SaveLyricAnnotations(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicLyricAnnotationsEditReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	result, svcerr := m.service.SaveLyricAnnotations(ctx, ctxutils.GetIDParam(c).Int64, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// SongLyricSettings 一首歌的歌词人工设置（各来源的整体偏移），所有人播放时使用
func (m *musicType) SongLyricSettings(ctx context.Context, c *app.RequestContext) {
	result, svcerr := m.service.GetLyricSettings(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// SaveLyricPin 设置一首歌的全站默认歌词来源（仅管理员），kind 为空时取消；返回重新选出的全站歌词版本
func (m *musicType) SaveLyricPin(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicLyricPinReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	version, svcerr := m.service.SaveLyricPin(ctx, ctxutils.GetIDParam(c).Int64, req.Kind)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, version)
}

// SaveLyricOffset 保存一首歌某一歌词来源的整体偏移（仅管理员）
func (m *musicType) SaveLyricOffset(ctx context.Context, c *app.RequestContext) {
	var req dto.MusicLyricOffsetReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := m.service.SaveLyricOffset(ctx, ctxutils.GetIDParam(c).Int64, req.Source, req.OffsetMs); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// SongChorus 网易云标出的副歌 / 高潮片段（进度条标记）
func (m *musicType) SongChorus(ctx context.Context, c *app.RequestContext) {
	result, svcerr := m.service.GetSongChorus(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// SongLyricCache 一首歌的歌词缓存快照（最近一次选出的最佳歌词来源），供打开时立即显示
func (m *musicType) SongLyricCache(ctx context.Context, c *app.RequestContext) {
	result, svcerr := m.service.GetLyricCache(ctx, ctxutils.GetIDParam(c).Int64)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
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
