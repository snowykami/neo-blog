'use client'

import type { PhraseForm } from '@/lib/lyrics/annotation-edit'
import type { LyricColor, LyricTextStyle } from '@/lib/lyrics/types'
import { BoldIcon, ChevronDownIcon, ItalicIcon, PlusIcon, SlashIcon, Trash2Icon, UnderlineIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { EditorToolbarButton, EditorToolbarSeparator, toolbarButtonClass } from '@/components/tiptap-editor/editor-toolbar-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { LYRIC_COLOR_NAMES, LYRIC_EFFECT_CATEGORIES, LYRIC_FONTS, lyricEffectCategory } from '@/lib/lyrics/annotation-options'
import { LYRIC_COLORS } from '@/lib/lyrics/colors'
import { cn } from '@/lib/utils'

export type PhraseStyle = Omit<PhraseForm, 'text'>

const STYLE_ICONS: Record<LyricTextStyle, typeof BoldIcon> = { bold: BoldIcon, italic: ItalicIcon, underline: UnderlineIcon }
// 选择框的「无」：Radix 的选项值不能为空字符串
const NONE = 'none'
// 气泡离视口左右边缘的最小距离与上方的最小留白（不够时放到选区下方）
const EDGE_PX = 12
const TOP_GAP_PX = 64

/**
 * 选中歌词或点击已有短语时出现的气泡工具栏（外观沿用文章编辑器的气泡菜单）：特效（按类别分组）、颜色、字体、粗体 / 斜体 / 下划线、节奏。
 * add 模式下调整的是待添加的样式，点「添加特效」后生效；edit 模式下的修改立即作用于短语，并可删除
 */
export function PhraseToolbar({
  rect,
  mode,
  value,
  onChange,
  onAdd,
  onDelete,
  onClose,
}: {
  rect: DOMRect
  mode: 'add' | 'edit'
  value: PhraseStyle
  onChange: (value: PhraseStyle) => void
  onAdd?: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  const t = useTranslations('Console.lyric_effects')
  const optionT = useTranslations('LyricOptions')
  const ref = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState<React.CSSProperties>({ visibility: 'hidden' })

  // 放在选区上方居中，左右不超出视口；上方空间不够时放到下方
  React.useLayoutEffect(() => {
    const width = ref.current?.offsetWidth ?? 0
    const center = rect.left + rect.width / 2
    const left = Math.min(Math.max(center - width / 2, EDGE_PX), window.innerWidth - width - EDGE_PX)
    const below = rect.top < TOP_GAP_PX
    setPosition({ left, top: below ? rect.bottom + 8 : rect.top - 8, transform: below ? undefined : 'translateY(-100%)' })
  }, [rect, mode])

  const set = (patch: Partial<PhraseStyle>) => onChange({ ...value, ...patch })
  const toggleStyle = (style: LyricTextStyle) => set({
    styles: value.styles.includes(style) ? value.styles.filter(item => item !== style) : [...value.styles, style],
  })
  const category = lyricEffectCategory(value.effect)

  return createPortal(
    <div
      ref={ref}
      role="toolbar"
      aria-label={t('phrase_toolbar')}
      data-lyric-phrase-toolbar=""
      style={position}
      className="fixed z-50 flex max-w-[calc(100vw-1.5rem)] items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg hide-scrollbar"
    >
      {/* 特效：按类别分组 */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className={cn(toolbarButtonClass, 'px-2')} aria-label={t('effect')}>
          <span aria-hidden className="size-2 rounded-full" style={{ background: category.color }} />
          {optionT(`effects.${value.effect}`)}
          <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuRadioGroup value={value.effect} onValueChange={effect => set({ effect: effect as PhraseStyle['effect'] })}>
            {LYRIC_EFFECT_CATEGORIES.map((group, index) => (
              <React.Fragment key={group.key}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: group.color }} />
                  {optionT(`categories.${group.key}`)}
                </DropdownMenuLabel>
                {group.effects.map(effect => (
                  <DropdownMenuRadioItem key={effect} value={effect} className="grid gap-0.5">
                    <span>{optionT(`effects.${effect}`)}</span>
                    <span className="text-xs text-muted-foreground">{optionT(`effect_hints.${effect}`)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </React.Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditorToolbarSeparator className="mx-1" />

      {/* 颜色 */}
      <Popover>
        <PopoverTrigger className={toolbarButtonClass} aria-label={t('color')} title={value.color ? optionT(`colors.${value.color}`) : t('color_none')}>
          {value.color
            ? <span aria-hidden className="size-4 rounded-full border" style={{ background: LYRIC_COLORS[value.color] }} />
            : <SlashIcon aria-hidden className="size-4 opacity-60" />}
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-72 gap-2 p-3">
          <span className="text-xs text-muted-foreground">{t('color')}</span>
          <div className="grid grid-cols-8 gap-1.5">
            {LYRIC_COLOR_NAMES.map((color: LyricColor) => (
              <button
                key={color}
                type="button"
                title={optionT(`colors.${color}`)}
                aria-label={optionT(`colors.${color}`)}
                aria-pressed={value.color === color}
                onClick={() => set({ color })}
                className="size-6 rounded-full border outline-none ring-offset-2 ring-offset-popover transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary"
                style={{ background: LYRIC_COLORS[color] }}
              />
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" className="justify-self-start" disabled={!value.color} onClick={() => set({ color: '' })}>
            {t('color_none')}
          </Button>
        </PopoverContent>
      </Popover>

      {/* 字体 */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className={toolbarButtonClass} aria-label={t('phrase_font')}>
          {value.font ? optionT(`fonts.${value.font}`) : t('phrase_font_default')}
          <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={value.font || NONE} onValueChange={font => set({ font: font === NONE ? '' : font as PhraseStyle['font'] })}>
            <DropdownMenuRadioItem value={NONE}>{t('phrase_font_default')}</DropdownMenuRadioItem>
            {LYRIC_FONTS.map(font => (
              <DropdownMenuRadioItem key={font} value={font}>{optionT(`fonts.${font}`)}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditorToolbarSeparator className="mx-1" />

      {/* 字形 */}
      {(['bold', 'italic', 'underline'] as const).map((style) => {
        const Icon = STYLE_ICONS[style]
        return (
          <EditorToolbarButton key={style} label={optionT(`styles.${style}`)} active={value.styles.includes(style)} onClick={() => toggleStyle(style)}>
            <Icon />
          </EditorToolbarButton>
        )
      })}
      <EditorToolbarSeparator className="mx-1" />

      {/* 节奏 */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className={toolbarButtonClass} aria-label={t('phrase_pace')}>
          {value.pace ? optionT(`paces.${value.pace}`) : t('phrase_pace_default')}
          <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={value.pace || NONE} onValueChange={pace => set({ pace: pace === NONE ? '' : pace as PhraseStyle['pace'] })}>
            <DropdownMenuRadioItem value={NONE}>{t('phrase_pace_default')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="slow">{optionT('paces.slow')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="fast">{optionT('paces.fast')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditorToolbarSeparator className="mx-1" />

      {mode === 'add'
        ? (
            <Button type="button" size="sm" className="h-8 gap-1" onMouseDown={event => event.preventDefault()} onClick={onAdd}>
              <PlusIcon aria-hidden className="size-4" />
              {t('add_effect')}
            </Button>
          )
        : (
            <EditorToolbarButton label={t('phrase_delete')} onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2Icon />
            </EditorToolbarButton>
          )}
      <EditorToolbarButton label={t('close')} onClick={onClose}>
        <XIcon />
      </EditorToolbarButton>
    </div>,
    document.body,
  )
}
