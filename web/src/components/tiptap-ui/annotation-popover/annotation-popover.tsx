'use client'

import type { Editor } from '@tiptap/react'
import { MessageSquareTextIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { formatShortcut } from '@/components/tiptap-editor/editor-commands'
import { ANNOTATION_MARK } from '@/components/tiptap-extension/annotation-constants'
import { EDITOR_FLOATING_ATTR, useSelectionAnchor } from '@/components/tiptap-ui/link-popover/link-popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'

export interface AnnotationPopoverProps {
  editor: Editor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 注释编辑弹层：选中词语后添加注释，可选“自动匹配文中相同词语”；Ctrl/⌘ + Enter 应用
 * 定位到当前选区，由工具栏、气泡菜单、溢出菜单与 Mod-Alt-m 快捷键共同打开
 */
export function AnnotationPopover({ editor, open, onOpenChange }: AnnotationPopoverProps) {
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  const anchor = useSelectionAnchor(editor)
  const [note, setNote] = React.useState('')
  const [autoMatch, setAutoMatch] = React.useState(false)
  const [isActive, setIsActive] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // 打开时扩展到整个注释并回填内容
  React.useEffect(() => {
    if (!open || !editor)
      return
    const active = editor.isActive(ANNOTATION_MARK)
    if (active)
      editor.chain().extendMarkRange(ANNOTATION_MARK).run()
    const attrs = editor.getAttributes(ANNOTATION_MARK)
    setIsActive(active)
    setNote(attrs.note ?? '')
    setAutoMatch(!!attrs.autoMatch)
  }, [open, editor])

  if (!editor)
    return null

  const close = () => onOpenChange(false)

  const apply = () => {
    if (!note.trim())
      return
    editor.chain().focus().extendMarkRange(ANNOTATION_MARK).setMark(ANNOTATION_MARK, { note: note.trim(), autoMatch }).run()
    close()
  }

  const remove = () => {
    editor.chain().focus().extendMarkRange(ANNOTATION_MARK).unsetMark(ANNOTATION_MARK).run()
    close()
  }

  const handleAutoMatchChange = (checked: boolean) => {
    setAutoMatch(checked)
    // 已有注释时勾选立即生效，无需再点应用
    if (isActive)
      editor.chain().extendMarkRange(ANNOTATION_MARK).updateAttributes(ANNOTATION_MARK, { autoMatch: checked }).run()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        {...{ [EDITOR_FLOATING_ATTR]: '' }}
        align="start"
        sideOffset={8}
        className="grid w-[340px] max-w-[calc(100vw-1rem)] gap-3 rounded-xl p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const el = textareaRef.current
          if (el) {
            el.focus()
            el.setSelectionRange(el.value.length, el.value.length)
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          editor.commands.focus()
        }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
          <MessageSquareTextIcon className="size-4" />
          <span>{isActive ? t('annotation_edit') : t('annotation_add')}</span>
        </div>
        <Textarea
          ref={textareaRef}
          value={note}
          rows={3}
          placeholder={postEditT('annotation_placeholder')}
          aria-label={postEditT('annotation')}
          onChange={e => setNote(e.target.value)}
          onKeyDown={(event) => {
            // Ctrl/Cmd + Enter 应用，普通 Enter 换行
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              apply()
            }
          }}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="editor-annotation-auto-match"
            checked={autoMatch}
            onCheckedChange={checked => handleAutoMatchChange(checked === true)}
          />
          <Label htmlFor="editor-annotation-auto-match" className="text-xs font-normal text-muted-foreground">{postEditT('auto_match')}</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('annotation_hint', { shortcut: formatShortcut('mod+enter') })}</span>
          <span className="flex-1" />
          {isActive && (
            <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove}>
              <Trash2Icon />
              {postEditT('annotation_remove')}
            </Button>
          )}
          <Button type="button" size="sm" disabled={!note.trim()} onClick={apply}>{postEditT('annotation_apply')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
