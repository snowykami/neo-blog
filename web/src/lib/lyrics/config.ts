/**
 * 播放器页歌词引擎的可调参数（见 docs/music-player-spec.md 6.3）：集中定义为常量，不提供设置界面
 */

// 焦点条目的中心对齐到歌词区高度的位置（0 为顶部，1 为底部）
export const LYRIC_ALIGN_POSITION = 0.35

// 手动滚动后，停手多久回到自动对齐（毫秒）；期间冻结焦点，不跟随播放进度
export const LYRIC_USER_SCROLL_HOLD_MS = 3000

// 位移与缩放弹簧（重量 / 刚度 / 阻尼）
export const LYRIC_POSITION_SPRING = { mass: 1, stiffness: 100, damping: 10 }
export const LYRIC_SCALE_SPRING = { mass: 1, stiffness: 100, damping: 20 }

// 阶梯入场：同一帧内多行位移逐行增加的延迟（秒），越靠后的行递减为上一级的 1/1.05
export const LYRIC_STAGGER_BASE_S = 0.05
export const LYRIC_STAGGER_DECAY = 1.05

// 焦点行缩放为 1，其余行的缩放
export const LYRIC_INACTIVE_SCALE = 0.97

// 不在高亮中的行的文字不透明度：逐字歌词与行级歌词（行级歌词没有擦除，拉开对比）
export const LYRIC_INACTIVE_ALPHA = 0.35
export const LYRIC_INACTIVE_ALPHA_LINE_TIMED = 0.25

// 底栏的不透明度：默认 / 曲末聚焦时
export const LYRIC_FOOTER_ALPHA = 0.2
export const LYRIC_FOOTER_FOCUSED_ALPHA = 0.85

// 按距焦点的行距模糊：1 + 距离（px），上限 5px；窄视口（≤ 1024px）乘以 0.8
export const LYRIC_BLUR_MAX_PX = 5
export const LYRIC_BLUR_NARROW_FACTOR = 0.8

// 逐字擦除的羽化宽度（主字号的倍数，不得为 0）
export const LYRIC_FEATHER_EM = 0.5

// 词上浮：演唱时最多上移的距离（主字号的倍数）
export const LYRIC_WORD_FLOAT_EM = 0.05

// 相邻歌词行的空隙不短于此时长（毫秒）时判定为间奏
export const LYRIC_INTERLUDE_MIN_GAP_MS = 7000

// 视口外的预渲染范围（px）
export const LYRIC_OVERSCAN_PX = 300

// 进度突变超过此值（毫秒）时判定为跳转：瞬移到位，不走弹簧
export const LYRIC_SEEK_THRESHOLD_MS = 1000

// 单帧时间差上限（秒）：页面挂起后回归时避免动画以数秒的时长冲过头
export const LYRIC_MAX_FRAME_S = 0.1

// 松手后的惯性：速度每秒衰减到原来的倍数
export const LYRIC_INERTIA_DECAY_PER_S = 0.05
