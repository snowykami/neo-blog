'use client'

import type { SaveState } from '@/hooks/use-content-editor'
import {
  ArrowLeftIcon,
  CopyIcon,
  EllipsisIcon,
  EyeIcon,
  FocusIcon,
  FullscreenIcon,
  LockIcon,
  MinimizeIcon,
  MoonIcon,
  SendIcon,
  Settings2Icon,
  SunIcon,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import Link from 'next/link'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { formatShortcut } from './editor-commands'
import { EditorTooltip } from './editor-toolbar-button'
import { SaveStatusPill } from './save-status-pill'

export interface PublishSummaryItem {
  label: string
  value: React.ReactNode
}

export interface EditorAppBarProps {
  backHref: string
  backLabel: string
  crumbRoot: string
  title: string
  isPrivate: boolean
  hasUnpublishedChanges: boolean
  words: number
  saveState: SaveState
  saveError: string | null
  lastSavedAt: Date | null
  readOnly: boolean
  canSave: boolean
  publishing: boolean
  publishTitle: string
  publishSummary: PublishSummaryItem[]
  isFullScreen: boolean
  focusMode: boolean
  onSave: () => void
  onPublish: () => Promise<boolean>
  onPreview: () => void
  onOpenSettings: () => void
  onToggleFocusMode: () => void
  onToggleFullScreen: () => void
  onCopyHtml: () => void
  settingsLabel: string
  className?: string
}

/**
 * 顶部应用栏（吸顶）：返回 | 面包屑与状态 | 保存状态、字数 | 预览、设置、更多、发布
 */
export function EditorAppBar(props: EditorAppBarProps) {
  const {
    backHref,
    backLabel,
    crumbRoot,
    title,
    isPrivate,
    hasUnpublishedChanges,
    words,
    saveState,
    saveError,
    lastSavedAt,
    readOnly,
    canSave,
    publishing,
    isFullScreen,
    focusMode,
    onSave,
    onPreview,
    onOpenSettings,
    onToggleFocusMode,
    onToggleFullScreen,
    onCopyHtml,
    settingsLabel,
    className,
  } = props
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const format = useFormatter()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-13 shrink-0 items-center gap-0.5 bg-background/80 px-2 backdrop-blur-md backdrop-saturate-150 md:h-14 md:gap-1.5 md:px-4',
        className,
      )}
    >
      <EditorTooltip label={backLabel}>
        <Button asChild variant="ghost" size="icon" className="size-9 text-foreground/75">
          <Link href={backHref} aria-label={backLabel}>
            <ArrowLeftIcon className="size-[18px]" />
          </Link>
        </Button>
      </EditorTooltip>

      <nav aria-label={t('breadcrumb')} className="flex min-w-0 items-center gap-2 text-sm">
        <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-primary" />
        <span className="hidden shrink-0 text-muted-foreground md:inline">{crumbRoot}</span>
        <span className="hidden shrink-0 text-foreground/30 md:inline">/</span>
        <span className="min-w-0 truncate font-semibold text-foreground/90" title={title}>{title}</span>
        <Badge
          variant="secondary"
          className={cn(
            'hidden h-[22px] shrink-0 rounded-full px-2 font-medium md:inline-flex',
            hasUnpublishedChanges
              ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
          )}
        >
          {isPrivate && <LockIcon className="size-3" />}
          {hasUnpublishedChanges ? t('status_unpublished_changes') : t('status_published')}
          {isPrivate && ` · ${t('status_private')}`}
        </Badge>
      </nav>

      <span className="min-w-2 flex-1" />

      <SaveStatusPill state={saveState} lastSavedAt={lastSavedAt} error={saveError} readOnly={readOnly} onSave={onSave} />
      <span className="hidden px-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums md:inline">
        {t('words', { count: format.number(words) })}
      </span>
      <span aria-hidden="true" className="mx-1 hidden h-[18px] w-px bg-border md:block" />

      <EditorTooltip label={t('preview_tip')} shortcut="mod+shift+p">
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2.5 text-foreground/75 md:px-3" aria-label={operationT('preview')} onClick={onPreview}>
          <EyeIcon className="size-[18px]" />
          <span className="hidden md:inline">{operationT('preview')}</span>
        </Button>
      </EditorTooltip>
      <EditorTooltip label={settingsLabel}>
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2.5 text-foreground/75 md:px-3" aria-haspopup="dialog" aria-label={settingsLabel} onClick={onOpenSettings}>
          <Settings2Icon className="size-[18px]" />
          <span className="hidden md:inline">{operationT('setting')}</span>
        </Button>
      </EditorTooltip>

      <DropdownMenu modal={false}>
        <EditorTooltip label={operationT('more')}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9 text-foreground/75" aria-label={operationT('more')}>
              <EllipsisIcon className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
        </EditorTooltip>
        <DropdownMenuContent align="end" className="min-w-56 rounded-xl p-1">
          <DropdownMenuItem onSelect={onToggleFocusMode} className={cn(focusMode && 'text-primary')}>
            <FocusIcon />
            <span className="flex-1">
              {t('focus_mode')}
              <span className="ml-1.5 text-xs text-muted-foreground">{t('focus_mode_hint')}</span>
            </span>
            <DropdownMenuShortcut className="tracking-normal">{formatShortcut('mod+shift+.')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleFullScreen}>
            {isFullScreen ? <MinimizeIcon /> : <FullscreenIcon />}
            {isFullScreen ? postEditT('fullscreen_exit') : postEditT('fullscreen_enter')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(isDark ? 'light' : 'dark')}>
            {isDark ? <SunIcon /> : <MoonIcon />}
            {isDark ? t('theme_light') : t('theme_dark')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCopyHtml}>
            <CopyIcon />
            {t('copy_html')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PublishPopover {...props} disabled={!canSave || publishing || readOnly} />
    </header>
  )
}

function PublishPopover({
  publishTitle,
  publishSummary,
  publishing,
  disabled,
  onPublish,
  onOpenSettings,
}: EditorAppBarProps & { disabled: boolean }) {
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="ml-0.5 h-9 gap-1.5 px-3" disabled={disabled} aria-haspopup="dialog" aria-label={operationT('publish')}>
          <SendIcon className="size-4" />
          <span className="hidden sm:inline">{publishing ? postEditT('publishing') : operationT('publish')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="grid w-[300px] max-w-[calc(100vw-1rem)] gap-3 rounded-xl p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-primary" />
          {publishTitle}
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[13px]">
          {publishSummary.map(item => (
            <React.Fragment key={item.label}>
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="m-0 min-w-0 truncate text-foreground/90">{item.value}</dd>
            </React.Fragment>
          ))}
        </dl>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            <Settings2Icon />
            {t('publish_adjust')}
          </Button>
          <span className="flex-1" />
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={async () => {
              if (await onPublish())
                setOpen(false)
            }}
          >
            {publishing ? postEditT('publishing') : t('publish_confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
