/// <reference lib="webworker" />
import { analyzeRhythm } from './analysis'

/** 节拍分析在 Worker 中进行（约 1 秒），不阻塞播放器的逐帧动画；样本由主线程解码后转交 */
interface AnalyzeRequest {
  id: number
  samples: Float32Array
  sampleRate: number
}

const scope = globalThis as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { id, samples, sampleRate } = event.data
  try {
    const analysis = analyzeRhythm(samples, sampleRate, progress => scope.postMessage({ id, progress }))
    scope.postMessage({ id, analysis }, [analysis.onset.buffer, analysis.autocorr.buffer])
  }
  catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
