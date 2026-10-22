'use client'

import type { Editor } from '@tiptap/react'
import { SeparatorHorizontalIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/tiptap-ui-primitive/button'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

// 插入分割线按钮，依赖 HorizontalRule 扩展
export function HorizontalRuleButton({ editor: providedEditor }: { editor?: Editor | null }) {
  const t = useTranslations('Console.post_edit')
  const { editor } = useTiptapEditor(providedEditor)
  const canInsert = !!editor?.isEditable && editor.can().setHorizontalRule()
  const label = t('horizontal_rule')

  return (
    <Button
      type="button"
      data-style="ghost"
      role="button"
      tabIndex={-1}
      disabled={!canInsert}
      data-disabled={!canInsert}
      aria-label={label}
      tooltip={label}
      onClick={() => editor?.chain().focus().setHorizontalRule().run()}
    >
      <SeparatorHorizontalIcon className="tiptap-button-icon" />
    </Button>
  )
}
