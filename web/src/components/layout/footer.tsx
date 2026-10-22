'use client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import React from 'react'
import { useSiteInfo } from '@/contexts/site-info-context'
import { mainPath } from '@/utils/common/route'

export default function Footer({ height }: { height: number }) {
  const { siteInfo } = useSiteInfo()
  const routeT = useTranslations('Route')
  if (!siteInfo)
    return null
  const footerText = siteInfo.footer?.text?.trim()
  const footerLinks = (siteInfo.footer?.links ?? []).filter(link => link.text && link.href)
  // 各段之间用分隔点连接，空的段落不渲染，避免出现孤立的分隔符
  const segments: React.ReactNode[] = [
    <span key="copyright">
      ©
      {' '}
      {new Date().getFullYear()}
      {' '}
      {siteInfo?.metadata?.name}
    </span>,
    <span key="powered">
      Powered by
      {' '}
      <Link href="https://github.com/snowykami/neo-blog" target="_blank" className="underline hover:text-gray-700 dark:hover:text-gray-300">Neo Blog</Link>
    </span>,
    ...(footerText ? [<span key="text">{footerText}</span>] : []),
    ...footerLinks.map((link, index) => {
      const external = /^https?:\/\//.test(link.href)
      return (
        <Link
          key={`link-${index}`}
          href={link.href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="underline hover:text-gray-700 dark:hover:text-gray-300"
        >
          {link.text}
        </Link>
      )
    }),
    <Link key="privacy" href={mainPath.privacy} className="underline hover:text-gray-700 dark:hover:text-gray-300">{routeT('privacy_policy')}</Link>,
  ]
  return (
    <footer
      style={{ minHeight: height }}
      className="w-full py-6 px-10 flex flex-col md:flex-row flex-wrap gap-1 md:gap-0 items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700"
    >
      {segments.map((segment, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="hidden md:inline mx-1">·</span>}
          {segment}
        </React.Fragment>
      ))}
    </footer>
  )
}
