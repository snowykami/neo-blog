'use client'
import type { TimeZonePresetId } from '@/utils/common/time-zone'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useBrowserTimeZone } from '@/hooks/use-browser-time-zone'
import { cn } from '@/lib/utils'
import {
  formatUtcOffset,
  getTimeZoneDisplayName,
  getTimeZoneOffset,
  isValidTimeZone,
  listTimeZones,
  TIME_ZONE_PRESETS,
} from '@/utils/common/time-zone'

interface TimeZoneOption {
  value: string
  offset: number
  name: string // 本地化的时区名称，如「日本标准时间」
  preset?: TimeZonePresetId
}

// 浏览器会把旧名称和新名称解析成同一个时区（如 Asia/Kolkata 与 Asia/Calcutta），按解析结果去重
function canonicalTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone
}

/**
 * 时区组合框：输入城市、时区名、本地化名称或 UTC 偏移即可筛选候选，
 * 顶部是当前浏览器时区和主流时区预设，下面是按 UTC 偏移排序的全部标准时区；只能选择标准时区
 */
export function TimeZoneCombobox({ id, value, onChange, className }: {
  id?: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const t = useTranslations('TimeZone')
  const locale = useLocale()
  const browserTimeZone = useBrowserTimeZone()
  const [open, setOpen] = useState(false)

  const { common, others } = useMemo(() => {
    const now = new Date()
    const presets = new Map<string, TimeZonePresetId>(TIME_ZONE_PRESETS.map(p => [canonicalTimeZone(p.timeZone), p.id]))
    const seen = new Set<string>()
    const pick = (zones: string[]) => zones.flatMap((zone) => {
      if (!isValidTimeZone(zone))
        return []
      const canonical = canonicalTimeZone(zone)
      if (seen.has(canonical))
        return []
      seen.add(canonical)
      return [{ value: zone, offset: getTimeZoneOffset(zone, now), name: getTimeZoneDisplayName(zone, locale, now), preset: presets.get(canonical) }]
    })
    const common = pick([browserTimeZone, ...TIME_ZONE_PRESETS.map(p => p.timeZone)])
    const others = pick(listTimeZones()).sort((a, b) => a.offset - b.offset || a.value.localeCompare(b.value))
    return { common, others }
  }, [browserTimeZone, locale])

  // 已保存的值可能不在列表里（如 US/Eastern 这类旧名称），只要是标准时区仍正常显示
  const selected = useMemo(() => {
    const found = common.find(o => o.value === value) ?? others.find(o => o.value === value)
    if (found || !isValidTimeZone(value))
      return found ?? null
    const now = new Date()
    return { value, offset: getTimeZoneOffset(value, now), name: getTimeZoneDisplayName(value, locale, now) }
  }, [common, others, value, locale])

  const renderOption = (option: TimeZoneOption) => {
    const offset = formatUtcOffset(option.offset)
    const label = option.preset ? t(`presets.${option.preset}`) : option.value
    // 副标题：预设显示时区名，再接偏移和本地化名称；去掉与标题重复的部分（如 UTC 的名称与偏移都是 UTC）
    const detail = [...new Set([option.preset ? option.value : '', offset, option.name])].filter(part => part && part !== label)
    return (
      <CommandItem
        key={option.value}
        value={option.value}
        // 支持按城市名、本地化名称、UTC / GMT 偏移和不带下划线的地名搜索
        keywords={[label, option.name, offset, offset.replace('UTC', 'GMT'), option.value.replace(/[/_]/g, ' ')]}
        onSelect={(next) => {
          onChange(next)
          setOpen(false)
        }}
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{label}</span>
            {option.value === browserTimeZone && <Badge variant="secondary" className="shrink-0">{t('browser')}</Badge>}
          </span>
          <span className="truncate text-xs text-muted-foreground">{detail.join(' · ')}</span>
        </span>
        <Check className={cn('ml-auto', value === option.value ? 'opacity-100' : 'opacity-0')} />
      </CommandItem>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // 文字列可收缩到 0：放在窄栅格里时按钮跟随列宽，时区名截断显示而不撑破布局
          className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] font-normal', !selected && 'text-muted-foreground', className)}
        >
          {/* 时区名和偏移在同一行截断，空间不够时优先显示时区名 */}
          <span className="truncate text-left">
            {selected ? selected.value : t('placeholder')}
            {selected && <span className="ml-2 text-xs text-muted-foreground">{formatUtcOffset(selected.offset)}</span>}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('search')} className="h-9" />
          <CommandList>
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup heading={t('group_common')}>{common.map(renderOption)}</CommandGroup>
            <CommandGroup heading={t('group_all')}>{others.map(renderOption)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
