// 基础浏览器指纹：仅使用稳定、低侵入的特征（不含 Canvas/WebGL/音频指纹），
// 用于 Cookie 丢失时辅助识别同一访客；开启“请勿追踪”或全局隐私控制时不计算
let cached: Promise<string> | null = null

function doNotTrack() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean, msDoNotTrack?: string }
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true
}

async function compute(): Promise<string> {
  if (typeof window === 'undefined' || doNotTrack() || !window.crypto?.subtle)
    return ''
  const nav = navigator as Navigator & { deviceMemory?: number }
  const features = [
    nav.userAgent,
    nav.language,
    (nav.languages || []).join(','),
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}x${screen.colorDepth}@${window.devicePixelRatio}`,
    nav.hardwareConcurrency ?? '',
    nav.deviceMemory ?? '',
    nav.platform,
    nav.maxTouchPoints ?? '',
  ].join('|')
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(features))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export function getFingerprint(): Promise<string> {
  cached ??= compute().catch(() => '')
  return cached
}
