'use client'

import type { LinkButtonContentProps } from './button.content'
import { ArrowUpRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 链接按钮：站内路径或外链 */
export default function LinkButtonContent({ text, href, variant, align, newTab }: LinkButtonContentProps) {
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
