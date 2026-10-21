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
  return (
    <footer
      style={{ height }}
      className="w-full py-6 px-10 flex flex-col md:flex-row gap-1 md:gap-0 items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700"
    >
      <span>
        ©
        {' '}
        {new Date().getFullYear()}
        {' '}
        {siteInfo?.metadata?.name}
      </span>
      <span className="hidden md:inline mx-1">·</span>
      <span>
        Powered by
        {' '}
        <Link href="https://github.com/snowykami/neo-blog" target="_blank" className="underline hover:text-gray-700 dark:hover:text-gray-300">Neo Blog</Link>
      </span>
      <span className="hidden md:inline mx-1">·</span>
      <span>{siteInfo?.footer?.text}</span>
      <span className="hidden md:inline mx-1">·</span>
      <Link href={mainPath.privacy} className="underline hover:text-gray-700 dark:hover:text-gray-300">{routeT('privacy_policy')}</Link>
    </footer>
  )
}
