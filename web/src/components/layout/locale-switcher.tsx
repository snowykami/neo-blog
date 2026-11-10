'use client'

import { LanguagesIcon } from 'lucide-react'
import { useLocale } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { switchLocale } from '@/i18n/locale-cookie'
import { LOCALES } from '@/locales/registry'

/**
 * 页脚的语言切换：跳到当前页面在目标语言下的地址（/p/x → /en/p/x），并记进语言 Cookie，
 * 之后打开不带前缀的地址时 proxy.ts 会跳到这种语言（见 i18n/locale-cookie.ts 的 switchLocale）。
 * 语言名用各语言自己的写法，不需要翻译
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className}>
        <LanguagesIcon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
        {LOCALES[locale]?.name ?? locale}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(next) => {
            if (next !== locale)
              switchLocale(next)
          }}
        >
          {Object.entries(LOCALES).map(([code, { name }]) => (
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
