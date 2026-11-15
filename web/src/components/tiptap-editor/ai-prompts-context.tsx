'use client'

import type { AIPrompt } from '@/models/ai-prompt'
import type { AIWriteMode } from '@/models/ai-write'
import { PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { listAIPrompts } from '@/api/ai-prompt'
import { Button } from '@/components/ui/button'

const AIPromptManagerDialog = dynamic(
  () => import('./ai-prompt-manager-dialog').then(m => m.AIPromptManagerDialog),
  { ssr: false },
)

interface AIPromptsContextValue {
  prompts: AIPrompt[]
  loaded: boolean
  reload: () => Promise<void>
  // 打开指令管理弹窗；弹窗挂在 Provider 中，从下拉菜单打开时不会随菜单关闭而卸载
  openManager: (mode: AIWriteMode) => void
}

const AIPromptsContext = React.createContext<AIPromptsContextValue>({
  prompts: [],
  loaded: false,
  reload: async () => {},
  openManager: () => {},
})

/** 编辑器内共享的 AI 指令列表（平台指令 + 个人指令）与指令管理弹窗 */
export function AIPromptsProvider({ children }: { children: React.ReactNode }) {
  const [prompts, setPrompts] = React.useState<AIPrompt[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [managerMode, setManagerMode] = React.useState<AIWriteMode | null>(null)

  const reload = React.useCallback(async () => {
    try {
      const res = await listAIPrompts()
      setPrompts(res.data ?? [])
    }
    catch {
      // 加载失败时保留已有列表，自定义指令仍可使用
    }
    finally {
      setLoaded(true)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const value = React.useMemo(() => ({ prompts, loaded, reload, openManager: setManagerMode }), [prompts, loaded, reload])

  return (
    <AIPromptsContext.Provider value={value}>
      {children}
      {managerMode !== null && (
        <AIPromptManagerDialog
          open
          mode={managerMode}
          prompts={prompts}
          onOpenChange={open => !open && setManagerMode(null)}
          onChanged={reload}
        />
      )}
    </AIPromptsContext.Provider>
  )
}

/** 打开指令管理弹窗的小图标按钮（用于下拉菜单标题行等） */
export function AIPromptManageButton({ onClick, className }: { onClick: () => void, className?: string }) {
  const t = useTranslations('Console.editor.ai')
  return (
    <Button type="button" size="icon-sm" variant="ghost" className={className} aria-label={t('manage.title')} title={t('manage.title')} onClick={onClick}>
      <PencilIcon />
    </Button>
  )
}

/** 指定模式（帮写 / 润色）下可用的指令；不传 mode 时返回全部 */
export function useAIPrompts(mode?: AIWriteMode) {
  const context = React.useContext(AIPromptsContext)
  const prompts = React.useMemo(() => (mode ? context.prompts.filter(prompt => prompt.mode === mode) : context.prompts), [context.prompts, mode])
  return { ...context, prompts }
}
