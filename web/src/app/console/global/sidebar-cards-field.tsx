'use client'

import type { LucideIcon } from 'lucide-react'
import type { SidebarCardConfig, SidebarPresetCard } from '@/components/blog-sidebar/sidebar-cards'
import { AppWindowIcon, ArrowDownIcon, ArrowUpIcon, ClockIcon, FlameIcon, PlusIcon, PuzzleIcon, Settings2Icon, TagsIcon, Trash2Icon, UserRoundIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { parseSidebarCard, SIDEBAR_CARD_TITLE_MAX, SIDEBAR_CARDS_MAX, SIDEBAR_IFRAME_HEIGHT, SIDEBAR_PRESET_CARDS } from '@/components/blog-sidebar/sidebar-cards'
import { LabelWithInfo } from '@/components/common/info-tooltip'
import { ComponentLibraryDialog } from '@/components/content-components/component-library-dialog'
import { ComponentPropsDialog } from '@/components/content-components/component-props-dialog'
import { getDefaultProps } from '@/components/content-components/props'
import { getContentComponent } from '@/components/content-components/registry'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const PRESET_ICONS: Record<SidebarPresetCard, LucideIcon> = {
  about: UserRoundIcon,
  labels: TagsIcon,
  hot_posts: FlameIcon,
  latest_posts: ClockIcon,
}

interface CardRowProps {
  card: SidebarCardConfig
  index: number
  count: number
  onChange: (card: SidebarCardConfig) => void
  onMove: (to: number) => void
  onRemove: () => void
  onEditProps: () => void
}

/** 单张卡片：类型与名称、排序 / 删除按钮；嵌入页面与组件卡片可编辑标题等参数 */
function SidebarCardRow({ card, index, count, onChange, onMove, onRemove, onEditProps }: CardRowProps) {
  const t = useTranslations('Console.global')
  const componentT = useTranslations('ContentComponents')
  const def = card.type === 'component' ? getContentComponent(card.name) : undefined
  const Icon = card.type === 'iframe' ? AppWindowIcon : card.type === 'component' ? def?.icon ?? PuzzleIcon : PRESET_ICONS[card.type]
  const name = card.type === 'component'
    ? (def ? componentT(`${def.name}.name`) : card.name)
    : t(`sidebar_card_${card.type}`)
  const invalid = parseSidebarCard(card) == null

  return (
    <div className={cn('grid gap-3 rounded-lg border p-3', invalid && 'border-destructive/60')}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        {card.type === 'component' && <span className="text-xs text-muted-foreground">{t('sidebar_card_component_tag')}</span>}
        {invalid && <span className="text-xs text-destructive">{t('sidebar_card_invalid')}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {card.type === 'component' && def && (
            <Button type="button" variant="ghost" size="sm" onClick={onEditProps}>
              <Settings2Icon />
              {t('sidebar_card_edit')}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('sidebar_card_move_up')} disabled={index === 0} onClick={() => onMove(index - 1)}>
            <ArrowUpIcon />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('sidebar_card_move_down')} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
            <ArrowDownIcon />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('remove')} className="text-destructive hover:text-destructive" onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      {card.type === 'iframe' && (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_7rem]">
          <Input
            aria-label={t('sidebar_card_title')}
            placeholder={t('sidebar_card_title')}
            maxLength={SIDEBAR_CARD_TITLE_MAX}
            value={card.title ?? ''}
            onChange={e => onChange({ ...card, title: e.target.value })}
          />
          <Input
            type="url"
            aria-label={t('sidebar_iframe_page_url')}
            placeholder="https://"
            value={card.url}
            onChange={e => onChange({ ...card, url: e.target.value })}
          />
          <Input
            type="number"
            aria-label={t('sidebar_iframe_height')}
            title={t('sidebar_iframe_height')}
            min={SIDEBAR_IFRAME_HEIGHT.min}
            max={SIDEBAR_IFRAME_HEIGHT.max}
            value={card.height ?? SIDEBAR_IFRAME_HEIGHT.default}
            onChange={e => onChange({ ...card, height: e.target.valueAsNumber || SIDEBAR_IFRAME_HEIGHT.default })}
          />
        </div>
      )}
      {card.type === 'component' && (
        <Input
          aria-label={t('sidebar_card_title_optional')}
          placeholder={t('sidebar_card_title_optional')}
          maxLength={SIDEBAR_CARD_TITLE_MAX}
          value={card.title ?? ''}
          onChange={e => onChange({ ...card, title: e.target.value })}
        />
      )}
    </div>
  )
}

/**
 * 侧边栏卡片配置：增删、调整顺序；组件卡片从组件库选择，属性弹窗与文章中的组件块共用
 */
export function SidebarCardsField() {
  const t = useTranslations('Console.global')
  const { control } = useFormContext<{ sidebarCards: SidebarCardConfig[] }>()
  const [libraryOpen, setLibraryOpen] = useState(false)
  // 正在编辑属性的组件卡片位置
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <FormField
      control={control}
      name="sidebarCards"
      rules={{ validate: cards => (cards ?? []).every(card => parseSidebarCard(card) != null) || t('sidebar_card_invalid') }}
      render={({ field }) => {
        const cards = field.value ?? []
        const setCards = (next: SidebarCardConfig[]) => field.onChange(next)
        const update = (index: number, card: SidebarCardConfig) => setCards(cards.map((old, i) => (i === index ? card : old)))
        const move = (from: number, to: number) => {
          const next = [...cards]
          next.splice(to, 0, ...next.splice(from, 1))
          setCards(next)
        }
        const full = cards.length >= SIDEBAR_CARDS_MAX
        const editingCard = editing != null ? cards[editing] : undefined
        const editingDef = editingCard?.type === 'component' ? getContentComponent(editingCard.name) : undefined

        return (
          <FormItem className="md:col-span-2">
            <LabelWithInfo info={t('sidebar_cards_desc')}><FormLabel>{t('sidebar_cards')}</FormLabel></LabelWithInfo>
            <div className="grid gap-2">
              {cards.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{t('sidebar_cards_empty')}</p>}
              {cards.map((card, index) => (
                <SidebarCardRow
                  // 配置项没有稳定 ID，按位置编辑
                  key={index}
                  card={card}
                  index={index}
                  count={cards.length}
                  onChange={next => update(index, next)}
                  onMove={to => move(index, to)}
                  onRemove={() => setCards(cards.filter((_, i) => i !== index))}
                  onEditProps={() => setEditing(index)}
                />
              ))}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={full}>
                    <PlusIcon />
                    {t('sidebar_card_add')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {/* 预设卡片每种最多一张 */}
                  {SIDEBAR_PRESET_CARDS.map((type) => {
                    const PresetIcon = PRESET_ICONS[type]
                    return (
                      <DropdownMenuItem key={type} disabled={cards.some(card => card.type === type)} onSelect={() => setCards([...cards, { type }])}>
                        <PresetIcon />
                        {t(`sidebar_card_${type}`)}
                      </DropdownMenuItem>
                    )
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setCards([...cards, { type: 'iframe', title: '', url: '', height: SIDEBAR_IFRAME_HEIGHT.default }])}>
                    <AppWindowIcon />
                    {t('sidebar_card_iframe')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setLibraryOpen(true)}>
                    <PuzzleIcon />
                    {t('sidebar_card_component')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <FormMessage />

            <ComponentLibraryDialog
              open={libraryOpen}
              onOpenChange={setLibraryOpen}
              onInsert={(name) => {
                const def = getContentComponent(name)
                if (!def)
                  return
                setLibraryOpen(false)
                setCards([...cards, { type: 'component', title: '', name, props: getDefaultProps(def), version: def.version }])
                // 与编辑器插入组件一致：添加后直接打开属性编辑
                setEditing(cards.length)
              }}
            />
            {editingCard?.type === 'component' && editingDef && (
              <ComponentPropsDialog
                def={editingDef}
                open
                onOpenChange={open => !open && setEditing(null)}
                value={editingCard.props ?? {}}
                onSubmit={props => update(editing!, { ...editingCard, props, version: editingDef.version })}
              />
            )}
          </FormItem>
        )
      }}
    />
  )
}
