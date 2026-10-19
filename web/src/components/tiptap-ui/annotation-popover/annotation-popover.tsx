'use client'

import { MessageSquareQuoteIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { ANNOTATION_MARK } from '@/components/tiptap-extension/annotation-constants'
import { CornerDownLeftIcon } from '@/components/tiptap-icons/corner-down-left-icon'
import { TrashIcon } from '@/components/tiptap-icons/trash-icon'
import { Button, ButtonGroup } from '@/components/tiptap-ui-primitive/button'
import { Card, CardBody } from '@/components/tiptap-ui-primitive/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/tiptap-ui-primitive/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

/**
 * 注释按钮：选中词语后添加注释，可选“自动匹配文中相同词语”
 */
export function AnnotationPopover() {
  const { editor } = useTiptapEditor()
  const t = useTranslations('Console.post_edit')
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [autoMatch, setAutoMatch] = React.useState(false)
  const [state, setState] = React.useState({ isActive: false, canSet: false })

  React.useEffect(() => {
    if (!editor)
      return
    const sync = () => {
      const isActive = editor.isActive(ANNOTATION_MARK)
      setState({ isActive, canSet: editor.isEditable && (isActive || !editor.state.selection.empty) })
    }
    sync()
    editor.on('selectionUpdate', sync)
    editor.on('transaction', sync)
    return () => {
      editor.off('selectionUpdate', sync)
      editor.off('transaction', sync)
    }
  }, [editor])

  const handleOpenChange = (nextOpen: boolean) => {
    // 打开时回填当前注释
    if (nextOpen && editor) {
      const attrs = editor.getAttributes(ANNOTATION_MARK)
      setNote(attrs.note ?? '')
      setAutoMatch(!!attrs.autoMatch)
    }
    setOpen(nextOpen)
  }

  const applyAnnotation = () => {
    if (!editor || !note.trim())
      return
    editor.chain().focus().extendMarkRange(ANNOTATION_MARK).setMark(ANNOTATION_MARK, { note: note.trim(), autoMatch }).run()
    setOpen(false)
  }

  const removeAnnotation = () => {
    editor?.chain().focus().extendMarkRange(ANNOTATION_MARK).unsetMark(ANNOTATION_MARK).run()
    setOpen(false)
  }

  const handleAutoMatchChange = (checked: boolean) => {
    setAutoMatch(checked)
    // 已有注释时勾选立即生效，无需再点应用
    if (editor && state.isActive)
      editor.chain().extendMarkRange(ANNOTATION_MARK).updateAttributes(ANNOTATION_MARK, { autoMatch: checked }).run()
  }

  if (!editor)
    return null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          data-active-state={state.isActive ? 'on' : 'off'}
          disabled={!state.canSet}
          data-disabled={!state.canSet}
          aria-label={t('annotation')}
          aria-pressed={state.isActive}
          tooltip={t('annotation')}
        >
          <MessageSquareQuoteIcon className="tiptap-button-icon" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <Card>
          <CardBody>
            <div className="grid gap-3 w-72">
              <Textarea
                value={note}
                placeholder={t('annotation_placeholder')}
                onChange={e => setNote(e.target.value)}
                onKeyDown={(e) => {
                  // Ctrl/Cmd + Enter 应用，普通 Enter 换行
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    applyAnnotation()
                  }
                }}
                autoFocus
                rows={3}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="annotation-auto-match"
                    checked={autoMatch}
                    onCheckedChange={checked => handleAutoMatchChange(checked === true)}
                  />
                  <Label htmlFor="annotation-auto-match" className="text-xs font-normal">{t('auto_match')}</Label>
                </div>
                <ButtonGroup orientation="horizontal">
                  <Button type="button" data-style="ghost" title={t('annotation_apply')} disabled={!note.trim()} onClick={applyAnnotation}>
                    <CornerDownLeftIcon className="tiptap-button-icon" />
                  </Button>
                  <Button type="button" data-style="ghost" title={t('annotation_remove')} disabled={!state.isActive} onClick={removeAnnotation}>
                    <TrashIcon className="tiptap-button-icon" />
                  </Button>
                </ButtonGroup>
              </div>
            </div>
          </CardBody>
        </Card>
      </PopoverContent>
    </Popover>
  )
}
