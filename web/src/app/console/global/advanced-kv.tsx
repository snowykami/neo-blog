'use client'

import { useTranslations } from 'next-intl'
import GlobalPage from './global'

// 原始键值编辑器：位于全局配置的「高级」Tab，供需要直接编辑配置键的场景使用
export function AdvancedKvEditor() {
  const t = useTranslations('Console.global')
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t('advanced_desc')}</p>
      <GlobalPage />
    </div>
  )
}
