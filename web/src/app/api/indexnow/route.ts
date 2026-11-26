import type { NextRequest } from 'next/server'
import process from 'node:process'
import { connection } from 'next/server'

const INDEXNOW_KEY_RE = /^[a-z0-9-]{8,128}$/i
const INDEXNOW_FETCH_TIMEOUT_MS = 2500

function resolveBackendOrigin(): string {
  return (
    process.env.BACKEND_URL
    || (process.env.NODE_ENV === 'production' ? 'http://neo-blog-backend:8888' : 'http://localhost:8888')
  ).replace(/\/+$/, '')
}

export async function GET(request: NextRequest) {
  await connection()
  const key = request.nextUrl.searchParams.get('key')?.trim() ?? ''
  if (!INDEXNOW_KEY_RE.test(key)) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  let matched = false
  let degraded = false
  try {
    const res = await fetch(
      `${resolveBackendOrigin()}/api/v1/misc/indexnow-key?key=${encodeURIComponent(key)}`,
      {
        headers: { Accept: 'text/plain' },
        cache: 'no-store',
        signal: AbortSignal.timeout(INDEXNOW_FETCH_TIMEOUT_MS),
      },
    )
    if (res.status === 200) {
      matched = (await res.text()).trim() === key
    }
    else if (res.status !== 404) {
      degraded = true
    }
  }
  catch {
    degraded = true
  }

  if (!matched) {
    return new Response(degraded ? 'Service Unavailable' : 'Not Found', {
      status: degraded ? 503 : 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': degraded ? 'no-store' : 'public, max-age=60',
      },
    })
  }

  return new Response(key, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
}
