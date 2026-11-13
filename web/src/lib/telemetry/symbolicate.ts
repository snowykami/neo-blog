import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { originalPositionFor, sourceContentFor, TraceMap } from '@jridgewell/trace-mapping'

/**
 * 错误报告的源码还原（只在 Next 服务端运行）：构建时浏览器代码的 source map 被移出公开的 .next/static，
 * 放在 .next/sourcemaps 并按 JS 地址建立索引（见 scripts/collect-sourcemaps.mjs），这里把调用栈中的压缩位置还原为源码文件、行列与函数名，
 * 并附上出错行前后的源码。源码与 source map 都不对外提供；找不到对应的 source map（开发环境、滚动更新期间旧页面的代码块）时保持原样
 */

const ROOT = path.join(process.cwd(), '.next', 'sourcemaps')
const CONTEXT_LINES = 3
const MAX_LINE_LENGTH = 300
// 同时缓存的 source map 数（每个解析后约几 MB）
const CACHE_LIMIT = 24

interface Frame {
  filename?: string
  abs_path?: string
  function?: string
  lineno?: number
  colno?: number
  in_app?: boolean
  context_line?: string
  pre_context?: string[]
  post_context?: string[]
  minified?: string
}

let indexPromise: Promise<Record<string, string>> | null = null
const maps = new Map<string, Promise<TraceMap | null>>()

function loadIndex() {
  indexPromise ??= readFile(path.join(ROOT, 'index.json'), 'utf8')
    .then(text => JSON.parse(text) as Record<string, string>)
    .catch(() => ({}))
  return indexPromise
}

/** 读取并解析 source map（绝对路径），按插入顺序淘汰最早的 */
function loadMap(file: string) {
  let entry = maps.get(file)
  if (!entry) {
    entry = readFile(file, 'utf8').then(text => new TraceMap(text)).catch(() => null)
    maps.set(file, entry)
    if (maps.size > CACHE_LIMIT)
      maps.delete(maps.keys().next().value!)
  }
  return entry
}

/** Turbopack 的源码路径形如 turbopack:///[project]/src/a.ts，去掉前缀只留仓库内的相对路径 */
function cleanSource(source: string) {
  return source.replace(/^turbopack:\/\/\/\[project\]\//, '').replace(/^webpack:\/\/[^/]*\//, '').replace(/^\.\//, '')
}

/**
 * source map 里的名字是出错位置上的标识符，不一定是所在的函数：Safari 的列指向 throw 的表达式，
 * 如 new TypeError(...) 处为 TypeError。是内置的全局对象（TypeError、fetch、JSON 等）时不采用，保留原来的函数名
 */
function isFunctionName(name: string | null | undefined): name is string {
  return !!name && !(name in globalThis)
}

function clip(line: string) {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line
}

/**
 * 从栈帧 URL 中提取以 `/_next/static/` 开头的索引键：
 * 兼容同源路径、独立 CDN 域名以及带子路径前缀的 CDN assetPrefix（如 https://cdn.example.com/neo-blog/_next/static/...）
 */
export function toStaticPath(rawUrl: string): string | null {
  try {
    const { pathname } = new URL(rawUrl, 'http://localhost')
    const idx = pathname.indexOf('/_next/static/')
    return idx >= 0 ? pathname.slice(idx) : null
  }
  catch {
    return null
  }
}

async function symbolicateFrame(frame: Frame, index: Record<string, string>) {
  const url = frame.abs_path || frame.filename
  if (!url || !frame.lineno || !frame.colno)
    return
  const pathname = toStaticPath(url)
  if (!pathname)
    return
  const file = index[pathname]
  if (!file)
    return
  const map = await loadMap(path.join(ROOT, file))
  if (!map)
    return
  const position = originalPositionFor(map, { line: frame.lineno, column: frame.colno - 1 })
  if (!position.source || position.line == null)
    return
  const source = cleanSource(position.source)
  frame.minified = `${pathname}:${frame.lineno}:${frame.colno}`
  frame.abs_path = pathname
  frame.filename = source
  frame.lineno = position.line
  frame.colno = (position.column ?? 0) + 1
  if (isFunctionName(position.name))
    frame.function = position.name
  frame.in_app = !source.includes('node_modules/')
  const content = sourceContentFor(map, position.source)
  if (content) {
    const lines = content.split('\n')
    const at = position.line - 1
    frame.context_line = clip(lines[at] ?? '')
    frame.pre_context = lines.slice(Math.max(0, at - CONTEXT_LINES), at).map(clip)
    frame.post_context = lines.slice(at + 1, at + 1 + CONTEXT_LINES).map(clip)
  }
}

// 服务端代码块末尾指向 source map 的注释
const MAPPING_COMMENT = /\/\/# sourceMappingURL=(\S+)\s*$/
const serverMapFiles = new Map<string, Promise<string | null>>()

/** 服务端代码块对应的 source map 文件：从代码末尾的 sourceMappingURL 注释找到，同目录下不存在时为空 */
function serverMapFile(file: string) {
  let entry = serverMapFiles.get(file)
  if (!entry) {
    entry = readFile(file, 'utf8')
      .then((code) => {
        const match = MAPPING_COMMENT.exec(code.slice(-512))
        return match && !match[1].startsWith('data:') ? path.join(path.dirname(file), decodeURIComponent(match[1])) : null
      })
      .catch(() => null)
    serverMapFiles.set(file, entry)
  }
  return entry
}

/**
 * Next 服务端错误的调用栈：source map 在代码块旁边时（next start、本地运行）还原到源码位置；
 * standalone 部署不带服务端的 source map，只把绝对路径缩短为相对项目目录的路径
 */
export async function symbolicateServerFrames(frames: Frame[]) {
  const root = process.cwd()
  await Promise.all(frames.map(async (frame) => {
    const file = frame.filename
    if (!file || !path.isAbsolute(file) || !frame.lineno || !frame.colno)
      return
    const mapFile = await serverMapFile(file)
    const map = mapFile ? await loadMap(mapFile) : null
    const position = map ? originalPositionFor(map, { line: frame.lineno, column: frame.colno - 1 }) : null
    if (position?.source && position.line != null) {
      frame.minified = `${path.relative(root, file)}:${frame.lineno}:${frame.colno}`
      // 服务端 source map 的源码路径是相对 map 文件的（且经过 URL 编码），换算成相对项目目录的路径
      frame.filename = position.source.startsWith('turbopack://')
        ? cleanSource(position.source)
        : path.relative(root, path.resolve(path.dirname(mapFile!), decodeURIComponent(position.source)))
      frame.lineno = position.line
      frame.colno = (position.column ?? 0) + 1
      if (isFunctionName(position.name))
        frame.function = position.name
      frame.in_app = !frame.filename.includes('node_modules/')
      return
    }
    frame.filename = path.relative(root, file)
  }))
}

// 上报内容来自公开接口：一次只还原有限的事件与帧，避免被构造的超长调用栈占满 CPU（后端保存时也只留这么多，见 errorFrameLimit / errorEventsPerEnvelope）
const MAX_EVENTS = 5
const MAX_FRAMES_PER_EXCEPTION = 60

/** 还原一条错误事件中全部异常的调用栈：每个异常只还原最靠近出错处的帧（Sentry 的帧按调用顺序排列，出错处在末尾） */
async function symbolicateEvent(event: { exception?: { values?: { stacktrace?: { frames?: Frame[] } }[] } }) {
  const index = await loadIndex()
  const frames = (event.exception?.values ?? []).flatMap(value => (value.stacktrace?.frames ?? []).slice(-MAX_FRAMES_PER_EXCEPTION))
  await Promise.all(frames.map(frame => symbolicateFrame(frame, index)))
}

/**
 * 还原 envelope 中错误事件的调用栈并重新序列化；其余条目原样保留。
 * 条目头带 length 时按字节截取内容（内容可能含换行），重新序列化后去掉 length（由读到行尾代替）
 */
export async function symbolicateEnvelope(body: string): Promise<string> {
  const buffer = Buffer.from(body, 'utf8')
  let offset = buffer.indexOf(0x0A)
  if (offset < 0)
    return body
  const out: string[] = [buffer.subarray(0, offset).toString('utf8')]
  offset++
  let events = 0
  while (offset < buffer.length) {
    let end = buffer.indexOf(0x0A, offset)
    if (end < 0)
      end = buffer.length
    const headerText = buffer.subarray(offset, end).toString('utf8')
    offset = end + 1
    if (!headerText.trim())
      continue
    const header = JSON.parse(headerText) as { type?: string, length?: number }
    let payload: Buffer
    if (typeof header.length === 'number') {
      payload = buffer.subarray(offset, offset + header.length)
      offset += header.length
      if (buffer[offset] === 0x0A)
        offset++
    }
    else {
      let payloadEnd = buffer.indexOf(0x0A, offset)
      if (payloadEnd < 0)
        payloadEnd = buffer.length
      payload = buffer.subarray(offset, payloadEnd)
      offset = payloadEnd + 1
    }
    if (header.type !== 'event') {
      out.push(headerText, payload.toString('utf8'))
      continue
    }
    const event = JSON.parse(payload.toString('utf8'))
    if (events++ < MAX_EVENTS)
      await symbolicateEvent(event)
    delete header.length
    out.push(JSON.stringify(header), JSON.stringify(event))
  }
  return `${out.join('\n')}\n`
}
