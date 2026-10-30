package dto

import "time"

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
	// 当前访客能否在站内播放（歌单、公开文章引用的歌曲，或登录的管理员与编辑，见 service/music_whitelist.go）；只在单曲接口返回时填写
	Playable bool `json:"playable"`
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
	// 全曲特效节奏：slow / fast（按歌曲的轻快程度），为空时为 medium
	Pace string `json:"pace,omitempty"`
	// 前奏时显示的一句导语（模型写给听众），可为空
	Intro string `json:"intro,omitempty"`
	// 尾奏时显示的一条网易云热评（模型从热评中挑出最贴合歌曲的一条），可为空
	Outro *MusicLyricAnnotationComment `json:"outro,omitempty"`
	// 歌词关键节点的「时刻」：在某句开唱时显示的热评或模型写的旁白（最多 5 条）
	Moments []MusicLyricAnnotationMoment `json:"moments,omitempty"`
	// 聚光灯：全曲最点题的 1～3 句中、选定的那几次出现（同一句重复时不一定每次都放大），唱到时移到中央放大、身后亮起暖光，可为空
	Spotlights []MusicLyricAnnotationSpotlight `json:"spotlights,omitempty"`
	// 这首歌的主题色（#rrggbb，由模型按歌曲自由选择）：歌词辉光与背景呼吸的默认颜色，为空时用封面主色
	Accent string                     `json:"accent,omitempty"`
	Lines  []MusicLyricAnnotationLine `json:"lines"`
	// 这首歌的自定义粒子（最多 2 种）：行的 scene 为 custom:<name> 时使用，见 MusicLyricSprite
	Sprites []MusicLyricSprite `json:"sprites,omitempty"`
	// 管理员手动编辑过（不再因过期自动重新生成；播放器里手动重新生成前提示会覆盖编辑）
	Edited bool `json:"edited,omitempty"`
	// 标注所属的全站歌词版本（具体来源，与前端 ResolvedLyrics.source 一致）：前端只在显示这一版本时叠加特效
	Source string `json:"source,omitempty"`
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

// MusicLyricSprite 自定义粒子：歌词里有内置粒子场景表达不了的具体意象（玩偶、纸飞机、糖果）时，由模型从精选图标库中选一个图标，
// 或自己画一个简单剪影（24×24 的路径）；motion 为动作预设（fall / float / drift / sway / swirl / burst），size 为 s / m / l，
// color 为色板中的名称。路径只在粒子画布上用 Path2D 绘制，不作为 SVG 插入页面
type MusicLyricSprite struct {
	Name   string                 `json:"name"`
	Label  string                 `json:"label,omitempty"`
	Icon   string                 `json:"icon,omitempty"`
	Paths  []MusicLyricSpritePath `json:"paths"`
	Motion string                 `json:"motion"`
	Size   string                 `json:"size"`
	Spin   bool                   `json:"spin,omitempty"`
	Color  string                 `json:"color"`
}

// MusicLyricSpritePath 粒子的一条路径：d 为 SVG 路径数据（只含绝对坐标的 M L H V C Q A Z），paint 为 fill（主色填充）、
// light（浅色填充）、stroke（细线）或 line（图标库的线条，线宽较粗）
type MusicLyricSpritePath struct {
	D     string `json:"d"`
	Paint string `json:"paint"`
}

// MusicLyricAnnotationSpotlight 聚光灯的一处：歌词 text 的第 occurrence 次出现（从 0 开始，副歌常有重复的行）
type MusicLyricAnnotationSpotlight struct {
	Text       string `json:"text"`
	Occurrence int    `json:"occurrence"`
}

// MusicLyricAnnotationComment 一条网易云热评：内容与点赞数
type MusicLyricAnnotationComment struct {
	Content string `json:"content"`
	Liked   int64  `json:"liked"`
}

// MusicLyricAnnotationLine 一行的标注：mood 为情绪基调（calm / bright / sad / intense，可为空），chorus 为副歌行，chorus_start 为一段副歌的第一行，
// scene 为从这一行开始的全屏粒子场景（见 service.lyricAnnotationSceneList，可为空），scene_color 为场景的颜色主题（色板中的名称，为空时用场景默认色），
// scene_lines 为场景持续的歌词行数（含这一行，1～16；为 0 时由播放器按默认行数结束）。标注按行文字保存，同一文字的每次出现都从这一行起持续相同的行数
type MusicLyricAnnotationLine struct {
	Text        string                       `json:"text"`
	Mood        string                       `json:"mood,omitempty"`
	Chorus      bool                         `json:"chorus,omitempty"`
	ChorusStart bool                         `json:"chorus_start,omitempty"`
	Scene       string                       `json:"scene,omitempty"`
	SceneColor  string                       `json:"scene_color,omitempty"`
	SceneLines  int                          `json:"scene_lines,omitempty"`
	Phrases     []MusicLyricAnnotationPhrase `json:"phrases"`
}

// MusicLyricAnnotationPhrase 行内要强调的短语（该行原文的连续片段）、特效类型（swell / glow / wave / shake / focus / dissolve / shatter / shimmer / heartbeat）
// 与可选的颜色（语义化色板中的名称，如 starry-blue、violet，见 service.lyricAnnotationPalette；为空时不上色）
type MusicLyricAnnotationPhrase struct {
	Text   string `json:"text"`
	Effect string `json:"effect"`
	Color  string `json:"color,omitempty"`
	// 短语字体（字体表中的名称）与字形（bold / italic / underline），均可为空
	Font   string   `json:"font,omitempty"`
	Styles []string `json:"styles,omitempty"`
	// 特效节奏：slow / fast，为空时沿用全曲的节奏（见 MusicLyricAnnotationsDto.Pace）
	Pace string `json:"pace,omitempty"`
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

// MusicSongAudioReq 播放地址：level 为试听用的较低音质（standard / higher），不高于后台设置的音质，为空时用后台设置
type MusicSongAudioReq struct {
	Level string `query:"level"`
}

// MusicSongAudioURLDto 歌曲的临时播放地址（网易云 CDN，支持 Range 与跨源读取，有效期数分钟）
type MusicSongAudioURLDto struct {
	URL string `json:"url"`
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

// MusicLyricCacheDto 歌词缓存快照：kind 为全站歌词版本的来源；ncm / ttml / qq 与各来源接口的返回相同（只含需要的来源，网易云歌词总会附带，供翻译借用与单行歌词）
type MusicLyricCacheDto struct {
	Kind  string              `json:"kind"`
	Ncm   *MusicLyricDto      `json:"ncm,omitempty"`
	TTML  *MusicTTMLDto       `json:"ttml,omitempty"`
	QQ    *MusicQQLyricDto    `json:"qq,omitempty"`
	Kugou *MusicKugouLyricDto `json:"kugou,omitempty"`
}

// MusicLyricVersionDto 全站歌词版本（后端选出，见 docs/music-player-spec.md 7.2o）：kind 为来源（ttml / ncm / qq / kugou），
// source 为具体来源（与前端 ResolvedLyrics.source 一致，如 ttml-amll、ncm-yrc）；没有歌词时都为空
type MusicLyricVersionDto struct {
	Kind   string `json:"kind"`
	Source string `json:"source"`
}

// MusicLyricStreamSourceDto 歌词流中一个来源的结果：data 与该来源接口的返回相同，没有歌词时为 null；
// failed 为获取失败（出错或超时，不代表没有歌词，前端之后可以重试）
type MusicLyricStreamSourceDto struct {
	Kind   string `json:"kind"`
	Data   any    `json:"data"`
	Failed bool   `json:"failed,omitempty"`
}

// MusicChorusDto 网易云标出的副歌 / 高潮片段（毫秒）
type MusicChorusDto struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// MusicLyricSettingsDto 一首歌的歌词人工设置：offsets 为各歌词来源（ResolvedLyrics.source）的整体偏移（毫秒，正数推迟、负数提前），没有设置的来源不出现；
// pin 为管理员选定的全站默认歌词来源（ttml / ncm / qq / kugou），没有时为空（按质量自动选择）
type MusicLyricSettingsDto struct {
	Offsets map[string]int `json:"offsets"`
	Pin     string         `json:"pin,omitempty"`
}

// MusicLyricPinReq 管理员设置全站默认歌词来源，kind 为空时取消（恢复按质量自动选择）
type MusicLyricPinReq struct {
	Kind string `json:"kind"`
}

// MusicLyricOffsetReq 管理员保存某一歌词来源的整体偏移（毫秒），为 0 时清除
type MusicLyricOffsetReq struct {
	Source   string `json:"source" vd:"len($)>0"`
	OffsetMs int    `json:"offset_ms"`
}

// MusicLyricAnnotationsEditReq 管理员手动编辑的歌词标注：只含可编辑的部分（全曲字体、节奏、导语、主题色、聚光灯与各行），时刻与尾奏热评保持原样
type MusicLyricAnnotationsEditReq struct {
	Font       string                          `json:"font"`
	Pace       string                          `json:"pace"`
	Intro      string                          `json:"intro"`
	Accent     string                          `json:"accent"`
	Spotlights []MusicLyricAnnotationSpotlight `json:"spotlights"`
	Lines      []MusicLyricAnnotationLine      `json:"lines"`
}

// MusicLyricAnnotationEditorDto 后台编辑一首歌的歌词标注所需的数据：lines 为送去标注的完整歌词（按顺序、含重复的行），
// annotation 为当前标注（还没有时为空）；edited_at 为手动编辑时间，generated_at / model 为最近一次 AI 生成的时间与模型，generating 为正在生成
type MusicLyricAnnotationEditorDto struct {
	Lines       []string                  `json:"lines"`
	Annotation  *MusicLyricAnnotationsDto `json:"annotation"`
	EditedAt    *time.Time                `json:"edited_at,omitempty"`
	GeneratedAt *time.Time                `json:"generated_at,omitempty"`
	Model       string                    `json:"model,omitempty"`
	Generating  bool                      `json:"generating"`
}

// MusicLyricAnnotationSummaryDto 后台歌词特效列表中的一条：已有标注的歌曲、短语数与生成 / 编辑时间
type MusicLyricAnnotationSummaryDto struct {
	SongID      int64      `json:"song_id"`
	Phrases     int        `json:"phrases"`
	GeneratedAt time.Time  `json:"generated_at"`
	EditedAt    *time.Time `json:"edited_at,omitempty"`
	Model       string     `json:"model,omitempty"`
	// 生成时全站歌词版本的具体来源（旧数据为空）
	Source string `json:"source,omitempty"`
	// 这份标注不属于当前的全站歌词版本（版本已更换，下次播放时按新版本重新生成）
	Outdated bool `json:"outdated,omitempty"`
	// 这首歌有手动编辑过、但属于旧歌词版本的标注（不再显示）时，最近一次编辑的时间
	OutdatedEditedAt *time.Time `json:"outdated_edited_at,omitempty"`
}
