import type { AIWriteEvent, AIWriteRequest, AIWriteTarget } from '@/models/ai-write'
import { isAxiosError } from 'axios'
import { snakeToCamelObj } from 'field-conv'
import axiosClient from './client'

/** 解析一条 SSE 消息（event + data 行），无法识别时返回 null */
function parseSSEMessage(raw: string): AIWriteEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:'))
      event = line.slice(6).trim()
    else if (line.startsWith('data:'))
      data.push(line.slice(5).trimStart())
  }
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(data.join('\n') || 'null') ?? {}
  }
  catch {
    return null
  }
  switch (event) {
    case 'delta':
      return { event, text: String(payload.text ?? '') }
    case 'error':
      return { event, message: String(payload.message ?? '') }
    case 'queued':
    case 'thinking':
    case 'done':
    case 'ping':
      return { event }
    default:
      return null
  }
}

/**
 * 编辑器 AI 写作（帮写 / 润色）：后端以 SSE 流式返回，逐个回调事件，流结束后 resolve
 * 校验失败（无权限、未配置 AI 等）时后端返回普通 JSON 错误，按 axios 错误抛出；通过 signal 取消
 */
export async function streamAIWrite({ target, id, request, signal, onEvent }: {
  target: AIWriteTarget
  id: number
  request: AIWriteRequest
  signal: AbortSignal
  onEvent: (event: AIWriteEvent) => void
}): Promise<void> {
  let stream: ReadableStream<Uint8Array>
  try {
    const res = await axiosClient.post(`/${target}/p/${id}/ai-write`, request, {
      adapter: 'fetch',
      responseType: 'stream',
      withCredentials: true,
      // 生成可能持续数分钟，不使用默认超时
      timeout: 0,
      signal,
    })
    stream = res.data
  }
  catch (error) {
    // 错误响应体同样是流，读出 JSON 后交给通用的错误文案处理
    const response = isAxiosError(error) ? error.response : undefined
    if (response && response.data instanceof ReadableStream) {
      const text = await new Response(response.data).text().catch(() => '')
      try {
        response.data = snakeToCamelObj(JSON.parse(text))
      }
      catch {
        response.data = { message: text }
      }
    }
    throw error
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const message = parseSSEMessage(buffer.slice(0, index))
      buffer = buffer.slice(index + 2)
      if (message)
        onEvent(message)
      index = buffer.indexOf('\n\n')
    }
  }
}
