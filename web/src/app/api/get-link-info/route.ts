import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getLoginUserServer } from '@/api/user.server'
import { BlockedAddressError, getLinkPreview, validateTargetUrl } from '@/utils/server/link-preview'

export async function GET(request: NextRequest) {
  // 仅登录用户可用，避免被匿名滥用为代理
  const user = await getLoginUserServer().then(res => res.data).catch(() => null)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  let host: string
  try {
    host = validateTargetUrl(url).host
  }
  catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    const preview = await getLinkPreview(url, request.headers.get('accept-language'))
    return NextResponse.json(preview, {
      // 结果与用户无关，但接口需要登录，仅允许浏览器私有缓存
      headers: { 'Cache-Control': 'private, max-age=3600' },
    })
  }
  catch (error) {
    if (error instanceof BlockedAddressError)
      return NextResponse.json({ error: 'Blocked URL' }, { status: 400 })
    // 失败多为对方站点拦截、限流或超时，记录站点便于排查；不缓存，稍后可重试
    console.error('Link preview error:', host, error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to fetch link preview' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
