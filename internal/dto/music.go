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
	Duration int64    `json:"duration,omitempty"` // 时长（毫秒）；静态歌单可不提供
}

// MusicSongDto 单曲信息（文章内的网易云单曲卡）；只含公开的元信息，不含播放地址
type MusicSongDto struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	AlbumPic string   `json:"album_pic"`
	Link     string   `json:"link"`
	Duration int64    `json:"duration,omitempty"` // 时长（毫秒），用于在其他平台匹配同一首歌
}

// MusicSearchSongDto 歌曲搜索结果（编辑器中为单曲卡选择歌曲）
type MusicSearchSongDto struct {
	ID         int64    `json:"id"`
	Name       string   `json:"name"`
	Artists    []string `json:"artists"`
	Album      string   `json:"album"`
	AlbumPic   string   `json:"album_pic"`
	Aliases    []string `json:"aliases"`
	Duration   int64    `json:"duration"`    // 时长（毫秒）
	InPlaylist bool     `json:"in_playlist"` // 是否在博客歌单内（可在站内播放）
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

// MusicTTMLDto TTML 歌词：source 为 custom（自定义源）或 amll（AMLL TTML DB），ttml 为原文，由前端解析
type MusicTTMLDto struct {
	Source string `json:"source"`
	TTML   string `json:"ttml"`
}

// MusicQQLyricDto QQ 音乐歌词：按网易云歌曲的歌名、歌手、时长在 QQ 音乐匹配同一首歌。
// format 为 qrc（逐字）或 lrc（逐行）；lyric 为去掉 XML 外壳后的正文，translation 为 LRC，romanization 与正文同格式；
// ttml 为 AMLL TTML DB 按这首 QQ 歌曲收录的 TTML（没有时为空），均由前端解析
type MusicQQLyricDto struct {
	SongMID      string `json:"song_mid"`
	Format       string `json:"format"`
	Lyric        string `json:"lyric"`
	Translation  string `json:"translation"`
	Romanization string `json:"romanization"`
	TTML         string `json:"ttml,omitempty"`
}

// MusicKugouLyricDto 酷狗音乐歌词：hash 为匹配到的歌曲；后端已把 KRC 转换为与 QQ 音乐相同的格式——
// format 为 qrc（逐字）或 lrc，translation 为 LRC，romanization 为与正文逐字对齐的 QRC（均可能为空）
type MusicKugouLyricDto struct {
	Hash         string `json:"hash"`
	Format       string `json:"format"`
	Lyric        string `json:"lyric"`
	Translation  string `json:"translation"`
	Romanization string `json:"romanization"`
}

// MusicLyricAnnotationsDto 歌词标注：status 为 ready（已有结果）或 pending（生成中，稍后再取）。
// 标注只引用歌词文本（行文本 + 行内的短语），不含时间，由前端按文本匹配到歌词上。
// stale 为 true 时 lines 是旧结果（已过期或管理员刷新），后台正在重新生成，稍后再取可得到新结果
type MusicLyricAnnotationsDto struct {
	Status string `json:"status"`
	Stale  bool   `json:"stale,omitempty"`
	// 全曲字体（字体表中的名称，见 service.lyricAnnotationFonts），为空时用站点默认字体
	Font string `json:"font,omitempty"`
	// 前奏时显示的一句导语（模型写给听众），可为空
	Intro string `json:"intro,omitempty"`
	// 尾奏时显示的一条网易云热评（模型从热评中挑出最贴合歌曲的一条），可为空
	Outro *MusicLyricAnnotationComment `json:"outro,omitempty"`
	// 歌词关键节点的「时刻」：在某句开唱时显示的热评或模型写的旁白（最多 5 条）
	Moments []MusicLyricAnnotationMoment `json:"moments,omitempty"`
	Lines   []MusicLyricAnnotationLine   `json:"lines"`
}

// MusicLyricAnnotationMoment 一个「时刻」：在歌词 text 的第 occurrence 次出现（从 0 开始，副歌常有重复的行）开唱时显示；
// source 为 comment（网易云热评，liked 为点赞数）或 ai（模型写的旁白）
type MusicLyricAnnotationMoment struct {
	Text       string `json:"text"`
	Occurrence int    `json:"occurrence"`
	Content    string `json:"content"`
	Source     string `json:"source"`
	Liked      int64  `json:"liked,omitempty"`
}

// MusicLyricAnnotationComment 一条网易云热评：内容与点赞数
type MusicLyricAnnotationComment struct {
	Content string `json:"content"`
	Liked   int64  `json:"liked"`
}

// MusicLyricAnnotationLine 一行的标注：mood 为情绪基调（calm / bright / sad / intense，可为空），chorus 为副歌行，chorus_start 为一段副歌的第一行，
// scene 为从这一行开始的全屏粒子场景（见 service.lyricAnnotationSceneList，可为空），scene_color 为场景的颜色主题（色板中的名称，为空时用场景默认色）
type MusicLyricAnnotationLine struct {
	Text        string                       `json:"text"`
	Mood        string                       `json:"mood,omitempty"`
	Chorus      bool                         `json:"chorus,omitempty"`
	ChorusStart bool                         `json:"chorus_start,omitempty"`
	Scene       string                       `json:"scene,omitempty"`
	SceneColor  string                       `json:"scene_color,omitempty"`
	Phrases     []MusicLyricAnnotationPhrase `json:"phrases"`
}

// MusicLyricAnnotationPhrase 行内要强调的短语（该行原文的连续片段）、特效类型（swell / glow / wave / shake / focus / dissolve / shimmer / heartbeat）
// 与可选的颜色（语义化色板中的名称，如 starry-blue、violet，见 service.lyricAnnotationPalette；为空时不上色）
type MusicLyricAnnotationPhrase struct {
	Text   string `json:"text"`
	Effect string `json:"effect"`
	Color  string `json:"color,omitempty"`
	// 短语字体（字体表中的名称）与字形（bold / italic / underline），均可为空
	Font   string   `json:"font,omitempty"`
	Styles []string `json:"styles,omitempty"`
}

// MusicTTMLReq 只取某一来源（手动切换时），为空时自动选择
type MusicTTMLReq struct {
	Source  string `query:"source"`
	Refresh bool   `query:"refresh"`
}

// MusicLyricReq 网易云 / QQ 音乐歌词：refresh 为读者「重新获取歌词」，跳过缓存中「没有歌词」的记录
type MusicLyricReq struct {
	Refresh bool `query:"refresh"`
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

// MusicLyricCacheReq 上报一首歌选出的最佳歌词来源（ttml / ncm / qq / kugou），后端用自己获取的来源数据写入缓存
type MusicLyricCacheReq struct {
	Kind string `json:"kind" vd:"len($)>0"`
}

// MusicLyricCacheDto 歌词缓存快照：kind 为最佳来源；ncm / ttml / qq 与各来源接口的返回相同（只含需要的来源，网易云歌词总会附带，供翻译借用与单行歌词）
type MusicLyricCacheDto struct {
	Kind  string              `json:"kind"`
	Ncm   *MusicLyricDto      `json:"ncm,omitempty"`
	TTML  *MusicTTMLDto       `json:"ttml,omitempty"`
	QQ    *MusicQQLyricDto    `json:"qq,omitempty"`
	Kugou *MusicKugouLyricDto `json:"kugou,omitempty"`
}

// MusicChorusDto 网易云标出的副歌 / 高潮片段（毫秒）
type MusicChorusDto struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}
