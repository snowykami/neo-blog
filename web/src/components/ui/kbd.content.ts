import { KeyboardIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { defineContentComponent } from '@/components/content-components/define'

export const shortcutContentSchema = z.object({
  // 按键以 + 分隔，例如 Ctrl+Shift+P
  keys: z.string().trim().min(1).max(60).default(''),
  description: z.string().trim().max(120).default(''),
})

export type ShortcutContentProps = z.output<typeof shortcutContentSchema>

export function splitKeys(keys: string): string[] {
  return keys.split('+').map(key => key.trim()).filter(Boolean)
}

export default defineContentComponent({
  name: 'shortcut',
  version: 1,
  schema: shortcutContentSchema,
  component: dynamic(() => import('./kbd.content-view')),
  icon: KeyboardIcon,
  keywords: ['kbd', 'key', 'shortcut', 'hotkey', 'kuaijiejian', 'kjj', 'anjian', '快捷键', '按键'],
  fallback: ({ keys, description }: ShortcutContentProps) => [[
    'p',
    {},
    ...splitKeys(keys).flatMap((key, index) => (index ? [' + ', ['kbd', {}, key]] : [['kbd', {}, key]])),
    ...(description ? [` ${description}`] : []),
  ]],
  example: t => ({ keys: 'Ctrl+K', description: t('description') }),
})
