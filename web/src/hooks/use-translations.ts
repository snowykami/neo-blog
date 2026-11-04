import type { ApiErrorBody } from '@/utils/common/error'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import { getErrorBody, getErrorMessage } from '@/utils/common/error'

export const useResponseErrorDetailsT = () => useTranslations('Response.error_details')

export const useCommonT = () => useTranslations('Common')

export const useOperationT = () => useTranslations('Operation')

/** 将请求错误转换为可读文案，规则见 formatApiError */
export function useErrorMessageT() {
  const t = useTranslations('Response')
  return useCallback((error: unknown, fallback = '') => formatApiError(t, error, fallback), [t])
}

/** 将后端错误详情转换为可读文案，用于批量接口逐项返回的错误，规则见 formatErrorBody */
export function useErrorBodyT() {
  const t = useTranslations('Response')
  return useCallback((body: ApiErrorBody, fallback = '') => formatErrorBody(t, body, fallback), [t])
}

interface ResponseTranslator {
  (key: string, values?: Record<string, string>): string
  has: (key: string) => boolean
}

/**
 * 将请求错误转换为可读文案（t 为 Response 命名空间的翻译函数）：
 * 1. 后端指明了出错的资源 / 字段时用带参数的文案（如「标签的 Slug「aigc」已被使用」）：先找错误码的模板，再找错误原因的模板
 * 2. 否则用错误码对应的文案（Response.error_details），再退回到错误原因的通用文案
 * 3. 都没有时显示后端的补充说明、fallback 或原始信息（如网络错误）
 */
export function formatApiError(t: ResponseTranslator, error: unknown, fallback = ''): string {
  const body = getErrorBody(error)
  if (!body) {
    const message = getErrorMessage(error, fallback)
    return message && t.has(`error_details.${message}`) ? t(`error_details.${message}`) : message
  }
  return formatErrorBody(t, body, fallback)
}

/** 按后端错误详情生成文案，规则见 formatApiError 的 1、2 与补充说明部分 */
export function formatErrorBody(t: ResponseTranslator, body: ApiErrorBody, fallback = ''): string {
  const name = (group: string, key?: string) => (key && t.has(`${group}.${key}`) ? t(`${group}.${key}`) : key)
  const params = {
    scope: body.field ? 'field' : body.resource ? 'resource' : 'none',
    resource: name('resources', body.resource) ?? t('resources.default'),
    field: name('fields', body.field) ?? '',
    value: body.value == null ? '' : String(body.value),
  }
  const structured = params.scope !== 'none'
  let message: string | undefined
  if (structured && t.has(`error_templates.${body.code}`))
    message = t(`error_templates.${body.code}`, params)
  else if (structured && t.has(`reasons.${body.reason}`))
    message = t(`reasons.${body.reason}`, params)
  else if (t.has(`error_details.${body.code}`))
    message = t(`error_details.${body.code}`)
  else if (t.has(`reasons.${body.reason}`))
    message = t(`reasons.${body.reason}`, params)
  if (!message)
    return body.detail || fallback || body.code
  return body.detail ? t('with_detail', { message, detail: body.detail }) : message
}
