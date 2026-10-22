'use client'

import type { Editor } from '@tiptap/react'
import { posToDOMRect } from '@tiptap/react'
import { ExternalLinkIcon, LinkIcon, UnlinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { sanitizeUrl } from '@/lib/tiptap-utils'

// 浮层标记：焦点位于带此属性的元素内时，气泡菜单不会因编辑器失焦而隐藏
export const EDITOR_FLOATING_ATTR = 'data-editor-floating'

/** 当前选区的虚拟锚点，供弹层定位到选中文字下方 */
export function useSelectionAnchor(editor: Editor | null) {
  return React.useMemo(() => ({
    current: {
      getBoundingClientRect: () => {
        if (!editor || editor.isDestroyed)
          return new DOMRect()
        const { from, to } = editor.state.selection
        return posToDOMRect(editor.view, from, to)
      },
    },
  }), [editor])
}

/** 补全协议：example.com → https://example.com；站内路径、锚点与 mailto 等保持原样 */
export function normalizeLinkUrl(value: string) {
  const url = value.trim()
  if (!url)
    return ''
  if (/^(?:[a-z][a-z\d+\-.]*:|[/#?])/i.test(url))
    return url
  return `https://${url}`
}

export interface LinkPopoverProps {
  editor: Editor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 链接编辑弹层：定位到当前选区，回车应用；支持在新标签页打开、取消链接与“自动匹配文中相同词语”
 * 由工具栏、气泡菜单、溢出菜单与 Mod-k 快捷键共同打开
 */
export function LinkPopover({ editor, open, onOpenChange }: LinkPopoverProps) {
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  const anchor = useSelectionAnchor(editor)
  const [url, setUrl] = React.useState('')
  const [autoMatch, setAutoMatch] = React.useState(false)
  const [hasLink, setHasLink] = React.useState(false)
  const [emptySelection, setEmptySelection] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 打开时扩展到整个链接并回填地址
  React.useEffect(() => {
    if (!open || !editor)
      return
    const active = editor.isActive('link')
    if (active)
      editor.chain().extendMarkRange('link').run()
    const attrs = editor.getAttributes('link')
    setHasLink(active)
    setUrl(attrs.href ?? '')
    setAutoMatch(!!attrs.autoMatch)
    setEmptySelection(editor.state.selection.empty)
  }, [open, editor])

  if (!editor)
    return null

  const close = () => onOpenChange(false)

  const apply = () => {
    const href = normalizeLinkUrl(url)
    const chain = editor.chain().focus()
    if (!href) {
      chain.extendMarkRange('link').unsetLink().setMeta('preventAutolink', true).run()
    }
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      // 未选中文字时插入链接地址本身
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href, autoMatch } }] }).run()
    }
    else {
      chain.extendMarkRange('link').setLink({ href }).updateAttributes('link', { autoMatch }).run()
    }
    close()
  }

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().setMeta('preventAutolink', true).run()
    close()
  }

  const openLink = () => {
    const safeUrl = sanitizeUrl(normalizeLinkUrl(url), window.location.href)
    if (safeUrl !== '#')
      window.open(safeUrl, '_blank', 'noopener,noreferrer')
  }

  const handleAutoMatchChange = (checked: boolean) => {
    setAutoMatch(checked)
    // 已有链接时勾选立即生效，无需再点应用
    if (hasLink)
      editor.chain().extendMarkRange('link').updateAttributes('link', { autoMatch: checked }).run()
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
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          editor.commands.focus()
        }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
          <LinkIcon className="size-4" />
          <span>{hasLink ? t('link_edit') : t('link_add')}</span>
        </div>
        <Input
          ref={inputRef}
          type="url"
          value={url}
          placeholder={t('link_placeholder')}
          aria-label={t('link_url')}
          spellCheck={false}
          autoComplete="off"
          onChange={e => setUrl(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              apply()
            }
          }}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="editor-link-auto-match"
            checked={autoMatch}
            onCheckedChange={checked => handleAutoMatchChange(checked === true)}
          />
          <Label htmlFor="editor-link-auto-match" className="text-xs font-normal text-muted-foreground">{postEditT('auto_match')}</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {emptySelection && !hasLink ? t('link_hint_insert') : t('link_hint_apply')}
          </span>
          <span className="flex-1" />
          {hasLink && (
            <>
              <Button type="button" size="icon" variant="ghost" className="size-8" title={t('link_open')} aria-label={t('link_open')} onClick={openLink}>
                <ExternalLinkIcon />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" title={t('link_remove')} aria-label={t('link_remove')} onClick={removeLink}>
                <UnlinkIcon />
              </Button>
            </>
          )}
          <Button type="button" size="sm" onClick={apply}>{t('apply')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default LinkPopover
