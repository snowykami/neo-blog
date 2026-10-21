'use client'

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import GlobalPage from './global'

// 原始键值编辑器：默认折叠，供需要直接编辑配置键的高级场景使用
export function AdvancedKvEditor() {
  const t = useTranslations('Console.global')
  const [open, setOpen] = useState(false)
  return (
    <div className="grid gap-3">
      <Button type="button" variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => setOpen(!open)}>
        {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        {t('advanced')}
      </Button>
      {open && (
        <>
          <p className="text-sm text-muted-foreground">{t('advanced_desc')}</p>
          <GlobalPage />
        </>
      )}
    </div>
  )
}
