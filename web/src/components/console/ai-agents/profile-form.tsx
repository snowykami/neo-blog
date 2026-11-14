'use client'

import type { Control, FieldPathByValue } from 'react-hook-form'
import type { AIAgent, AIAgentProfile, AIAgentSelfEditField, AIAgentTier, AIAgentTrigger } from '@/models/ai-agent'
import { Bot, Brain, Check, ChevronsUpDown, Clock, Gauge, Loader2, Shield, SlidersHorizontal, Wand } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { updateAIAgent } from '@/api/ai-agent'
import { TimeZoneCombobox } from '@/components/common/time-zone-combobox'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { AI_AGENT_SELF_EDIT_FIELDS, AI_AGENT_TRIGGERS } from '@/models/ai-agent'
import { isValidTimeZone } from '@/utils/common/time-zone'
import { TierToggle } from './create-agent-dialog'
import { linesToList, listToLines, triggerKey, useAIAgentT } from './shared'

// 作息：逗号分隔的小时区间，如 9-12,20-24；跨零点写成 22-2
const ACTIVE_HOURS_PATTERN = /^\s*\d{1,2}\s*-\s*\d{1,2}(?:\s*,\s*\d{1,2}\s*-\s*\d{1,2})*\s*$/
// 主要输出语言：BCP 47 语言代码（与后端 internal/service/ai_agent.go 的 NormalizeAgentLanguage 一致）
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?$/
const PROFILE_LANGUAGE_PRESETS = ['zh', 'zh-tw', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'ar', 'vi', 'th', 'id', 'yue'] as const
const ZH_SIMPLIFIED_ALIASES = new Set(['zh', 'zh-cn', 'zh-sg', 'zh-my', 'zh-hans', 'zh-hans-cn', 'zh-hans-sg'])
const ZH_TRADITIONAL_ALIASES = new Set(['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant', 'zh-hant-tw', 'zh-hant-hk', 'zh-hant-mo'])
// 与后端一致（internal/service/ai_agent.go 的 agentPersonaMaxRunes），导入的长人设也能编辑保存
const PERSONA_MAX = 2000

// 表单值：数组字段以「每行一条」的文本编辑，提交时再拆分
export interface ProfileFormValues {
  tier: AIAgentTier
  archetype: string
  language: string
  persona: string
  interests: string
  expertise: string
  tone: string
  styleSamples: string
  blockedTopics: string
  modelOverride: string
  activity: AIAgentProfile['activity']
  behavior: AIAgentProfile['behavior']
  limits: AIAgentProfile['limits']
  triggers: AIAgentTrigger[]
  aiInteraction: AIAgentProfile['aiInteraction']
  selfEdit: AIAgentProfile['selfEdit']
  memory: AIAgentProfile['memory']
  webFetch: { enabled: boolean, allowedDomains: string }
}

export function toFormValues(agent: AIAgent): ProfileFormValues {
  const p = agent.profile
  return {
    tier: agent.tier,
    archetype: p.archetype ?? '',
    language: p.language ?? '',
    persona: p.persona ?? '',
    interests: listToLines(p.interests),
    expertise: listToLines(p.expertise),
    tone: p.tone ?? '',
    styleSamples: listToLines(p.styleSamples),
    blockedTopics: listToLines(p.blockedTopics),
    modelOverride: p.modelOverride ?? '',
    activity: { ...p.activity },
    behavior: { ...p.behavior },
    limits: { ...p.limits },
    triggers: [...(p.triggers ?? [])],
    aiInteraction: { ...p.aiInteraction },
    selfEdit: { ...p.selfEdit, fields: [...(p.selfEdit?.fields ?? [])] },
    memory: { ...p.memory },
    webFetch: { enabled: p.webFetch?.enabled ?? false, allowedDomains: listToLines(p.webFetch?.allowedDomains) },
  }
}

function toProfile(values: ProfileFormValues): AIAgentProfile {
  return {
    archetype: values.archetype.trim(),
    language: normalizeLanguageCode(values.language),
    persona: values.persona.trim(),
    interests: linesToList(values.interests),
    expertise: linesToList(values.expertise),
    tone: values.tone.trim(),
    styleSamples: linesToList(values.styleSamples, false),
    blockedTopics: linesToList(values.blockedTopics),
    modelOverride: values.modelOverride.trim(),
    activity: { ...values.activity, activeHours: values.activity.activeHours.trim(), timezone: values.activity.timezone.trim() },
    behavior: values.behavior,
    limits: values.limits,
    triggers: values.triggers,
    aiInteraction: values.aiInteraction,
    selfEdit: { ...values.selfEdit, hint: values.selfEdit.hint.trim() },
    memory: values.memory,
    webFetch: { enabled: values.webFetch.enabled, allowedDomains: linesToList(values.webFetch.allowedDomains) },
  }
}

function normalizeLanguageCode(raw: string) {
  const code = raw.trim().toLowerCase().replaceAll('_', '-')
  if (ZH_SIMPLIFIED_ALIASES.has(code))
    return 'zh'
  if (ZH_TRADITIONAL_ALIASES.has(code))
    return 'zh-tw'
  return code
}

function formatLanguageLabel(displayNames: Intl.DisplayNames | null, code: string) {
  if (!code || !displayNames)
    return code
  const lookup = code === 'zh' ? 'zh-Hans' : code === 'zh-tw' ? 'zh-Hant' : code
  try {
    return displayNames.of(lookup) ?? code
  }
  catch {
    return code
  }
}

// 主要输出语言选择器：支持常用预设与任意合法 BCP 47 语言代码
function PersonaLanguageCombobox({ value, onChange }: {
  value: string
  onChange: (value: string) => void
}) {
  const t = useAIAgentT()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' })
    }
    catch {
      return null
    }
  }, [locale])

  const normalizedValue = normalizeLanguageCode(value)
  const options = useMemo(() => {
    const codes: string[] = [...PROFILE_LANGUAGE_PRESETS]
    if (normalizedValue && !codes.includes(normalizedValue))
      codes.unshift(normalizedValue)
    return codes.map(code => ({
      code,
      label: formatLanguageLabel(displayNames, code),
    }))
  }, [displayNames, normalizedValue])

  const customCandidate = normalizeLanguageCode(query)
  const showCustom = Boolean(customCandidate)
    && LANGUAGE_CODE_PATTERN.test(customCandidate)
    && !options.some(option => option.code === customCandidate)

  const selected = options.find(option => option.code === normalizedValue)
  const selectValue = (next: string) => {
    onChange(next)
    setQuery('')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen)
          setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] font-normal', !normalizedValue && 'text-muted-foreground')}
        >
          <span className="truncate text-left">
            {normalizedValue
              ? (
                  <>
                    {selected?.label ?? normalizedValue}
                    {selected && selected.label !== normalizedValue && (
                      <span className="ml-2 text-xs text-muted-foreground">{normalizedValue}</span>
                    )}
                  </>
                )
              : t('profile.language_auto')}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('profile.language_search')} className="h-9" />
          <CommandList>
            <CommandEmpty>{t('profile.language_empty')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__auto__"
                keywords={[t('profile.language_auto'), 'auto', 'default']}
                onSelect={() => selectValue('')}
              >
                <span className="truncate text-muted-foreground">{t('profile.language_auto')}</span>
                <Check className={cn('ml-auto', !normalizedValue ? 'opacity-100' : 'opacity-0')} />
              </CommandItem>
              {options.map(option => (
                <CommandItem
                  key={option.code}
                  value={option.code}
                  keywords={[option.label, option.code]}
                  onSelect={() => selectValue(option.code)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{option.label}</span>
                    {option.label !== option.code && (
                      <span className="text-xs text-muted-foreground">{option.code}</span>
                    )}
                  </span>
                  <Check className={cn('ml-auto', normalizedValue === option.code ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
              {showCustom && (
                <CommandItem
                  value={customCandidate}
                  keywords={[query, customCandidate, t('profile.language_use_code', { code: customCandidate })]}
                  onSelect={() => selectValue(customCandidate)}
                >
                  <span className="truncate">{t('profile.language_use_code', { code: customCandidate })}</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Section({ icon: Icon, title, description, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  )
}

type NumberPath = FieldPathByValue<ProfileFormValues, number>

// 数字输入：空值时保留 NaN 交给校验提示
function NumberField({ control, name, label, description, min, max, step = 1 }: {
  control: Control<ProfileFormValues>
  name: NumberPath
  label: string
  description?: string
  min?: number
  max?: number
  step?: number
}) {
  const t = useAIAgentT()
  return (
    <FormField
      control={control}
      name={name}
      rules={{
        validate: (v) => {
          const n = v
          if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max))
            return t('profile.invalid_range', { min: min ?? '-', max: max ?? '-' })
          if (step === 1 && !Number.isInteger(n))
            return t('profile.invalid_integer')
          return true
        },
      }}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={min}
              max={max}
              step={step}
              value={Number.isNaN(field.value) ? '' : field.value}
              onChange={e => field.onChange(e.target.value === '' ? Number.NaN : e.target.valueAsNumber)}
              onBlur={field.onBlur}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

// 0~1 的倾向 / 概率：滑块以百分比显示
function RatioSlider({ control, name, label, description, max = 1, step = 0.01, percent = true }: {
  control: Control<ProfileFormValues>
  name: NumberPath
  label: string
  description?: string
  max?: number
  step?: number
  percent?: boolean
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = Number(field.value) || 0
        return (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{label}</FormLabel>
              <span className="text-sm text-muted-foreground tabular-nums">{percent ? `${Math.round(value * 100)}%` : value.toFixed(1)}</span>
            </div>
            <FormControl>
              <Slider min={0} max={max} step={step} value={[value]} onValueChange={([v]) => field.onChange(v)} aria-label={label} />
            </FormControl>
            {description && <FormDescription>{description}</FormDescription>}
          </FormItem>
        )
      }}
    />
  )
}

function SwitchField({ control, name, label, description }: {
  control: Control<ProfileFormValues>
  name: 'aiInteraction.enabled' | 'selfEdit.enabled' | 'memory.rememberPeople' | 'webFetch.enabled'
  label: string
  description?: string
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div className="grid gap-1">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

// 多选：以复选框表示，值为字符串数组
function CheckboxGroup<T extends string>({ value, options, onChange, label }: {
  value: T[]
  options: readonly T[]
  onChange: (value: T[]) => void
  label: (option: T) => string
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map(option => (
        <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={value.includes(option)}
            onCheckedChange={checked => onChange(checked ? [...value, option] : value.filter(item => item !== option))}
          />
          {label(option)}
        </label>
      ))}
    </div>
  )
}

function TextListField({ control, name, label, description, placeholder, rows = 3 }: {
  control: Control<ProfileFormValues>
  name: 'interests' | 'expertise' | 'styleSamples' | 'blockedTopics' | 'webFetch.allowedDomains'
  label: string
  description?: string
  placeholder?: string
  rows?: number
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl><Textarea {...field} rows={rows} placeholder={placeholder} /></FormControl>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

// 性格设置：覆盖性格档案的全部字段与类型
export function AgentProfileForm({ agent, onSaved }: { agent: AIAgent, onSaved: (agent: AIAgent) => void }) {
  const t = useAIAgentT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const form = useForm<ProfileFormValues>({ defaultValues: toFormValues(agent) })
  const { control } = form
  const [tier, aiInteractionEnabled, selfEditEnabled, rememberPeople, webFetchEnabled] = useWatch({
    control,
    name: ['tier', 'aiInteraction.enabled', 'selfEdit.enabled', 'memory.rememberPeople', 'webFetch.enabled'],
  })

  const onSubmit = async (values: ProfileFormValues) => {
    try {
      const res = await updateAIAgent(agent.id, { tier: values.tier, profile: toProfile(values) })
      toast.success(operationT('save_success'))
      // 保存后以服务端返回的档案为准重置表单（暂停 / 恢复等其他操作不会重置未保存的修改）
      form.reset(toFormValues(res.data))
      onSaved(res.data)
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('save_failed')))
    }
  }

  return (
    <Form {...form}>
      <form noValidate className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Section icon={Bot} title={t('profile.section_persona')} description={t('profile.section_persona_desc')}>
          <FormField
            control={control}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={control}
              name="archetype"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profile.archetype')}</FormLabel>
                  <FormControl><Input {...field} placeholder={t('profile.archetype_placeholder')} /></FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="language"
              rules={{
                validate: (v) => {
                  const normalized = normalizeLanguageCode(v)
                  return !normalized || LANGUAGE_CODE_PATTERN.test(normalized) || t('profile.invalid_language')
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profile.language')}</FormLabel>
                  <FormControl>
                    <PersonaLanguageCombobox value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>{t('profile.language_desc')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={control}
            name="tone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.tone')}</FormLabel>
                <FormControl><Input {...field} placeholder={t('profile.tone_placeholder')} /></FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="persona"
            rules={{ validate: v => v.trim().length <= PERSONA_MAX || t('profile.too_long', { max: PERSONA_MAX }) }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.persona')}</FormLabel>
                <FormControl><Textarea {...field} rows={4} /></FormControl>
                <FormDescription>{t('profile.persona_desc', { max: PERSONA_MAX })}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextListField control={control} name="interests" label={t('profile.interests')} description={t('profile.interests_desc')} />
            <TextListField control={control} name="expertise" label={t('profile.expertise')} description={t('profile.expertise_desc')} />
          </div>
          <TextListField control={control} name="styleSamples" label={t('profile.style_samples')} description={t('profile.style_samples_desc')} rows={4} />
          <FormField
            control={control}
            name="modelOverride"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.model_override')}</FormLabel>
                <FormControl><Input {...field} placeholder={t('profile.model_override_placeholder')} /></FormControl>
                <FormDescription>{t('profile.model_override_desc')}</FormDescription>
              </FormItem>
            )}
          />
        </Section>

        <Section icon={Clock} title={t('profile.section_activity')} description={t('profile.section_activity_desc')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <RatioSlider control={control} name="activity.dailyActions" label={t('profile.daily_actions')} max={20} step={0.1} percent={false} description={t('profile.daily_actions_desc')} />
            <RatioSlider control={control} name="activity.weekendFactor" label={t('profile.weekend_factor')} max={3} step={0.1} percent={false} description={t('profile.weekend_factor_desc')} />
            <FormField
              control={control}
              name="activity.activeHours"
              rules={{
                validate: (v) => {
                  if (!v.trim())
                    return true
                  if (!ACTIVE_HOURS_PATTERN.test(v))
                    return t('profile.invalid_active_hours')
                  const hours = v.match(/\d+/g)?.map(Number) ?? []
                  return hours.every(h => h >= 0 && h <= 24) || t('profile.invalid_active_hours')
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profile.active_hours')}</FormLabel>
                  <FormControl><Input {...field} placeholder="9-12,20-24" /></FormControl>
                  <FormDescription>{t('profile.active_hours_desc')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="activity.timezone"
              rules={{ validate: v => isValidTimeZone(v) || t('profile.invalid_timezone') }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profile.timezone')}</FormLabel>
                  <FormControl><TimeZoneCombobox value={field.value} onChange={field.onChange} /></FormControl>
                  <FormDescription>{t('profile.timezone_desc')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Section>

        <Section icon={SlidersHorizontal} title={t('profile.section_behavior')} description={t('profile.section_behavior_desc')}>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <RatioSlider control={control} name="behavior.lurk" label={t('profile.lurk')} />
            <RatioSlider control={control} name="behavior.like" label={t('profile.like')} />
            <RatioSlider control={control} name="behavior.comment" label={t('profile.comment')} />
            <RatioSlider control={control} name="behavior.replyProbability" label={t('profile.reply_probability')} />
            <RatioSlider control={control} name="behavior.digOldPosts" label={t('profile.dig_old_posts')} description={t('profile.dig_old_posts_desc')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="behavior.delayMinMinutes" label={t('profile.delay_min')} min={0} />
            <FormField
              control={control}
              name="behavior.delayMaxMinutes"
              rules={{
                validate: v => (Number.isInteger(v) && v >= form.getValues('behavior.delayMinMinutes')) || t('profile.invalid_delay'),
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profile.delay_max')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={e => field.onChange(e.target.value === '' ? Number.NaN : e.target.valueAsNumber)}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormDescription>{t('profile.delay_desc')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Section>

        <Section icon={Gauge} title={t('profile.section_limits')} description={t('profile.section_limits_desc')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField control={control} name="limits.commentsPerDay" label={t('profile.comments_per_day')} min={0} />
            <NumberField control={control} name="limits.likesPerDay" label={t('profile.likes_per_day')} min={0} />
            <NumberField control={control} name="limits.commentsPerPost" label={t('profile.comments_per_post')} min={0} />
            <NumberField control={control} name="limits.cooldownMinutes" label={t('profile.cooldown_minutes')} min={0} />
          </div>
        </Section>

        <Section icon={Shield} title={t('profile.section_triggers')} description={t('profile.section_triggers_desc')}>
          <FormField
            control={control}
            name="triggers"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.triggers')}</FormLabel>
                <CheckboxGroup value={field.value} options={AI_AGENT_TRIGGERS} onChange={field.onChange} label={item => t(`trigger.${triggerKey(item)}`)} />
                <FormDescription>{t('profile.triggers_desc')}</FormDescription>
              </FormItem>
            )}
          />
          <TextListField control={control} name="blockedTopics" label={t('profile.blocked_topics')} description={t('list_hint')} />
          <SwitchField control={control} name="aiInteraction.enabled" label={t('profile.ai_interaction')} description={t('profile.ai_interaction_desc')} />
          {aiInteractionEnabled && (
            <RatioSlider control={control} name="aiInteraction.baseProbability" label={t('profile.ai_base_probability')} description={t('profile.ai_base_probability_desc')} />
          )}
          <SwitchField control={control} name="webFetch.enabled" label={t('profile.web_fetch')} description={tier === 'expert' ? t('profile.web_fetch_desc') : t('profile.web_fetch_expert_only')} />
          {webFetchEnabled && (
            <TextListField control={control} name="webFetch.allowedDomains" label={t('profile.allowed_domains')} description={t('profile.allowed_domains_desc')} placeholder="go.dev" />
          )}
        </Section>

        <Section icon={Wand} title={t('profile.section_self_edit')} description={t('profile.section_self_edit_desc')}>
          <SwitchField control={control} name="selfEdit.enabled" label={t('profile.self_edit')} description={t('profile.self_edit_desc')} />
          {selfEditEnabled && (
            <>
              <FormField
                control={control}
                name="selfEdit.fields"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('profile.self_edit_fields')}</FormLabel>
                    <CheckboxGroup<AIAgentSelfEditField> value={field.value} options={AI_AGENT_SELF_EDIT_FIELDS} onChange={field.onChange} label={item => t(`self_edit_field.${item}`)} />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="selfEdit.hint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('profile.self_edit_hint')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('profile.self_edit_hint_placeholder')} /></FormControl>
                    <FormDescription>{t('profile.self_edit_hint_desc')}</FormDescription>
                  </FormItem>
                )}
              />
            </>
          )}
        </Section>

        <Section icon={Brain} title={t('profile.section_memory')} description={t('profile.section_memory_desc')}>
          <SwitchField control={control} name="memory.rememberPeople" label={t('profile.remember_people')} description={t('profile.remember_people_desc')} />
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField control={control} name="memory.retentionDays" label={t('profile.retention_days')} description={t('profile.retention_days_desc')} min={0} />
            <NumberField control={control} name="memory.maxItems" label={t('profile.max_items')} min={0} />
            {rememberPeople && (
              <RatioSlider control={control} name="memory.milestoneFamiliarity" label={t('profile.milestone_familiarity')} description={t('profile.milestone_familiarity_desc')} />
            )}
          </div>
        </Section>

        {/* 保存栏：滚动时固定在底部 */}
        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t bg-background/90 py-3 backdrop-blur">
          {form.formState.isDirty && <span className="text-sm text-muted-foreground">{t('profile.unsaved')}</span>}
          <Button type="button" variant="outline" disabled={!form.formState.isDirty || form.formState.isSubmitting} onClick={() => form.reset()}>
            {operationT('reset')}
          </Button>
          <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {operationT('save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
