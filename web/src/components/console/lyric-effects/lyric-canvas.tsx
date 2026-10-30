'use client'

import type { PhraseStyle } from './phrase-toolbar'
import type { AnnotationForm, LineForm, UniqueLine } from '@/lib/lyrics/annotation-edit'
import { FlagIcon, SparklesIcon, SunIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { addPhrase, lineSegments, trimSelection } from '@/lib/lyrics/annotation-edit'
import { lyricEffectCategory } from '@/lib/lyrics/annotation-options'
import { LYRIC_COLORS, MOOD_GLOW } from '@/lib/lyrics/colors'
import { cn } from '@/lib/utils'
import { PhraseToolbar } from './phrase-toolbar'

type Bubble
  = | { mode: 'add', line: number, start: number, end: number, rect: DOMRect, draft: PhraseStyle }
    | { mode: 'edit', line: number, phrase: number, rect: DOMRect }

const DEFAULT_STYLE: PhraseStyle = { effect: 'swell', color: '', font: '', styles: [], pace: '' }

/** 选区端点在一行文字中的字符位置（行内只有歌词文字，没有其他内容） */
function offsetIn(lineEl: HTMLElement, node: Node, offset: number) {
  const range = document.createRange()
  range.selectNodeContents(lineEl)
  range.setEnd(node, offset)
  return range.toString().length
}

function lineElementOf(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement
  return element?.closest<HTMLElement>('[data-lyric-line]') ?? null
}

/**
 * 歌词画布：按去重后的行显示歌词（左侧为行号、重复次数与副歌、情绪、场景、聚光灯标记），已有的特效短语按类别着色，悬停预览动效。
 * 选中一行中的文字时弹出气泡工具栏添加特效（替换与之重叠的旧短语），点击已有短语修改或删除；歌词文本本身不能编辑
 */
export function LyricCanvas({
  unique,
  activeLine,
  onActiveLineChange,
}: {
  unique: UniqueLine[]
  activeLine: number
  onActiveLineChange: (index: number) => void
}) {
  const t = useTranslations('Console.lyric_effects')
  const { control, getValues, setValue } = useFormContext<AnnotationForm>()
  const lines = useWatch({ control, name: 'lines' })
  const spotlights = useWatch({ control, name: 'spotlights' })
  const [bubble, setBubble] = React.useState<Bubble | null>(null)
  // 上一次添加时用的样式，下次选中时沿用
  const lastStyle = React.useRef<PhraseStyle>(DEFAULT_STYLE)

  const close = React.useCallback(() => setBubble(null), [])

  React.useEffect(() => {
    if (!bubble)
      return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bubble, close])

  // 松开鼠标或用键盘调整选区后：选区落在同一行内时弹出添加特效的气泡
  const onSelectionEnd = (event: React.SyntheticEvent) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      // 点在短语上由短语自己处理，其余空白处的点击关闭气泡
      if (!(event.target as HTMLElement).closest?.('[data-phrase]'))
        close()
      return
    }
    const range = selection.getRangeAt(0)
    const lineEl = lineElementOf(range.startContainer)
    if (!lineEl || lineEl !== lineElementOf(range.endContainer))
      return
    const index = Number(lineEl.dataset.lyricLine)
    const text = unique[index].text
    const trimmed = trimSelection(text, offsetIn(lineEl, range.startContainer, range.startOffset), offsetIn(lineEl, range.endContainer, range.endOffset))
    if (!trimmed)
      return
    onActiveLineChange(index)
    setBubble({ mode: 'add', line: index, start: trimmed[0], end: trimmed[1], rect: range.getBoundingClientRect(), draft: lastStyle.current })
  }

  const addFromBubble = () => {
    if (bubble?.mode !== 'add')
      return
    const line = getValues(`lines.${bubble.line}`)
    const phrases = addPhrase(line.text, line.phrases, bubble.start, bubble.end, bubble.draft)
    setValue(`lines.${bubble.line}.phrases`, phrases, { shouldDirty: true })
    lastStyle.current = bubble.draft
    window.getSelection()?.removeAllRanges()
    // 添加后继续以编辑模式调整这个短语
    setBubble({ mode: 'edit', line: bubble.line, phrase: phrases.length - 1, rect: bubble.rect })
  }

  const editing = bubble?.mode === 'edit' ? lines[bubble.line]?.phrases[bubble.phrase] : undefined
  const updatePhrase = (style: PhraseStyle) => {
    if (bubble?.mode !== 'edit' || !editing)
      return
    setValue(`lines.${bubble.line}.phrases.${bubble.phrase}`, { ...editing, ...style }, { shouldDirty: true })
  }
  const deletePhrase = () => {
    if (bubble?.mode !== 'edit')
      return
    const phrases = getValues(`lines.${bubble.line}.phrases`)
    setValue(`lines.${bubble.line}.phrases`, phrases.filter((_, index) => index !== bubble.phrase), { shouldDirty: true })
    close()
  }

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <p className="mb-3 text-xs text-muted-foreground">{t('canvas_hint')}</p>
      <div className="grid gap-0.5" onMouseUp={onSelectionEnd} onKeyUp={onSelectionEnd}>
        {unique.map((line, index) => (
          <LyricCanvasLine
            key={line.text}
            index={index}
            line={line}
            form={lines[index]}
            active={index === activeLine}
            spotlight={spotlights.includes(line.text)}
            activePhrase={bubble?.mode === 'edit' && bubble.line === index ? bubble.phrase : null}
            onActivate={() => onActiveLineChange(index)}
            onPhraseClick={(phrase, rect) => {
              onActiveLineChange(index)
              setBubble({ mode: 'edit', line: index, phrase, rect })
            }}
          />
        ))}
      </div>
      {bubble?.mode === 'add' && (
        <PhraseToolbar
          mode="add"
          rect={bubble.rect}
          value={bubble.draft}
          onChange={draft => setBubble({ ...bubble, draft })}
          onAdd={addFromBubble}
          onClose={close}
        />
      )}
      {bubble?.mode === 'edit' && editing && (
        <PhraseToolbar mode="edit" rect={bubble.rect} value={editing} onChange={updatePhrase} onDelete={deletePhrase} onClose={close} />
      )}
    </div>
  )
}

function LyricCanvasLine({
  index,
  line,
  form,
  active,
  spotlight,
  activePhrase,
  onActivate,
  onPhraseClick,
}: {
  index: number
  line: UniqueLine
  form?: LineForm
  active: boolean
  spotlight: boolean
  activePhrase: number | null
  onActivate: () => void
  onPhraseClick: (phrase: number, rect: DOMRect) => void
}) {
  const t = useTranslations('Console.lyric_effects')
  const optionT = useTranslations('LyricOptions')
  const phrases = form?.phrases ?? []
  const segments = lineSegments(line.text, phrases)
  return (
    <div
      className={cn(
        'grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-2 rounded-lg border-l-2 border-transparent px-2 py-1 transition-colors',
        form?.chorus && 'border-primary/40',
        active ? 'bg-accent/70' : 'hover:bg-accent/30',
      )}
      onClick={onActivate}
    >
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
        <span>{line.indices[0] + 1}</span>
        {line.indices.length > 1 && <span title={t('line_repeat', { count: line.indices.length })}>{`×${line.indices.length}`}</span>}
        {form?.chorusStart && <FlagIcon aria-label={t('chorus_start')} className="size-3 text-primary" />}
        {form?.mood && <span aria-label={optionT(`moods.${form.mood}`)} title={optionT(`moods.${form.mood}`)} className="size-2 rounded-full" style={{ background: MOOD_GLOW[form.mood] }} />}
        {form?.scene && <SparklesIcon aria-label={form.scene.startsWith('custom:') ? t('scene_custom', { label: form.scene.slice('custom:'.length) }) : optionT(`scenes.${form.scene}`)} className="size-3" />}
        {spotlight && <SunIcon aria-label={t('spotlight')} className="size-3 text-amber-500" />}
      </div>
      <div data-lyric-line={index} className="text-[17px] leading-8 whitespace-pre-wrap select-text">
        {segments.map((segment) => {
          if (segment.phrase === undefined)
            return <React.Fragment key={segment.start}>{segment.text}</React.Fragment>
          const phrase = phrases[segment.phrase]
          const phraseIndex = segment.phrase
          return (
            <span
              key={segment.start}
              data-phrase=""
              className="lyric-fx"
              data-effect={phrase.effect}
              data-font={phrase.font || undefined}
              data-colored={phrase.color ? '' : undefined}
              data-bold={phrase.styles.includes('bold') ? '' : undefined}
              data-italic={phrase.styles.includes('italic') ? '' : undefined}
              data-underline={phrase.styles.includes('underline') ? '' : undefined}
              data-active={activePhrase === phraseIndex ? '' : undefined}
              title={optionT(`effects.${phrase.effect}`)}
              style={{
                '--fx-category': lyricEffectCategory(phrase.effect).color,
                ...(phrase.color && { '--fx-color': LYRIC_COLORS[phrase.color] }),
              } as React.CSSProperties}
              onClick={(event) => {
                event.stopPropagation()
                // 拖选经过短语时不当作点击
                if (!window.getSelection()?.isCollapsed)
                  return
                onPhraseClick(phraseIndex, event.currentTarget.getBoundingClientRect())
              }}
            >
              {segment.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
