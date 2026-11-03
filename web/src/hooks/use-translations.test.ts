import type { AbstractIntlMessages } from 'next-intl'
import { AxiosError, AxiosHeaders } from 'axios'
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '@/locales/en.json'
import zh from '@/locales/zh.json'
import { formatApiError } from './use-translations'

type Translator = Parameters<typeof formatApiError>[0]

// 模拟后端返回的错误响应
function apiError(status: number, error: Record<string, unknown>) {
  const response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: { status, message: error.code, data: null, error } }
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, response)
}

describe('请求错误的提示文案', () => {
  // 测试用的翻译函数与组件中的同构，只是类型推断不同
  const zhT = createTranslator({ locale: 'zh', messages: zh as AbstractIntlMessages, namespace: 'Response' }) as unknown as Translator
  const enT = createTranslator({ locale: 'en', messages: en as AbstractIntlMessages, namespace: 'Response' }) as unknown as Translator

  it('指明了资源与字段时说清楚是什么重复了', () => {
    const err = apiError(409, { reason: 'already_exists', code: 'slug_already_exists', resource: 'label', field: 'slug', value: 'aigc' })
    expect(formatApiError(zhT, err)).toBe('标签的Slug「aigc」已被使用')
    expect(formatApiError(enT, err)).toBe('The label slug "aigc" is already in use')
  })

  it('通用错误码带上资源名，没有资源时用原来的文案', () => {
    expect(formatApiError(zhT, apiError(404, { reason: 'not_found', code: 'target_not_found', resource: 'label' }))).toBe('标签不存在')
    expect(formatApiError(zhT, apiError(500, { reason: 'internal', code: 'failed_to_create_target', resource: 'category' }))).toBe('创建分类失败')
    expect(formatApiError(zhT, apiError(404, { reason: 'not_found', code: 'target_not_found' }))).toBe('目标未找到')
    expect(formatApiError(zhT, apiError(401, { reason: 'unauthenticated', code: 'invalid_credentials' }))).toBe('用户名或密码错误')
  })

  it('没有对应文案时按错误原因显示通用提示，并附上补充说明', () => {
    expect(formatApiError(zhT, apiError(500, { reason: 'internal', code: 'something_new' }))).toBe('服务器出错了，请稍后再试')
    expect(formatApiError(enT, apiError(409, { reason: 'conflict', code: 'something_new', detail: 'v2' }))).toBe('This conflicts with the current state, refresh and try again (v2)')
  })

  it('非后端错误（如网络错误）显示原始信息或 fallback', () => {
    expect(formatApiError(zhT, new Error('Network Error'))).toBe('Network Error')
    expect(formatApiError(zhT, null, '保存失败')).toBe('保存失败')
  })
})
