'use client'

import type { AgentRunStatus, AgentRunTrigger, AIAgentStatus, AIAgentTier } from '@/models/ai-agent'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useDebouncedState } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'
import { formatCompactNumber } from '@/utils/common/number'

export const useAIAgentT = () => useTranslations('Console.ai_agents')

// 触发方式含点号（post.published），作为文案键时替换为下划线
export function triggerKey(trigger: AgentRunTrigger | string) {
  return trigger.replace(/\./g, '_')
}

// 每行一条（兼容逗号分隔）的文本与数组互转；示例评论等可能含逗号的字段只按行拆分
export function linesToList(text: string, splitComma = true): string[] {
  const parts = splitComma ? text.split(/[\n,，、]/) : text.split('\n')
  return parts.map(item => item.trim()).filter(Boolean)
}

export function listToLines(list: string[] | null | undefined): string {
  return (list ?? []).join('\n')
}

export function TierBadge({ tier }: { tier: AIAgentTier }) {
  const t = useAIAgentT()
  return <Badge variant={tier === 'expert' ? 'default' : 'secondary'}>{t(`tier.${tier}`)}</Badge>
}

export function AgentStatusBadge({ status, reason }: { status: AIAgentStatus, reason?: string }) {
  const t = useAIAgentT()
  return (
    <Badge variant={status === 'active' ? 'outline' : 'secondary'} title={reason || undefined}>
      <span className={cn('size-1.5 rounded-full', status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground')} aria-hidden="true" />
      {t(`status.${status}`)}
    </Badge>
  )
}

const RUN_STATUS_DOT: Record<AgentRunStatus, string> = {
  queued: 'bg-sky-500',
  leased: 'bg-amber-500',
  done: 'bg-emerald-500',
  skipped: 'bg-muted-foreground',
  failed: 'bg-destructive',
}

export function RunStatusBadge({ status }: { status: AgentRunStatus }) {
  const t = useAIAgentT()
  return (
    <Badge variant={status === 'failed' ? 'destructive' : 'outline'}>
      {status === 'leased' || status === 'queued'
        ? <Spinner className="size-3" />
        : <span className={cn('size-1.5 rounded-full', RUN_STATUS_DOT[status])} aria-hidden="true" />}
      {t(`run_status.${status}`)}
    </Badge>
  )
}

// tokens 等大数字统一按 K / M / B 紧凑展示（如 8.2M）
export function useCompactNumber() {
  return formatCompactNumber
}

export interface SearchSelectOption {
  value: number
  label: string
  description?: string
  icon?: React.ReactNode
}

/**
 * 远程搜索的单选下拉：输入关键字后防抖请求，选中后回调；
 * 用于选择 AI 用户、普通用户、文章等数量较多、不适合一次全部加载的对象
 */
export function SearchSelect({ selected, placeholder, emptyText, search, onSelect, className, disabled }: {
  selected: SearchSelectOption | null
  placeholder: string
  emptyText: string
  search: (query: string) => Promise<SearchSelectOption[]>
  onSelect: (option: SearchSelectOption | null) => void
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [queryInput, setQueryInput, query] = useDebouncedState('', 300)
  const [options, setOptions] = useState<SearchSelectOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open)
      return
    let cancelled = false
    setLoading(true)
    search(query.trim())
      .then((items) => {
        if (!cancelled)
          setOptions(items)
      })
      .catch(() => {
        if (!cancelled)
          setOptions([])
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, query, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between font-normal', !selected && 'text-muted-foreground', className)}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected?.icon}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={queryInput} onValueChange={setQueryInput} className="h-9" />
          <CommandList>
            {loading
              ? <div className="flex justify-center py-6"><Spinner /></div>
              : <CommandEmpty>{emptyText}</CommandEmpty>}
            {!loading && options.length > 0 && (
              <CommandGroup className="max-h-64 overflow-y-auto">
                {options.map(option => (
                  <CommandItem
                    key={option.value}
                    value={String(option.value)}
                    onSelect={() => {
                      onSelect(selected?.value === option.value ? null : option)
                      setOpen(false)
                    }}
                  >
                    {option.icon}
                    <div className="grid min-w-0">
                      <span className="truncate">{option.label}</span>
                      {option.description && <span className="truncate text-xs text-muted-foreground">{option.description}</span>}
                    </div>
                    <Check className={cn('ml-auto', selected?.value === option.value ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
