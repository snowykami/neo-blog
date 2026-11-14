'use client'

import { ArrowUpRightIcon } from 'lucide-react'
import { isSafeHref } from '@/components/content-components/safe-url'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface LinkButtonContentProps {
  text: string
  href: string
  variant: 'default' | 'secondary' | 'outline'
  align: 'left' | 'center'
  newTab: boolean
}

/** 链接按钮：站内路径或外链 */
export default function LinkButtonContent({ text = '', href = '', variant = 'default', align = 'left', newTab = true }: LinkButtonContentProps) {
  if (!isSafeHref(href, true))
    throw new Error('Unsafe linkButton href')
  return (
    <div className={cn('flex', align === 'center' && 'justify-center')}>
      <Button asChild variant={variant}>
        <a href={href} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {text}
          {newTab && <ArrowUpRightIcon />}
        </a>
      </Button>
    </div>
  )
}
