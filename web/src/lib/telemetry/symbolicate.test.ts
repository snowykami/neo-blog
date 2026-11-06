// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// 手写的 source map：压缩后第 1 行第 1 列对应源码 src/a.ts 第 2 行第 1 列，名字为 boom
const MAP = {
  version: 3,
  sources: ['turbopack:///[project]/src/a.ts'],
  sourcesContent: ['const a = 1\nboom()\nconst c = 3\n'],
  names: ['boom'],
  mappings: 'AACAA',
}

const cwd = process.cwd()
let symbolicateEnvelope: (body: string) => Promise<string>

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'symbolicate-'))
  mkdirSync(join(dir, '.next/sourcemaps/chunks'), { recursive: true })
  writeFileSync(join(dir, '.next/sourcemaps/chunks/a.js.map'), JSON.stringify(MAP))
  writeFileSync(join(dir, '.next/sourcemaps/index.json'), JSON.stringify({ '/_next/static/chunks/x.js': 'chunks/a.js.map' }))
  process.chdir(dir)
  vi.resetModules()
  ;({ symbolicateEnvelope } = await import('./symbolicate'))
})

afterAll(() => {
  process.chdir(cwd)
})

function envelope(...items: { header: Record<string, unknown>, payload: string }[]) {
  return [JSON.stringify({ event_id: 'x' }), ...items.flatMap(item => [JSON.stringify(item.header), item.payload])].join('\n')
}

describe('symbolicateEnvelope', () => {
  it('还原调用栈中的压缩位置，附上出错行前后的源码；找不到 source map 的帧保持原样', async () => {
    const event = {
      exception: { values: [{ type: 'TypeError', value: 'boom is not a function', stacktrace: { frames: [
        { filename: 'https://blog.example.com/_next/static/chunks/other.js', function: 'r', lineno: 1, colno: 9 },
        { filename: 'https://blog.example.com/_next/static/chunks/x.js?v=1', function: 'e', lineno: 1, colno: 1 },
      ] } }] },
    }
    // 条目头带 length 时按字节截取（内容中有中文）
    const payload = JSON.stringify({ ...event, message: '出错了' })
    const out = await symbolicateEnvelope(envelope(
      { header: { type: 'event', length: Buffer.byteLength(payload) }, payload },
      { header: { type: 'client_report' }, payload: '{"discarded_events":[]}' },
    ))
    const lines = out.trim().split('\n')
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' })
    const frames = JSON.parse(lines[2]).exception.values[0].stacktrace.frames
    expect(frames[0]).toEqual(event.exception.values[0].stacktrace.frames[0])
    expect(frames[1]).toMatchObject({
      filename: 'src/a.ts',
      abs_path: '/_next/static/chunks/x.js',
      function: 'boom',
      lineno: 2,
      colno: 1,
      in_app: true,
      context_line: 'boom()',
      pre_context: ['const a = 1'],
      post_context: ['const c = 3', ''],
      minified: '/_next/static/chunks/x.js:1:1',
    })
    expect(JSON.parse(lines[2]).message).toBe('出错了')
    expect(lines.slice(3)).toEqual(['{"type":"client_report"}', '{"discarded_events":[]}'])
  })
})
