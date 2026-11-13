import type { NextRequest } from 'next/server'
import { connection } from 'next/server'
import { getSiteInfo } from '@/api/misc'
import { listOidcConfigs } from '@/api/user'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

const PROVIDER_PATTERN = /^[\w-]{1,64}$/
const DEFAULT_FALLBACK_PROVIDER = 'liteyuki-lab'

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

export async function GET(request: NextRequest) {
  // 按请求生成：构建期连不上后端，预渲染会把兜底的站点地址固化进去
  await connection()

  const rawParam = request.nextUrl.searchParams.get('name') ?? request.nextUrl.searchParams.get('provider')
  let providerName: string

  if (rawParam !== null) {
    const trimmed = rawParam.trim()
    if (!PROVIDER_PATTERN.test(trimmed)) {
      return new Response('Invalid provider name', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    providerName = trimmed
  }
  else {
    const configs = await listOidcConfigs()
      .then(res => res.data ?? [])
      .catch(() => [])
    const firstValid = configs.find(c => typeof c.name === 'string' && PROVIDER_PATTERN.test(c.name.trim()))
    providerName = firstValid ? firstValid.name.trim() : DEFAULT_FALLBACK_PROVIDER
  }

  const siteInfo = await getSiteInfo()
    .then(res => res.data)
    .catch(() => fallbackSiteInfo)

  const baseUrl = (siteInfo?.baseUrl || request.nextUrl.origin || '').trim().replace(/\/+$/, '')
  const appName = siteInfo?.metadata?.name?.trim() || 'Neo Blog'
  const redirectUri = `${baseUrl}/api/v1/user/oidc/login/${encodeURIComponent(providerName)}`
  const appUrl = baseUrl || '/'

  return new Response(
    `<link rel="redirect_uri" href="${escapeHtml(redirectUri)}">
<!-- ユーザーに見せるアプリの名前になります。なかったらこのページのアドレスが名前になります。 -->
<div class="h-app">
    <a href="${escapeHtml(appUrl)}" class="u-url p-name">${escapeHtml(appName)}</a>
</div>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  )
}
