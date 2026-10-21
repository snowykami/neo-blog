import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import { getErrorMessage } from '@/utils/common/error'

export const useResponseErrorDetailsT = () => useTranslations('Response.error_details')

export const useCommonT = () => useTranslations('Common')

export const useOperationT = () => useTranslations('Operation')

/**
 * 将请求错误转换为可读文案：后端 message 若在 Response.error_details 中有翻译则使用翻译，否则原样返回（如网络错误）
 */
export function useErrorMessageT() {
  const errorDetailsT = useTranslations('Response.error_details')
  return useCallback((error: unknown, fallback = '') => {
    const message = getErrorMessage(error, fallback)
    return message && errorDetailsT.has(message) ? errorDetailsT(message) : message
  }, [errorDetailsT])
}
