import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { siteIconVersionHash } from '@/utils/common/siteinfo'
import {
  decodeIcoFrame,
  getSharp,
  isBlockedHostname,
  isBlockedIpAddress,
  isExactIconVersionQuery,
  loadSafeIconSource,
  readResponseBytesBounded,
  renderRoundedIconWithSharp,
  sniffImageMime,
} from './icon-render'

function build2x2DibIco({ bpp = 32, withExplicitAlpha = true }: { bpp?: 24 | 32, withExplicitAlpha?: boolean } = {}): Buffer {
  const width = 2
  const height = 2
  const headerSize = 40
  const xorStride = Math.floor((width * bpp + 31) / 32) * 4
  const andStride = 4
  const dibSize = headerSize + xorStride * height + andStride * height
  const total = 6 + 16 + dibSize
  const buf = Buffer.alloc(total)

  // ICONDIR (1 entry)
  buf.writeUInt16LE(0, 0)
  buf.writeUInt16LE(1, 2)
  buf.writeUInt16LE(1, 4)

  // ICONDIRENTRY
  buf[6] = width
  buf[7] = height
  buf.writeUInt16LE(1, 10)
  buf.writeUInt16LE(bpp, 12)
  buf.writeUInt32LE(dibSize, 14)
  buf.writeUInt32LE(22, 18)

  // BITMAPINFOHEADER (bottom-up, rawHeight = height * 2)
  const dib = buf.subarray(22)
  dib.writeUInt32LE(headerSize, 0)
  dib.writeInt32LE(width, 4)
  dib.writeInt32LE(height * 2, 8)
  dib.writeUInt16LE(1, 12)
  dib.writeUInt16LE(bpp, 14)
  dib.writeUInt32LE(0, 16)

  // Bottom row (srcY = 0 -> top-down y = 1): blue (R=10, G=20, B=240)
  // Top row (srcY = 1 -> top-down y = 0): red (R=230, G=30, B=40), with x=1 masked transparent via AND mask when no explicit alpha
  for (let srcY = 0; srcY < height; srcY++) {
    const rowOffset = headerSize + srcY * xorStride
    const isTopRow = srcY === 1
    for (let x = 0; x < width; x++) {
      const px = rowOffset + x * (bpp / 8)
      dib[px] = isTopRow ? 40 : 240 // B
      dib[px + 1] = isTopRow ? 30 : 20 // G
      dib[px + 2] = isTopRow ? 230 : 10 // R
      if (bpp === 32)
        dib[px + 3] = withExplicitAlpha ? (isTopRow && x === 1 ? 0 : 255) : 0
    }
  }

  // AND mask: top row (srcY = 1), x = 1 bit (0x40) = 1 (transparent)
  const andOffset = headerSize + xorStride * height
  dib[andOffset + 1 * andStride] = 0x40

  return buf
}

describe('site-icon mime sniffing & ico decoding', () => {
  it('sniffs image formats by magic bytes even under application/octet-stream and rejects HTML', () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D]), 'application/octet-stream')).toBe('image/png')
    expect(sniffImageMime(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), 'application/octet-stream')).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39]), 'application/octet-stream')).toBe('image/gif')
    expect(sniffImageMime(Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary'), 'application/octet-stream')).toBe('image/webp')
    expect(sniffImageMime(Buffer.from('\x00\x00\x00\x1Cftypavif', 'binary'), 'application/octet-stream')).toBe('image/avif')
    expect(sniffImageMime(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]), 'application/octet-stream')).toBe('image/x-icon')
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'application/octet-stream')).toBe('image/svg+xml')
    expect(sniffImageMime(Buffer.from('<!-- Generator: Figma -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')).toBe('image/svg+xml')
    expect(sniffImageMime(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml')).toBeNull()
    expect(sniffImageMime(Buffer.from(`<svg>${' '.repeat(2048)}<script>alert(1)</script></svg>`), 'image/svg+xml')).toBeNull()
    expect(sniffImageMime(Buffer.from('<!DOCTYPE html><html>404</html>'), 'text/html')).toBeNull()
  })

  it('decodes 32-bit and 24-bit DIB .ico containers and renders 64x64 rounded PNG via sharp', async () => {
    const ico32 = build2x2DibIco({ bpp: 32, withExplicitAlpha: true })
    const decoded32 = decodeIcoFrame(ico32)
    expect(decoded32).not.toBeNull()
    expect(decoded32?.kind).toBe('raw')
    if (decoded32?.kind === 'raw') {
      // Top-left (0,0) = red opaque
      expect([...decoded32.rgba.subarray(0, 4)]).toEqual([230, 30, 40, 255])
      // Top-right (1,0) = transparent
      expect(decoded32.rgba[7]).toBe(0)
      // Bottom-left (0,1) = blue opaque
      expect([...decoded32.rgba.subarray(8, 12)]).toEqual([10, 20, 240, 255])
    }

    const ico24 = build2x2DibIco({ bpp: 24 })
    const decoded24 = decodeIcoFrame(ico24)
    expect(decoded24?.kind).toBe('raw')
    if (decoded24?.kind === 'raw') {
      expect([...decoded24.rgba.subarray(0, 4)]).toEqual([230, 30, 40, 255])
      expect(decoded24.rgba[7]).toBe(0)
    }

    if (getSharp() && decoded32) {
      const png = await renderRoundedIconWithSharp(decoded32, 50)
      expect(png).not.toBeNull()
      expect(png![0]).toBe(0x89)
      expect(png![1]).toBe(0x50)
    }
  })

  it('loads data URI and public static icon safely without network', async () => {
    const onePxPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const loadedData = await loadSafeIconSource(`data:image/png;base64,${onePxPngBase64}`)
    expect(loadedData?.decoded.kind).toBe('encoded')

    const rawPercentSvg = await loadSafeIconSource('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>')
    expect(rawPercentSvg?.decoded).toMatchObject({ kind: 'encoded', mime: 'image/svg+xml' })

    const loadedPublic = await loadSafeIconSource('/favicon.ico')
    expect(loadedPublic).not.toBeNull()
    expect(await loadSafeIconSource('/../../package.json')).toBeNull()
    expect(await loadSafeIconSource('/api/v1/agent-runner/secret')).toBeNull()
  })
})

describe('site-icon SSRF, bounded stream & version query checks', () => {
  it('blocks private, loopback, metadata, NAT64/6to4, and internal hostnames', () => {
    expect(isBlockedIpAddress('127.0.0.1')).toBe(true)
    expect(isBlockedIpAddress('10.0.0.5')).toBe(true)
    expect(isBlockedIpAddress('172.16.0.1')).toBe(true)
    expect(isBlockedIpAddress('192.168.1.1')).toBe(true)
    expect(isBlockedIpAddress('169.254.169.254')).toBe(true)
    expect(isBlockedIpAddress('100.100.100.200')).toBe(true)
    expect(isBlockedIpAddress('::1')).toBe(true)
    expect(isBlockedIpAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedIpAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedIpAddress('fc00::1')).toBe(true)
    expect(isBlockedIpAddress('fe80::1')).toBe(true)
    expect(isBlockedIpAddress('64:ff9b::10.0.0.1')).toBe(true)
    expect(isBlockedIpAddress('2002:7f00:1::')).toBe(true)

    expect(isBlockedIpAddress('1.1.1.1')).toBe(false)
    expect(isBlockedIpAddress('8.8.8.8')).toBe(false)
    expect(isBlockedIpAddress('2606:4700:4700::1111')).toBe(false)

    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('redis')).toBe(true)
    expect(isBlockedHostname('grafana.monitoring.svc.cluster.local')).toBe(true)
    expect(isBlockedHostname('cdn.example.com')).toBe(false)
  })

  it('cancels response stream immediately once maxBytes is exceeded', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const res = new Response(stream)
    const result = await readResponseBytesBounded(res, 2048)
    expect(result).toBeNull()
    expect(cancelled).toBe(true)
  })

  it('requires exact r & v query parameters without extra cache-busting keys', () => {
    const icon = '/api/v1/file/f/10/logo.webp'
    const v = siteIconVersionHash(icon)
    expect(isExactIconVersionQuery(new URLSearchParams({ r: '22', v }), 22, icon)).toBe(true)
    expect(isExactIconVersionQuery(new URLSearchParams({ r: '50', v }), 22, icon)).toBe(false)
    expect(isExactIconVersionQuery(new URLSearchParams({ r: '22', v, extra: '1' }), 22, icon)).toBe(false)
  })
})
