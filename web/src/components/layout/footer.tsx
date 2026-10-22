'use client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useSiteInfo } from '@/contexts/site-info-context'
import { mainPath } from '@/utils/common/route'

const footerLinkClass = 'rounded-sm underline decoration-dashed underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function Footer() {
  const { siteInfo } = useSiteInfo()
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
            {new Date().getFullYear()}
            {' '}
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
          <Link href={mainPath.feed} className={footerLinkClass}>RSS</Link>
          <Link href={mainPath.privacy} className={footerLinkClass}>{routeT('privacy_policy')}</Link>
        </div>
      </div>
    </footer>
  )
}
