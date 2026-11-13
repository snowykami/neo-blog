'use client'

import type { AITitlesPayload, AIWriteTarget } from '@/models/ai-write'
import { CheckIcon, Loader2Icon, RefreshCwIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { suggestAITitles } from '@/api/ai-write'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'

export interface AITitleSuggesterProps {
  target: AIWriteTarget
  targetId: number
  currentTitle?: string
  getPayload?: () => AITitlesPayload
  onSelectTitle: (title: string) => void
  disabled?: boolean
  compact?: boolean
  className?: string
}

export function AITitleSuggester({
  target,
  targetId,
  currentTitle,
  getPayload,
  onSelectTitle,
  disabled,
  compact = false,
  className,
}: AITitleSuggesterProps) {
  const t = useTranslations('Console.post_edit')
  const errorMessageT = useErrorMessageT()
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [titles, setTitles] = React.useState<string[]>([])
  const [errorText, setErrorText] = React.useState<string | null>(null)
  const reqIdRef = React.useRef(0)

  const fetchTitles = React.useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setErrorText(null)
    try {
      const res = await suggestAITitles({
        target,
        id: targetId,
        payload: getPayload?.(),
      })
      if (reqId !== reqIdRef.current)
        return
      setTitles(res.data?.titles ?? [])
    }
    catch (error) {
      if (reqId !== reqIdRef.current)
        return
      setErrorText(errorMessageT(error))
    }
    finally {
      if (reqId === reqIdRef.current)
        setLoading(false)
    }
  }, [target, targetId, getPayload, errorMessageT])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen && titles.length === 0 && !loading) {
      void fetchTitles()
    }
  }

  const triggerButton = compact
    ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn('h-6 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground', className)}
        >
          {loading ? <Loader2Icon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5 text-primary" />}
          <span>{t('ai_suggest_titles_short')}</span>
        </Button>
      )
    : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t('ai_suggest_titles')}
          className={cn('text-muted-foreground/70 hover:text-primary', className)}
        >
          {loading ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
        </Button>
      )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {compact
        ? (
            <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          )
        : (
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="left">{t('ai_suggest_titles')}</TooltipContent>
            </Tooltip>
          )}
      <PopoverContent align="end" className="w-80 p-3 sm:w-96">
        <div className="flex items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
            <SparklesIcon className="size-3.5 text-primary" />
            <span>{t('ai_suggest_titles')}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void fetchTitles()}
            className="h-6 gap-1 px-2 text-xs text-muted-foreground"
          >
            <RefreshCwIcon className={cn('size-3', loading && 'animate-spin')} />
            <span>{t('ai_titles_regenerate')}</span>
          </Button>
        </div>

        {loading && titles.length === 0
          ? (
              <div className="flex items-center gap-2 py-6 justify-center text-xs text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin text-primary" />
                <span>{t('ai_titles_generating')}</span>
              </div>
            )
          : errorText
            ? (
                <div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                  {errorText}
                </div>
              )
            : (
                <div className="grid gap-1">
                  {titles.map((candidate) => {
                    const active = currentTitle?.trim() === candidate.trim()
                    return (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => {
                          onSelectTitle(candidate)
                          setOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          active && 'bg-accent/70 font-medium',
                        )}
                      >
                        <span className="min-w-0 flex-1 leading-snug">{candidate}</span>
                        {active && <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />}
                      </button>
                    )
                  })}
                  {titles.length > 0 && (
                    <p className="px-1 pt-1 text-[11px] text-muted-foreground/75">
                      {t('ai_titles_hint')}
                    </p>
                  )}
                </div>
              )}
      </PopoverContent>
    </Popover>
  )
}
