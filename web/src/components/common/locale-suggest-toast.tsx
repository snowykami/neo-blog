'use client'

import { useLocale } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { readLocaleCookie, switchLocale } from '@/i18n/locale-cookie'
import { usePathname } from '@/i18n/navigation'
import { isConsolePath } from '@/i18n/routing'
import { DEFAULT_LOCALE, resolveLocale } from '@/locales/registry'

const TOAST_ID = 'locale-suggest'
const DISMISSED_KEY = 'locale_suggest_dismissed'
const SESSION_SEEN_KEY = 'locale_suggest_seen'
const TOAST_DURATION_MS = 10_000

interface LocalePrompt {
  title: string
  description: string
  action: string
}

// 直接内联极简目标语言文案，避免为了提示加载额外语言包（按目标语言显示）
const LOCALE_PROMPTS: Record<string, LocalePrompt> = {
  'en': {
    title: 'Switch to English?',
    description: 'This site is also available in English.',
    action: 'Switch',
  },
  'ja': {
    title: '日本語に切り替えますか？',
    description: 'このサイトは日本語でも表示できます。',
    action: '切り替える',
  },
  'ko': {
    title: '한국어로 전환할까요?',
    description: '이 사이트는 한국어로도 볼 수 있습니다.',
    action: '전환',
  },
  'zh-CN': {
    title: '切换为简体中文？',
    description: '当前页面支持简体中文显示。',
    action: '切换',
  },
  'zh-HK': {
    title: '切換為繁體中文？',
    description: '此頁面支援繁體中文顯示。',
    action: '切換',
  },
}

/** 从浏览器语言偏好解析最匹配的支持语言；浏览器有语言但均不支持时回退英文 */
export function detectBrowserTargetLocale(languages: readonly string[] | undefined): string | undefined {
  if (!languages?.length)
    return undefined
  let hasTag = false
  for (const tag of languages) {
    if (!tag.trim())
      continue
    hasTag = true
    const matched = resolveLocale(tag)
    if (matched)
      return matched
  }
  return hasTag ? DEFAULT_LOCALE : undefined
}

function readStorage(storage: Storage, key: string): boolean {
  try {
    return storage.getItem(key) === '1'
  }
  catch {
    return false
  }
}

function writeStorage(storage: Storage, key: string) {
  try {
    storage.setItem(key, '1')
  }
  catch {}
}

/**
 * 首屏空闲后检查浏览器语言偏好与当前页面语言是否一致：
 * 若不一致且访客未手动选过语言（无 NEXT_LOCALE Cookie）也未关闭过提示，则以目标语言弹出轻量 Toast 引导切换
 */
export function LocaleSuggestToast() {
  const currentLocale = useLocale()
  const pathname = usePathname()

  useEffect(() => {
    if (isConsolePath(pathname))
      return

    const evaluate = () => {
      if (resolveLocale(readLocaleCookie(document.cookie)))
        return
      if (readStorage(localStorage, DISMISSED_KEY) || readStorage(sessionStorage, SESSION_SEEN_KEY))
        return

      const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
      const target = detectBrowserTargetLocale(browserLanguages)
      if (!target || target === currentLocale)
        return

      const prompt = LOCALE_PROMPTS[target] ?? LOCALE_PROMPTS[DEFAULT_LOCALE]
      if (!prompt)
        return

      toast.info(prompt.title, {
        id: TOAST_ID,
        description: prompt.description,
        duration: TOAST_DURATION_MS,
        closeButton: true,
        action: {
          label: prompt.action,
          onClick: () => switchLocale(target),
        },
        onDismiss: () => writeStorage(localStorage, DISMISSED_KEY),
        onAutoClose: () => writeStorage(sessionStorage, SESSION_SEEN_KEY),
      })
    }

    // 推迟到浏览器空闲且 UserPreferenceSync 完成初始同步后再检查，不抢占首屏水合
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(evaluate, { timeout: 2500 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(evaluate, 1200)
    return () => window.clearTimeout(timer)
  }, [currentLocale, pathname])

  return null
}
