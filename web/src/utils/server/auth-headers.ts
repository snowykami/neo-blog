import { cookies } from 'next/headers'

// 仅用于后端鉴权头
export default async function getAuthHeaders(): Promise<Record<string, string>> {
  const cookieStore = await cookies()
  const headers: Record<string, string> = {}
  const cookieParts: string[] = []
  const token = cookieStore.get('token')?.value || ''
  const refreshToken = cookieStore.get('refresh_token')?.value || ''
  if (token) {
    cookieParts.push(`token=${token}`)
  }
  if (refreshToken) {
    cookieParts.push(`refresh_token=${refreshToken}`)
  }
  if (cookieParts.length) {
    headers.Cookie = cookieParts.join('; ')
  }
  return headers
}
