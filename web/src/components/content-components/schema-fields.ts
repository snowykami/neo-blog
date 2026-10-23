import type { ContentFieldMeta } from './types'
import { z } from 'zod'

/**
 * 从组件的 zod schema 推导表单字段：按字段类型选择控件，.meta({ widget }) 可指定多行文本 / 代码 / 日期时间
 * 只支持组件 props 用到的类型：字符串、枚举、数字、布尔、对象数组
 */

export type FieldDescriptor
  = | { kind: 'text' | 'textarea' | 'code' | 'datetime', name: string }
    | { kind: 'select', name: string, options: string[] }
    // allowZero：0 是否为合法值；不合法时 0 视为未填写，输入框显示为空；integer：是否只允许整数
    | { kind: 'number', name: string, allowZero: boolean, integer: boolean, min?: number, max?: number }
    | { kind: 'switch', name: string }
    | { kind: 'list', name: string, fields: FieldDescriptor[], itemDefault: Record<string, unknown>, min: number, max: number }

// 去掉 default / optional 包装，同时收集各层的 meta
function unwrap(schema: z.ZodType): { inner: z.ZodType, meta: ContentFieldMeta } {
  let current = schema
  let meta: ContentFieldMeta = {}
  for (;;) {
    meta = { ...(current.meta() as ContentFieldMeta | undefined), ...meta }
    if (current instanceof z.ZodDefault || current instanceof z.ZodOptional)
      current = current.unwrap() as z.ZodType
    else
      return { inner: current, meta }
  }
}

// 数组长度限制：读取 .min() / .max() 的检查定义
function arrayLength(schema: z.ZodArray): { min: number, max: number } {
  let min = 0
  let max = Infinity
  for (const check of schema.def.checks ?? []) {
    const def = check._zod.def as { check: string, minimum?: number, maximum?: number }
    if (def.check === 'min_length' && def.minimum != null)
      min = def.minimum
    if (def.check === 'max_length' && def.maximum != null)
      max = def.maximum
  }
  return { min, max }
}

function describeField(name: string, schema: z.ZodType): FieldDescriptor | null {
  const { inner, meta } = unwrap(schema)
  if (inner instanceof z.ZodString)
    return { kind: meta.widget ?? 'text', name }
  if (inner instanceof z.ZodEnum)
    return { kind: 'select', name, options: inner.options.map(String) }
  if (inner instanceof z.ZodNumber) {
    const finite = (value: number | null) => (value != null && Number.isFinite(value) ? value : undefined)
    return { kind: 'number', name, allowZero: inner.safeParse(0).success, integer: !!inner.isInt, min: finite(inner.minValue), max: finite(inner.maxValue) }
  }
  if (inner instanceof z.ZodBoolean)
    return { kind: 'switch', name }
  if (inner instanceof z.ZodArray && inner.element instanceof z.ZodObject) {
    const element = inner.element as z.ZodObject
    return {
      kind: 'list',
      name,
      fields: describeFields(element),
      itemDefault: element.parse({}) as Record<string, unknown>,
      ...arrayLength(inner),
    }
  }
  return null
}

export function describeFields(schema: z.ZodObject): FieldDescriptor[] {
  return Object.entries(schema.shape)
    .map(([name, field]) => describeField(name, field as z.ZodType))
    .filter((field): field is FieldDescriptor => field != null)
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** 校验提示：按 zod issue 类型取 ContentComponents.validation 下的文案 */
export function createIssueMessage(t: Translate) {
  return (issue: z.core.$ZodRawIssue): string => {
    const origin = 'origin' in issue ? issue.origin : undefined
    if (issue.code === 'too_small') {
      const minimum = Number(issue.minimum)
      if (origin === 'string')
        return minimum <= 1 ? t('validation.required') : t('validation.too_short', { minimum })
      if (origin === 'array')
        return t('validation.too_few', { minimum })
      return t('validation.out_of_range')
    }
    if (issue.code === 'too_big') {
      const maximum = Number(issue.maximum)
      if (origin === 'string')
        return t('validation.too_long', { maximum })
      if (origin === 'array')
        return t('validation.too_many', { maximum })
      return t('validation.out_of_range')
    }
    return t('validation.invalid')
  }
}
