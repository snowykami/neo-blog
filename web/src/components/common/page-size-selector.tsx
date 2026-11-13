'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// 每页条数选择只在后台列表里用到，与分页组件分开放：前台首页等页面引用分页时不会把 Select（Radix Select）带进首屏包

const PAGE_SIZE_OPTIONS = [10, 15, 20, 30, 50, 100]

export function PageSizeSelector({
  size,
  onSizeChange,
  options = PAGE_SIZE_OPTIONS,
}: {
  /** 受控每页条数（推荐），通常来自 URL 状态 */
  size?: number
  onSizeChange: (size: number) => void
  /** 可选的每页条数列表 */
  options?: number[]
}) {
  const t = useTranslations('Components.pagination')
  const [innerSize, setInnerSize] = useState(10)
  const current = size ?? innerSize
  // 当前值不在候选列表中时（如移动端默认值）也要能正常显示
  const sizeList = options.includes(current)
    ? options
    : [...options, current].sort((a, b) => a - b)
  return (
    <Select
      value={String(current)}
      onValueChange={(value) => {
        const next = Number(value)
        if (size === undefined)
          setInnerSize(next)
        onSizeChange(next)
      }}
    >
      <SelectTrigger size="sm" className="w-auto" aria-label={t('page_size')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sizeList.map(item => (
          <SelectItem key={item} value={String(item)}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
