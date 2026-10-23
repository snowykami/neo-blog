package dto

// MusicTrackDto 悬浮音乐播放器的曲目，与静态歌单 JSON 的结构一致
type MusicTrackDto struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	AlbumPic string   `json:"album_pic"`
	Audio    string   `json:"audio"` // 站内音频地址，请求时 302 跳转到网易云的临时播放地址
	Lyric    string   `json:"lyric"`
	Link     string   `json:"link"`
	Aliases  []string `json:"aliases"`
}

// MusicLyricPart 一种歌词（原文 / 翻译 / 罗马音 / 逐字），与网易云接口的结构一致
type MusicLyricPart struct {
	Lyric   string `json:"lyric"`
	Version int    `json:"version"`
}

// MusicLyricDto 歌曲歌词
type MusicLyricDto struct {
	Lrc      *MusicLyricPart `json:"lrc"`
	Tlyric   *MusicLyricPart `json:"tlyric"`
	Romalrc  *MusicLyricPart `json:"romalrc"`
	Yrc      *MusicLyricPart `json:"yrc"`
	Ytlrc    *MusicLyricPart `json:"ytlrc"`
	Yromalrc *MusicLyricPart `json:"yromalrc"`
}

// NCMPlaylistsReq 获取网易云用户歌单；字段为空时使用已保存的配置，便于保存前先测试
type NCMPlaylistsReq struct {
	APIBaseURL string `json:"api_base_url"`
	Cookie     string `json:"cookie"`
}

// NCMAccountDto Cookie 对应的网易云账号
type NCMAccountDto struct {
	UserID   int64  `json:"user_id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

// NCMPlaylistDto 网易云歌单
type NCMPlaylistDto struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Cover      string `json:"cover"`
	TrackCount int    `json:"track_count"`
	Subscribed bool   `json:"subscribed"` // 收藏的歌单（非自己创建）
}

// NCMPlaylistsDto 网易云账号与其歌单列表
type NCMPlaylistsDto struct {
	Account   NCMAccountDto    `json:"account"`
	Playlists []NCMPlaylistDto `json:"playlists"`
}
