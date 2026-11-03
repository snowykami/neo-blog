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

/** 后端错误详情（见后端 pkg/errs.Body）：reason 为错误原因枚举，code 为具体错误码，其余字段可选 */
export interface ApiErrorBody {
  reason: string
  code: string
  resource?: string // 出错的资源类型，如 label
  field?: string // 出错的字段，如 slug
  value?: unknown // 用户提交的值
  detail?: string // 可以公开的补充说明
}

/**
 * 取出后端返回的错误详情；非后端错误（如网络错误）返回 undefined
 */
export function getErrorBody(error: unknown): ApiErrorBody | undefined {
  if (!isAxiosError(error))
    return undefined
  const body = (error.response?.data as { error?: unknown } | undefined)?.error
  if (body && typeof body === 'object' && typeof (body as ApiErrorBody).code === 'string')
    return body as ApiErrorBody
  return undefined
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
