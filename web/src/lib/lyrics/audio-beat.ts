/**
 * 跟随鼓点的背景呼吸（播放器页）：用 Web Audio 的 AnalyserNode 读取正在播放的音频的低频能量，
 * 能量突然高于近期平均值时视为一次节拍。音频元素一旦接入 Web Audio 就无法撤回，所以只在确认可用时接入（见 MusicStageEffects）
 */

export interface BeatGraph {
  context: AudioContext
  analyser: AnalyserNode
  data: Uint8Array<ArrayBuffer>
}

const graphs = new WeakMap<HTMLMediaElement, BeatGraph>()

/** 节拍分析只取低频（鼓点、贝斯） */
const LOW_HZ = 160

/**
 * 把音频元素接入分析图（每个元素只接一次）；必须在用户手势中调用，否则 AudioContext 处于挂起状态。
 * 调用前须确认音频以 CORS 加载，否则接入后会被静音
 */
export function connectBeatAnalyser(audio: HTMLMediaElement): BeatGraph | null {
  const existing = graphs.get(audio)
  if (existing) {
    if (existing.context.state === 'suspended')
      void existing.context.resume()
    return existing
  }
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context)
    return null
  try {
    const context = new Context()
    const source = context.createMediaElementSource(audio)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.5
    source.connect(analyser)
    analyser.connect(context.destination)
    void context.resume()
    const graph = { context, analyser, data: new Uint8Array(analyser.frequencyBinCount) }
    graphs.set(audio, graph)
    return graph
  }
  catch {
    return null
  }
}

export interface BeatState {
  // 近期低频能量的平均值与当前节拍强度（0 ~ 1）
  average: number
  level: number
}

/** 推进 dt 秒：能量明显高于近期平均时触发节拍，节拍强度随后指数衰减 */
export function beatStep(state: BeatState, energy: number, dt: number): BeatState {
  const average = state.average + (energy - state.average) * Math.min(1, dt * 2.5)
  let level = state.level * Math.exp(-dt * 7)
  const onset = energy - state.average * 1.15
  if (onset > 0.02)
    level = Math.max(level, Math.min(1, onset / Math.max(0.1, state.average * 0.6)))
  return { average, level }
}

/** 从分析图读取当前低频能量（0 ~ 1） */
export function lowEnergy(graph: BeatGraph): number {
  graph.analyser.getByteFrequencyData(graph.data)
  const binHz = graph.context.sampleRate / graph.analyser.fftSize
  const bins = Math.max(1, Math.min(graph.data.length, Math.ceil(LOW_HZ / binHz)))
  let sum = 0
  for (let i = 0; i < bins; i++)
    sum += graph.data[i]
  return sum / bins / 255
}
