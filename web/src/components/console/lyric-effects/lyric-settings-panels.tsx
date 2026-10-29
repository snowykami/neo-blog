'use client'

import type { AnnotationForm, UniqueLine } from '@/lib/lyrics/annotation-edit'
import type { LyricSprite } from '@/lib/lyrics/types'
import { Trash2Icon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useFormContext, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { LYRIC_COLOR_NAMES, LYRIC_EFFECT_CATEGORIES, LYRIC_FONTS, LYRIC_INTRO_MAX, LYRIC_MOODS, LYRIC_SCENES, lyricEffectCategory } from '@/lib/lyrics/annotation-options'
import { LYRIC_COLORS, MOOD_GLOW } from '@/lib/lyrics/colors'
import { LYRIC_PACES } from '@/lib/lyrics/pace'

// 选择框的「无」：Radix 的选项值不能为空字符串
const NONE = 'none'
const toSelect = (value: string) => value || NONE
const fromSelect = (value: string) => (value === NONE ? '' : value)

function Panel({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-3 shrink-0 rounded-full border" style={{ background: color }} />
}

/** 全曲设置：字体、特效节奏、前奏导语与当前的聚光灯 */
export function SongSettingsPanel({ lines }: { lines: string[] }) {
  const t = useTranslations('Console.lyric_effects')
  const optionT = useTranslations('LyricOptions')
  const { control, setValue } = useFormContext<AnnotationForm>()
  const spotlight = useWatch({ control, name: 'spotlight' })
  const intro = useWatch({ control, name: 'intro' })
  return (
    <Panel title={t('song_settings')}>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={control}
          name="font"
          render={({ field }) => (
            <FormItem className="grid gap-2">
              <FormLabel>{t('font')}</FormLabel>
              <Select value={toSelect(field.value)} onValueChange={value => field.onChange(fromSelect(value))}>
                <FormControl>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NONE}>{t('font_default')}</SelectItem>
                  {LYRIC_FONTS.map(font => <SelectItem key={font} value={font}>{optionT(`fonts.${font}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="pace"
          render={({ field }) => (
            <FormItem className="grid gap-2">
              <FormLabel>{t('pace')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  {LYRIC_PACES.map(pace => <SelectItem key={pace} value={pace}>{optionT(`paces.${pace}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={control}
        name="intro"
        render={({ field }) => (
          <FormItem className="grid gap-2">
            <FormLabel>{t('intro')}</FormLabel>
            <FormControl>
              <Textarea {...field} rows={2} maxLength={LYRIC_INTRO_MAX} placeholder={t('intro_placeholder')} />
            </FormControl>
            <FormDescription className="text-right tabular-nums">{`${[...intro].length} / ${LYRIC_INTRO_MAX}`}</FormDescription>
          </FormItem>
        )}
      />
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t('spotlight')}</span>
        {spotlight != null && lines[spotlight] != null
          ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{t('spotlight_current', { line: spotlight + 1, text: lines[spotlight] })}</span>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t('spotlight_clear')} title={t('spotlight_clear')} onClick={() => setValue('spotlight', null, { shouldDirty: true })}>
                  <XIcon className="size-4" />
                </Button>
              </div>
            )
          : <p className="text-sm text-muted-foreground">{t('spotlight_empty')}</p>}
      </div>
    </Panel>
  )
}

/** 当前行的设置：情绪、副歌、副歌起点、粒子场景（含这首歌的自定义粒子）与颜色、聚光灯，以及这一行的特效列表 */
export function LineSettingsPanel({ index, line, sprites = [] }: { index: number, line?: UniqueLine, sprites?: LyricSprite[] }) {
  const t = useTranslations('Console.lyric_effects')
  const optionT = useTranslations('LyricOptions')
  const { control, setValue, getValues } = useFormContext<AnnotationForm>()
  const form = useWatch({ control, name: `lines.${index}` })
  const spotlight = useWatch({ control, name: 'spotlight' })
  if (!line || !form)
    return <Panel title={t('line_settings')}><p className="text-sm text-muted-foreground">{t('line_hint')}</p></Panel>

  const spotlightValue = spotlight != null && line.indices.includes(spotlight) ? String(spotlight) : NONE
  return (
    <Panel title={t('line_title', { index: line.indices[0] + 1 })}>
      <div className="grid gap-1">
        <p className="text-sm break-words">{line.text}</p>
        {line.indices.length > 1 && <p className="text-xs text-muted-foreground">{t('line_repeat', { count: line.indices.length })}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={control}
          name={`lines.${index}.mood`}
          render={({ field }) => (
            <FormItem className="grid gap-2">
              <FormLabel>{t('mood')}</FormLabel>
              <Select value={toSelect(field.value)} onValueChange={value => field.onChange(fromSelect(value))}>
                <FormControl>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NONE}>{t('none')}</SelectItem>
                  {LYRIC_MOODS.map(mood => (
                    <SelectItem key={mood} value={mood}>
                      <Swatch color={MOOD_GLOW[mood]} />
                      {optionT(`moods.${mood}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t('spotlight')}</span>
          <Select
            value={spotlightValue}
            onValueChange={value => setValue('spotlight', value === NONE ? (spotlightValue === NONE ? spotlight : null) : Number(value), { shouldDirty: true })}
          >
            <SelectTrigger className="w-full" aria-label={t('spotlight')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('spotlight_none')}</SelectItem>
              {line.indices.map((lineIndex, occurrence) => (
                <SelectItem key={lineIndex} value={String(lineIndex)}>
                  {t('spotlight_occurrence', { occurrence: occurrence + 1, line: lineIndex + 1 })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3">
        <FormField
          control={control}
          name={`lines.${index}.chorus`}
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3">
              <FormLabel>{t('chorus')}</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value || form.chorusStart}
                  onCheckedChange={(checked) => {
                    field.onChange(checked)
                    // 副歌起点一定是副歌
                    if (!checked)
                      setValue(`lines.${index}.chorusStart`, false, { shouldDirty: true })
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`lines.${index}.chorusStart`}
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3">
              <div className="grid gap-1">
                <FormLabel>{t('chorus_start')}</FormLabel>
                <FormDescription>{t('chorus_start_hint')}</FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked)
                    if (checked)
                      setValue(`lines.${index}.chorus`, true, { shouldDirty: true })
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={control}
          name={`lines.${index}.scene`}
          render={({ field }) => (
            <FormItem className="grid gap-2">
              <FormLabel>{t('scene')}</FormLabel>
              <Select
                value={toSelect(field.value)}
                onValueChange={(value) => {
                  field.onChange(fromSelect(value))
                  if (value === NONE)
                    setValue(`lines.${index}.sceneColor`, '', { shouldDirty: true })
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NONE}>{t('none')}</SelectItem>
                  {sprites.map(sprite => (
                    <SelectItem key={sprite.name} value={`custom:${sprite.name}`}>
                      <Swatch color={LYRIC_COLORS[sprite.color]} />
                      {t('scene_custom', { label: sprite.label || sprite.name })}
                    </SelectItem>
                  ))}
                  {LYRIC_SCENES.map(scene => <SelectItem key={scene} value={scene}>{optionT(`scenes.${scene}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`lines.${index}.sceneColor`}
          render={({ field }) => (
            <FormItem className="grid gap-2">
              <FormLabel>{t('scene_color')}</FormLabel>
              <Select value={toSelect(field.value)} onValueChange={value => field.onChange(fromSelect(value))} disabled={!form.scene}>
                <FormControl>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NONE}>{t('scene_color_default')}</SelectItem>
                  {LYRIC_COLOR_NAMES.map(color => (
                    <SelectItem key={color} value={color}>
                      <Swatch color={LYRIC_COLORS[color]} />
                      {optionT(`colors.${color}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t('phrases')}</span>
        {form.phrases.length === 0 && <p className="text-sm text-muted-foreground">{t('phrases_empty')}</p>}
        {form.phrases.map((phrase, phraseIndex) => (
          <div key={phrase.text} className="flex items-center gap-2 text-sm">
            <Swatch color={lyricEffectCategory(phrase.effect).color} />
            <span className="min-w-0 truncate font-medium">{phrase.text}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{optionT(`effects.${phrase.effect}`)}</span>
            {phrase.color && <Swatch color={LYRIC_COLORS[phrase.color]} />}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="ml-auto text-muted-foreground hover:text-destructive"
              aria-label={t('phrase_delete')}
              title={t('phrase_delete')}
              onClick={() => setValue(`lines.${index}.phrases`, getValues(`lines.${index}.phrases`).filter((_, i) => i !== phraseIndex), { shouldDirty: true })}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** 特效分类图例 */
export function EffectLegendPanel() {
  const t = useTranslations('Console.lyric_effects')
  const optionT = useTranslations('LyricOptions')
  return (
    <Panel title={t('legend')}>
      <ul className="grid gap-2 text-sm">
        {LYRIC_EFFECT_CATEGORIES.map(category => (
          <li key={category.key} className="flex items-start gap-2">
            <span aria-hidden className="mt-1.5 h-0.5 w-4 shrink-0 rounded-full" style={{ background: category.color }} />
            <span>
              <span className="font-medium">{optionT(`categories.${category.key}`)}</span>
              <span className="text-muted-foreground">{` · ${category.effects.map(effect => optionT(`effects.${effect}`)).join(' / ')}`}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('legend_hint')}</p>
    </Panel>
  )
}
