import type { SpringParams } from './spring'
import type { LyricMotion } from './types'

/**
 * 播放器页歌词引擎的可调参数（见 docs/music-player-spec.md 6.3）：集中定义为常量，不提供设置界面
 */

// 焦点条目的中心对齐到歌词区高度的位置（0 为顶部，1 为底部）
export const LYRIC_ALIGN_POSITION = 0.35

// 手动滚动后，停手多久回到自动对齐（毫秒）；期间冻结焦点，不跟随播放进度
export const LYRIC_USER_SCROLL_HOLD_MS = 3000

export interface LyricMotionPresetConfig {
  stiffness: number
  dampingRatio: number
  staggerBaseS: number
  inactiveScale: number
}

// 四档全曲滚动律动预设（与后端 lyricAnnotationMotionList 及 macOS LyricMotionPreset 严格 1:1 对齐）
export const LYRIC_MOTION_PRESETS: Record<LyricMotion, LyricMotionPresetConfig> = {
  flow: { stiffness: 168, dampingRatio: 0.78, staggerBaseS: 0.042, inactiveScale: 0.97 },
  bouncy: { stiffness: 185, dampingRatio: 0.66, staggerBaseS: 0.044, inactiveScale: 0.94 },
  crisp: { stiffness: 225, dampingRatio: 0.86, staggerBaseS: 0.026, inactiveScale: 0.965 },
  gentle: { stiffness: 118, dampingRatio: 0.88, staggerBaseS: 0.052, inactiveScale: 0.975 },
}

export function resolveLyricMotionPreset(motion?: LyricMotion | null): LyricMotionPresetConfig {
  return (motion && LYRIC_MOTION_PRESETS[motion]) || LYRIC_MOTION_PRESETS.flow
}

/**
 * 按全曲预设与当次切句时间间隔计算弹簧参数：
 * 当连续两句推进间隔 < 420ms（快嘴连切）时，自动收紧阻尼比至 ≥ 0.84 并提高刚度下限，防止 bouncy / gentle 在密集快句段上下晃动糊字
 */
export function resolveMotionSprings(
  motion?: LyricMotion | null,
  stepIntervalMs?: number | null,
): { position: SpringParams, scale: SpringParams, staggerBaseS: number, inactiveScale: number } {
  const preset = resolveLyricMotionPreset(motion)
  let k = preset.stiffness
  let zeta = preset.dampingRatio
  if (stepIntervalMs != null && stepIntervalMs > 0 && stepIntervalMs < 420) {
    const t = 1 - Math.max(0, stepIntervalMs - 160) / 260
    k = Math.max(k, k + (205 - k) * t)
    zeta = Math.max(zeta, zeta + (0.84 - zeta) * t)
  }
  const scaleZeta = Math.min(0.92, zeta + 0.05)
  return {
    position: { mass: 1, stiffness: k, damping: 2 * zeta * Math.sqrt(k) },
    scale: { mass: 1, stiffness: k, damping: 2 * scaleZeta * Math.sqrt(k) },
    staggerBaseS: preset.staggerBaseS,
    inactiveScale: preset.inactiveScale,
  }
}

const DEFAULT_SPRINGS = resolveMotionSprings('flow')

// 默认位移与缩放弹簧（flow 丝滑波浪档）；背景人声展开弹簧
export const LYRIC_POSITION_SPRING = DEFAULT_SPRINGS.position
export const LYRIC_SCALE_SPRING = DEFAULT_SPRINGS.scale
export const LYRIC_BG_EXPAND_SPRING = { mass: 1, stiffness: 170, damping: 26 }

// 阶梯入场：同一帧内可视区多行位移逐行增加的延迟（秒），越靠后的行递减为上一级的 1/1.05
export const LYRIC_STAGGER_BASE_S = DEFAULT_SPRINGS.staggerBaseS
export const LYRIC_STAGGER_DECAY = 1.05

// 焦点行缩放为 1，其余行的默认缩放；背景人声收起缩放；鼠标/触控按压缩放
export const LYRIC_INACTIVE_SCALE = DEFAULT_SPRINGS.inactiveScale
export const LYRIC_BG_COLLAPSED_SCALE = 0.88
export const LYRIC_PRESS_SCALE = 0.96

// 不在高亮中的行的文字不透明度：逐字歌词与行级歌词（行级歌词没有擦除，拉开对比）；手动滚动时整体提亮
export const LYRIC_INACTIVE_ALPHA = 0.35
export const LYRIC_INACTIVE_ALPHA_LINE_TIMED = 0.25
export const LYRIC_SCROLL_INACTIVE_ALPHA = 0.5
export const LYRIC_SCROLL_INACTIVE_ALPHA_LINE_TIMED = 0.4

// 底栏的不透明度：默认 / 曲末聚焦时
export const LYRIC_FOOTER_ALPHA = 0.2
export const LYRIC_FOOTER_FOCUSED_ALPHA = 0.85

// 非对称行距模糊：已唱行统一温和模糊 3px；待唱行按 1 + 距离（px）递增，上限 4px；窄视口（≤ 1024px）乘以 0.8
export const LYRIC_BLUR_PAST_PX = 3
export const LYRIC_BLUR_MAX_PX = 4
export const LYRIC_BLUR_NARROW_FACTOR = 0.8

// 逐字擦除的羽化宽度（主字号的倍数，不得为 0）
export const LYRIC_FEATHER_EM = 0.5

// 逐字扫词与普通词上浮的视觉提前量（毫秒，参考 StarryPlayer LyricsSpecs.animationHeadstart = 0.1s）
export const LYRIC_ANIMATION_HEADSTART_MS = 100

// 词上浮：演唱时最多上移的距离（主字号的倍数）
export const LYRIC_WORD_FLOAT_EM = 0.05

// 相邻歌词行的空隙不短于此时长（毫秒）时判定为间奏；句间间奏在上一句结束后延后此时长入场
export const LYRIC_INTERLUDE_MIN_GAP_MS = 7000
export const LYRIC_INTERLUDE_DELAY_MS = 100

// 视口外的预渲染范围（px）
export const LYRIC_OVERSCAN_PX = 300

// 进度突变超过此值（毫秒）时判定为跳转：瞬移到位，不走弹簧
export const LYRIC_SEEK_THRESHOLD_MS = 1000

// 单帧时间差上限（秒）：页面挂起后回归时避免动画以数秒的时长冲过头
export const LYRIC_MAX_FRAME_S = 0.1

// 逐字效果（擦除遮罩、强调特效）的最短重绘间隔（毫秒）：这些改动都要重绘文字，高刷新率屏幕上隔帧更新（约 60 Hz）；
// 行的滚动与缩放只改合成层，仍然逐帧
export const LYRIC_DETAIL_FRAME_MS = 12

// 强调的演出时长下限（毫秒）：唱得很快的短语也有完整的起落（播放器与调试面板共用）
export const LYRIC_EMPHASIS_MIN_MS = 1000

// 松手后的惯性：速度每秒衰减到原来的倍数
export const LYRIC_INERTIA_DECAY_PER_S = 0.05
