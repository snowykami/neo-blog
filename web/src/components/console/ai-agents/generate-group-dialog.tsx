'use client'

import type { AIAgentGroup, AIAgentPreview, AIAgentTier } from '@/models/ai-agent'
import { Eye, Loader2, Plus, Trash2, Wand } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { generateAIAgentGroup } from '@/api/ai-agent'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { TierToggle } from './create-agent-dialog'
import { linesToList, useAIAgentT } from './shared'

// 头像使用 DiceBear 生成，这里列出适合做头像的风格
const AVATAR_STYLES = ['notionists', 'notionists-neutral', 'adventurer', 'adventurer-neutral', 'lorelei', 'micah', 'open-peeps', 'personas', 'thumbs', 'fun-emoji', 'bottts', 'pixel-art']
// 人设使用的语言，与界面支持的语言一致
const PERSONA_LANGUAGES = ['zh', 'zh-tw', 'en', 'ja', 'ko']
const DEFAULT_ARCHETYPES = ['lurker', 'reader', 'chatty', 'digger'] as const
const DEFAULT_ARCHETYPE_VALUES: Record<(typeof DEFAULT_ARCHETYPES)[number], { ratio: number, min: number, max: number, comment: number }> = {
  lurker: { ratio: 60, min: 0.3, max: 1, comment: 2 },
  reader: { ratio: 25, min: 0.5, max: 2, comment: 15 },
  chatty: { ratio: 10, min: 2, max: 4, comment: 35 },
  digger: { ratio: 5, min: 0.2, max: 0.5, comment: 20 },
}

interface ArchetypeRow {
  name: string
  description: string
  ratio: number // 占比（权重，按比例分配）
  dailyActionsMin: number
  dailyActionsMax: number
  comment: number // 评论倾向，百分比
}

interface GenerateForm {
  name: string
  count: number
  tier: AIAgentTier
  archetypes: ArchetypeRow[]
  interests: string
  blockedTopics: string
  avatarStyle: string
  language: string
}

export function GenerateGroupDialog({ open, onOpenChange, onGenerated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerated: (group: AIAgentGroup) => void
}) {
  const t = useAIAgentT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('generate.title')}</DialogTitle>
          <DialogDescription>{t('generate.description')}</DialogDescription>
        </DialogHeader>
        {open && <GenerateFormBody onCancel={() => onOpenChange(false)} onGenerated={onGenerated} />}
      </DialogContent>
    </Dialog>
  )
}

// 数字输入：空值时保留 NaN 交给校验提示
function numberValue(e: React.ChangeEvent<HTMLInputElement>) {
  return e.target.value === '' ? Number.NaN : e.target.valueAsNumber
}

function GenerateFormBody({ onCancel, onGenerated }: { onCancel: () => void, onGenerated: (group: AIAgentGroup) => void }) {
  const t = useAIAgentT()
  const locale = useLocale()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [preview, setPreview] = useState<AIAgentPreview[] | null>(null)
  const [pending, setPending] = useState<'preview' | 'generate' | null>(null)
  const languageNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'language' }), [locale])
  const form = useForm<GenerateForm>({
    defaultValues: {
      name: '',
      count: 100,
      tier: 'ambient',
      archetypes: DEFAULT_ARCHETYPES.map((key) => {
        const v = DEFAULT_ARCHETYPE_VALUES[key]
        return {
          name: t(`generate.default_archetypes.${key}.name`),
          description: t(`generate.default_archetypes.${key}.description`),
          ratio: v.ratio,
          dailyActionsMin: v.min,
          dailyActionsMax: v.max,
          comment: v.comment,
        }
      }),
      interests: '',
      blockedTopics: '',
      avatarStyle: 'notionists',
      language: locale === 'zh-tw' ? 'zh-tw' : PERSONA_LANGUAGES.includes(locale) ? locale : 'zh',
    },
  })
  const archetypes = useFieldArray({ control: form.control, name: 'archetypes' })
  const count = form.watch('count')

  const submit = (previewOnly: boolean) => form.handleSubmit(async (values) => {
    setPending(previewOnly ? 'preview' : 'generate')
    try {
      const res = await generateAIAgentGroup({
        name: values.name.trim(),
        count: values.count,
        preview: previewOnly,
        template: {
          tier: values.tier,
          archetypes: values.archetypes.map(row => ({
            name: row.name.trim(),
            description: row.description.trim(),
            ratio: row.ratio,
            dailyActionsMin: row.dailyActionsMin,
            dailyActionsMax: row.dailyActionsMax,
            comment: row.comment / 100,
          })),
          interests: linesToList(values.interests),
          blockedTopics: linesToList(values.blockedTopics),
          avatarStyle: values.avatarStyle,
          language: values.language,
        },
      })
      if (previewOnly) {
        setPreview(res.data.preview ?? [])
      }
      else if (res.data.group) {
        toast.success(t('generate.started', { count: values.count }))
        onGenerated(res.data.group)
      }
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('operation_failed')))
    }
    finally {
      setPending(null)
    }
  })

  const positive = (v: number) => (Number.isFinite(v) && v >= 0) || t('generate.invalid_number')

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={e => e.preventDefault()}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <FormField
            control={form.control}
            name="name"
            rules={{ validate: v => Boolean(v.trim()) || t('generate.name_required') }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('generate.name')}</FormLabel>
                <FormControl><Input {...field} placeholder={t('generate.name_placeholder')} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="count"
            rules={{ validate: v => (Number.isInteger(v) && v >= 1) || t('generate.invalid_count') }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('generate.count')}</FormLabel>
                <FormControl>
                  <Input type="number" min={1} step={1} value={Number.isNaN(field.value) ? '' : field.value} onChange={e => field.onChange(numberValue(e))} onBlur={field.onBlur} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="tier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tier_label')}</FormLabel>
              <FormControl>
                <TierToggle value={field.value} onChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="grid gap-1">
              <span className="text-sm font-medium">{t('generate.archetypes')}</span>
              <span className="text-xs text-muted-foreground">{t('generate.archetypes_hint')}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => archetypes.append({ name: '', description: '', ratio: 10, dailyActionsMin: 0.5, dailyActionsMax: 2, comment: 10 })}
            >
              <Plus />
              {t('generate.add_archetype')}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-32">{t('generate.archetype_name')}</TableHead>
                  <TableHead className="min-w-48">{t('generate.archetype_description')}</TableHead>
                  <TableHead className="w-20">{t('generate.archetype_ratio')}</TableHead>
                  <TableHead className="w-20">{t('generate.archetype_daily_min')}</TableHead>
                  <TableHead className="w-20">{t('generate.archetype_daily_max')}</TableHead>
                  <TableHead className="w-20">{t('generate.archetype_comment')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {archetypes.fields.map((row, index) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-top">
                      <FormField
                        control={form.control}
                        name={`archetypes.${index}.name`}
                        rules={{ validate: v => Boolean(v.trim()) || t('generate.archetype_name_required') }}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl><Input {...field} aria-label={t('generate.archetype_name')} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <FormField
                        control={form.control}
                        name={`archetypes.${index}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl><Input {...field} aria-label={t('generate.archetype_description')} /></FormControl>
                          </FormItem>
                        )}
                      />
                    </TableCell>
                    {(['ratio', 'dailyActionsMin', 'dailyActionsMax', 'comment'] as const).map(key => (
                      <TableCell key={key} className="align-top">
                        <FormField
                          control={form.control}
                          name={`archetypes.${index}.${key}`}
                          rules={{
                            validate: (v) => {
                              const ok = positive(v)
                              if (ok !== true)
                                return ok
                              if (key === 'comment' && v > 100)
                                return t('generate.invalid_number')
                              if (key === 'dailyActionsMax' && v < form.getValues(`archetypes.${index}.dailyActionsMin`))
                                return t('generate.invalid_range')
                              return true
                            },
                          }}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  min={0}
                                  max={key === 'comment' ? 100 : undefined}
                                  step={key === 'ratio' || key === 'comment' ? 1 : 0.1}
                                  className="w-20"
                                  value={Number.isNaN(field.value) ? '' : field.value}
                                  onChange={e => field.onChange(numberValue(e))}
                                  onBlur={field.onBlur}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="align-top">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={archetypes.fields.length <= 1}
                        aria-label={t('generate.remove_archetype')}
                        onClick={() => archetypes.remove(index)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="interests"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('generate.interests')}</FormLabel>
                <FormControl><Textarea {...field} rows={3} placeholder={t('generate.interests_placeholder')} /></FormControl>
                <FormDescription>{t('list_hint')}</FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="blockedTopics"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('generate.blocked_topics')}</FormLabel>
                <FormControl><Textarea {...field} rows={3} placeholder={t('generate.blocked_topics_placeholder')} /></FormControl>
                <FormDescription>{t('list_hint')}</FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="avatarStyle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('generate.avatar_style')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {AVATAR_STYLES.map(style => <SelectItem key={style} value={style}>{`DiceBear · ${style}`}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormDescription>{t('generate.avatar_style_hint')}</FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('generate.language')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PERSONA_LANGUAGES.map(lang => <SelectItem key={lang} value={lang}>{languageNames.of(lang === 'zh-tw' ? 'zh-Hant' : lang === 'zh' ? 'zh-Hans' : lang) ?? lang}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
        </div>

        {preview && (
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t('generate.preview_title', { count: preview.length })}</span>
            {preview.length === 0
              ? <p className="text-sm text-muted-foreground">{t('generate.preview_empty')}</p>
              : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('generate.preview_nickname')}</TableHead>
                          <TableHead>{t('generate.archetype_name')}</TableHead>
                          <TableHead>{t('profile.persona')}</TableHead>
                          <TableHead>{t('profile.interests')}</TableHead>
                          <TableHead>{t('profile.tone')}</TableHead>
                          <TableHead>{t('profile.daily_actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.map((item, i) => (
                          <TableRow key={`${item.nickname}-${i}`}>
                            <TableCell className="font-medium">{item.nickname}</TableCell>
                            <TableCell>{item.archetype}</TableCell>
                            <TableCell className="max-w-72 whitespace-normal" title={(item.styleSamples ?? []).join('\n')}>{item.persona}</TableCell>
                            <TableCell className="whitespace-normal">
                              <div className="flex flex-wrap gap-1">
                                {(item.interests ?? []).map(interest => <Badge key={interest} variant="secondary">{interest}</Badge>)}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-48 whitespace-normal">{item.tone}</TableCell>
                            <TableCell className="tabular-nums">{t('generate.per_day', { count: item.dailyActions })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
          </div>
        )}

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground">{t('generate.cost_hint')}</span>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <Button type="button" variant="outline" disabled={pending !== null} onClick={submit(true)}>
            {pending === 'preview' ? <Loader2 className="animate-spin" /> : <Eye />}
            {t('generate.preview')}
          </Button>
          <Button type="button" disabled={pending !== null} onClick={submit(false)}>
            {pending === 'generate' ? <Loader2 className="animate-spin" /> : <Wand />}
            {t('generate.submit', { count: Number.isFinite(count) ? count : 0 })}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
