import { isAxiosError } from 'axios'

/**
 * 从请求错误中提取可读的错误信息
 * 优先取后端返回的 message，其次取 Error.message，最后使用 fallback
 */
export function getErrorMessage(error: unknown, fallback = ''): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown } | undefined
    if (data && typeof data.message === 'string' && data.message)
      return data.message
  }
  if (error instanceof Error && error.message)
    return error.message
  if (typeof error === 'string' && error)
    return error
  return fallback
}

/**
 * 获取请求错误的 HTTP 状态码，非 HTTP 错误返回 undefined
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (isAxiosError(error))
    return error.response?.status
  return undefined
}

/**
 * 是否为“资源不存在”类错误（400 参数非法 / 403 无权查看 / 404 不存在），用于决定是否渲染 404 页
 */
export function isNotFoundLikeError(error: unknown): boolean {
  const status = getErrorStatus(error)
  return status === 400 || status === 403 || status === 404
}
