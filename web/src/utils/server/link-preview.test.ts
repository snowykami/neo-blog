// @vitest-environment node
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  BlockedAddressError,
  decodeHtml,
  detectCharset,
  extractMetadata,
  fileMetadata,
  isImageBytes,
  normalizeAcceptLanguage,
  readHead,
  resolveFetchUrl,
  validateTargetUrl,
} from './link-preview'

// 「中文标题」的 GBK 编码
function gbk(text: string) {
  const table: Record<string, number[]> = { 中: [0xD6, 0xD0], 文: [0xCE, 0xC4], 标: [0xB1, 0xEA], 题: [0xCC, 0xE2] }
  return Buffer.from([...text].flatMap(char => table[char] ?? [char.charCodeAt(0)]))
}

describe('validateTargetUrl', () => {
  it('拒绝非 http(s)、带凭据、内网与 localhost 地址', () => {
    for (const url of [
      'ftp://example.com/',
      'https://user:pass@example.com/',
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[fd00:ec2::254]/',
      'http://localhost:3000/',
      'http://a.localhost/',
    ])
      expect(() => validateTargetUrl(url), url).toThrow(BlockedAddressError)
  })

  it('允许公网地址', () => {
    expect(validateTargetUrl('https://github.com/snowykami').hostname).toBe('github.com')
    expect(validateTargetUrl('http://1.1.1.1/').hostname).toBe('1.1.1.1')
  })
})

describe('resolveFetchUrl', () => {
  it('网易云音乐的 #/ 路由改写为服务端渲染地址', () => {
    expect(resolveFetchUrl(new URL('https://music.163.com/#/song?id=1487502645')).href)
      .toBe('https://music.163.com/song?id=1487502645')
  })

  it('不会被改写到其他站点，其他站点保持不变', () => {
    expect(resolveFetchUrl(new URL('https://music.163.com/#//evil.example/x')).href)
      .toBe('https://music.163.com/#//evil.example/x')
    expect(resolveFetchUrl(new URL('https://example.com/#/a')).href).toBe('https://example.com/#/a')
  })
})

describe('normalizeAcceptLanguage', () => {
  it('只保留首选语言并补上主语言与英文', () => {
    expect(normalizeAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7')).toBe('zh-CN,zh;q=0.9,en;q=0.8')
    expect(normalizeAcceptLanguage('ja')).toBe('ja,en;q=0.9')
    expect(normalizeAcceptLanguage('en-US,en;q=0.9')).toBe('en-US,en;q=0.9')
  })

  it('缺失或非法时使用英文', () => {
    expect(normalizeAcceptLanguage(null)).toBe('en')
    expect(normalizeAcceptLanguage('*')).toBe('en')
    expect(normalizeAcceptLanguage('zh\r\nX-Injected: 1')).toBe('en')
  })
})

describe('readHead', () => {
  const html = `<html><head><title>T</title></head><body>${'x'.repeat(10_000)}</body></html>`

  it('读到 </head> 即停止', async () => {
    const chunks = [html.slice(0, 40), html.slice(40, 50), html.slice(50)].map(part => Buffer.from(part))
    const buf = await readHead(Readable.from(chunks), '')
    expect(buf.toString()).toBe(html.slice(0, 40))
  })

  it('</head> 被拆在两块之间也能识别', async () => {
    const index = html.indexOf('</head>') + 3
    const source = Readable.from([Buffer.from(html.slice(0, index)), Buffer.from(html.slice(index, index + 10)), Buffer.from(html.slice(index + 10))])
    const buf = await readHead(source, '')
    expect(buf.length).toBe(index + 10)
  })

  it('按 Content-Encoding 解压（gzip / br / deflate）', async () => {
    for (const [encoding, compress] of [
      ['gzip', zlib.gzipSync],
      ['br', zlib.brotliCompressSync],
      ['deflate', zlib.deflateSync],
    ] as const) {
      const buf = await readHead(Readable.from([compress(Buffer.from(html))]), encoding)
      expect(buf.toString(), encoding).toContain('<title>T</title>')
    }
  })

  it('超过上限时截断', async () => {
    const buf = await readHead(Readable.from([Buffer.alloc(100, 'a'), Buffer.alloc(100, 'b')]), '', 150)
    expect(buf.length).toBe(150)
  })
})

describe('detectCharset / decodeHtml', () => {
  it('优先使用 Content-Type 中的编码', () => {
    const buf = Buffer.concat([Buffer.from('<meta charset="utf-8"><title>'), gbk('中文标题'), Buffer.from('</title>')])
    expect(detectCharset(buf, 'text/html; charset=GBK')).toBe('gbk')
    expect(decodeHtml(buf, 'text/html; charset=GBK')).toContain('<title>中文标题</title>')
  })

  it('响应头没有编码时读取 meta charset 与 http-equiv', () => {
    const meta = Buffer.concat([Buffer.from('<meta charset="gb2312"><title>'), gbk('中文标题'), Buffer.from('</title>')])
    expect(decodeHtml(meta, 'text/html')).toContain('中文标题')
    const equiv = Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=gbk"><title>'), gbk('中文标题')])
    expect(decodeHtml(equiv, '')).toContain('中文标题')
  })

  it('默认 UTF-8，未知编码与 meta 声明 UTF-16 时回退 UTF-8', () => {
    expect(detectCharset(Buffer.from('<title>x</title>'), 'text/html')).toBe('utf-8')
    expect(detectCharset(Buffer.from('<meta charset="no-such-charset">'), 'text/html; charset=bogus')).toBe('utf-8')
    expect(detectCharset(Buffer.from('<meta charset="utf-16">'), '')).toBe('utf-8')
  })
})

describe('extractMetadata', () => {
  const base = new URL('https://example.com/a/b')

  it('优先 Open Graph，相对地址按最终地址补全', () => {
    const preview = extractMetadata(`
      <head>
        <title>Fallback</title>
        <meta property="og:title" content="OG &amp; Title">
        <meta name="description" content="desc">
        <meta property="og:image" content="/cover.png">
        <meta property="og:site_name" content="Example">
        <link rel="shortcut icon" href="favicon.svg">
      </head>`, base, 'https://short.example/x')
    expect(preview).toEqual({
      title: 'OG & Title',
      description: 'desc',
      image: 'https://example.com/cover.png',
      favicon: 'https://example.com/a/favicon.svg',
      url: 'https://short.example/x',
      siteName: 'Example',
    })
  })

  it('只取第一个 <title>，没有元信息时标题为空、图标用默认地址', () => {
    expect(extractMetadata('<head><title> A\n B </title></head><body><svg><title>icon</title></svg></body>', base, base.href).title).toBe('A B')
    const empty = extractMetadata('<p>no head</p>', base, base.href)
    expect(empty.title).toBe('')
    expect(empty.favicon).toBe('https://example.com/favicon.ico')
    expect(empty.siteName).toBe('example.com')
  })

  it('忽略非 http(s) 的图片地址', () => {
    expect(extractMetadata('<meta property="og:image" content="javascript:alert(1)">', base, base.href).image).toBeUndefined()
  })
})

describe('非网页资源', () => {
  it('识别常见图片文件头', () => {
    expect(isImageBytes(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]))).toBe(true)
    expect(isImageBytes(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe(true)
    expect(isImageBytes(Buffer.from('GIF89a'))).toBe(true)
    expect(isImageBytes(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(true)
    expect(isImageBytes(Buffer.from('\0\0\0\x1Cftypavif'))).toBe(true)
    expect(isImageBytes(Buffer.from('%PDF-1.7'))).toBe(false)
  })

  it('图片作为封面，其他文件以文件名为标题', () => {
    const image = fileMetadata(new URL('https://cdn.example/files/abc123'), 'https://cdn.example/files/abc123', true)
    expect(image).toMatchObject({ title: '', image: 'https://cdn.example/files/abc123' })
    expect(fileMetadata(new URL('https://cdn.example/%E6%96%87%E6%A1%A3.pdf'), 'https://cdn.example/%E6%96%87%E6%A1%A3.pdf', false))
      .toMatchObject({ title: '文档.pdf', image: undefined, siteName: 'cdn.example' })
  })
})
