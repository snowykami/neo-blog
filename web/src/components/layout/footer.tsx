'use client'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { useSiteInfo } from '@/contexts/site-info-context'
import { Link } from '@/i18n/navigation'
import { mainPath } from '@/utils/common/route'

// 手机上链接上下各加 4px 内边距（行内的「Neo Blog」改为行内块，内边距才算进排版），热区到 28px，不易点偏（桌面端不变）
const footerLinkClass = 'rounded-sm underline decoration-dashed underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:inline-block max-sm:py-1'

const subscribeNever = () => () => {}
const currentYear = () => new Date().getFullYear()
// 服务端渲染不取当前日期（页面对所有人、任何时候都一致）：年份在浏览器里补上，水合阶段先不显示
const serverYear = () => null

export default function Footer() {
  const { siteInfo } = useSiteInfo()
  const year = useSyncExternalStore(subscribeNever, currentYear, serverYear)
  const routeT = useTranslations('Route')
  if (!siteInfo)
    return null
  const footerText = siteInfo.footer?.text?.trim()
  const footerLinks = (siteInfo.footer?.links ?? []).filter(link => link.text && link.href)
  return (
    <footer className="mx-auto w-full max-w-[var(--page-w)] px-4 pb-10">
      {/* 虚线分隔，与正文区隔开 */}
      <div className="mx-auto mb-8 w-full max-w-2xl border-t border-dashed border-foreground/10" />
      {/* 各段之间用间距分隔，不再用「·」拼接 */}
      <div className="flex flex-col items-center gap-2 text-center text-sm text-foreground/50">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span>
            ©
            {' '}
            {year !== null && `${year} `}
            {siteInfo?.metadata?.name}
          </span>
          <span>
            Powered by
            {' '}
            <Link href="https://github.com/snowykami/neo-blog" target="_blank" rel="noopener noreferrer" className={footerLinkClass}>Neo Blog</Link>
          </span>
          {footerText && <span>{footerText}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {footerLinks.map((link, index) => {
            const external = /^https?:\/\//.test(link.href)
            return (
              <Link
                key={`link-${index}`}
                href={link.href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                className={footerLinkClass}
              >
                {link.text}
              </Link>
            )
          })}
          {/* RSS 是接口不是页面，预取只会白白让服务端生成一遍订阅内容 */}
          <Link href={mainPath.feed} prefetch={false} className={footerLinkClass}>RSS</Link>
          <Link href={mainPath.privacy} className={footerLinkClass}>{routeT('privacy_policy')}</Link>
          <LocaleSwitcher className={footerLinkClass} />
        </div>
      </div>
    </footer>
  )
}
