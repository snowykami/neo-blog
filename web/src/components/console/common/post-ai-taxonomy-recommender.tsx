'use client'

import type { AITaxonomyNewItem, AITaxonomyPayload, AITaxonomySuggestion } from '@/models/ai-write'
import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import { CheckIcon, Loader2Icon, PlusIcon, RefreshCwIcon, SparklesIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useFormContext } from 'react-hook-form'
import { toast } from 'sonner'
import { suggestPostTaxonomy } from '@/api/ai-write'
import { createLabel } from '@/api/label'
import { Button } from '@/components/ui/button'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { notifyLabelsUpdated } from './post-meta-category-and-label-selector'

interface TaxonomyFormShape {
  category: Category | null
  labels: Label[]
}

export interface PostAITaxonomyRecommenderProps {
  postId: number
  getPayload?: () => AITaxonomyPayload
  className?: string
}

export function PostAITaxonomyRecommender({
  postId,
  getPayload,
  className,
}: PostAITaxonomyRecommenderProps) {
  const t = useTranslations('Console.post_edit')
  const errorMessageT = useErrorMessageT()
  const { watch, setValue } = useFormContext<TaxonomyFormShape>()
  const currentCategory = watch('category')
  const currentLabels = watch('labels') ?? []

  const [loading, setLoading] = React.useState(false)
  const [creatingSlug, setCreatingSlug] = React.useState<string | null>(null)
  const [suggestion, setSuggestion] = React.useState<AITaxonomySuggestion | null>(null)
  const [panelOpen, setPanelOpen] = React.useState(false)

  const handleRecommend = async () => {
    setPanelOpen(true)
    setLoading(true)
    try {
      const res = await suggestPostTaxonomy({
        postId,
        payload: getPayload?.(),
      })
      setSuggestion({
        category: res.data?.category ?? null,
        labels: res.data?.labels ?? [],
        newLabels: res.data?.newLabels ?? [],
      })
    }
    catch (error) {
      toast.error(errorMessageT(error))
      if (!suggestion)
        setPanelOpen(false)
    }
    finally {
      setLoading(false)
    }
  }

  const applyCategory = (cat: Category) => {
    setValue('category', cat, { shouldDirty: true, shouldValidate: true })
  }

  const toggleExistingLabel = (label: Label) => {
    const exists = currentLabels.some(item => item.id === label.id)
    const next = exists
      ? currentLabels.filter(item => item.id !== label.id)
      : [...currentLabels, label]
    setValue('labels', next, { shouldDirty: true, shouldValidate: true })
  }

  const applyAllMatched = () => {
    if (!suggestion)
      return
    if (suggestion.category) {
      setValue('category', suggestion.category, { shouldDirty: true, shouldValidate: true })
    }
    if (suggestion.labels.length > 0) {
      const existingIds = new Set(currentLabels.map(l => l.id))
      const merged = [...currentLabels]
      for (const l of suggestion.labels) {
        if (!existingIds.has(l.id)) {
          existingIds.add(l.id)
          merged.push(l)
        }
      }
      setValue('labels', merged, { shouldDirty: true, shouldValidate: true })
    }
  }

  const handleCreateNewLabel = async (item: AITaxonomyNewItem) => {
    if (creatingSlug)
      return
    setCreatingSlug(item.slug)
    try {
      const res = await createLabel({
        label: {
          name: item.name,
          slug: item.slug,
          tailwindClassName: '',
        },
      })
      const created: Label = {
        id: res.data.id,
        name: item.name,
        slug: item.slug,
        tailwindClassName: '',
      }
      notifyLabelsUpdated()
      setSuggestion(prev => prev
        ? {
            ...prev,
            labels: [...prev.labels, created],
            newLabels: prev.newLabels.filter(n => n.slug !== item.slug),
          }
        : prev)
      if (!currentLabels.some(l => l.id === created.id)) {
        setValue('labels', [...currentLabels, created], { shouldDirty: true, shouldValidate: true })
      }
    }
    catch (error) {
      toast.error(errorMessageT(error))
    }
    finally {
      setCreatingSlug(null)
    }
  }

  const hasAnyItem = !!suggestion && (
    !!suggestion.category
    || suggestion.labels.length > 0
    || suggestion.newLabels.length > 0
  )

  return (
    <div className={cn('grid gap-2', className)}>
      {!panelOpen
        ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void handleRecommend()}
                className="h-7 gap-1.5 px-2.5 text-xs"
              >
                {loading ? <Loader2Icon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5 text-primary" />}
                <span>{t('ai_recommend_taxonomy')}</span>
              </Button>
            </div>
          )
        : (
            <div className="rounded-xl border bg-muted/35 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-medium text-foreground/85">
                  <SparklesIcon className="size-3.5 text-primary" />
                  <span>{t('ai_recommend_taxonomy')}</span>
                </div>
                <div className="flex items-center gap-1">
                  {hasAnyItem && !loading && (suggestion?.category || (suggestion?.labels.length ?? 0) > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={applyAllMatched}
                      className="h-6 px-2 text-xs text-primary hover:text-primary"
                    >
                      {t('ai_taxonomy_apply_all')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={loading}
                    aria-label={t('ai_titles_regenerate')}
                    onClick={() => void handleRecommend()}
                    className="size-6 text-muted-foreground"
                  >
                    <RefreshCwIcon className={cn('size-3', loading && 'animate-spin')} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setPanelOpen(false)}
                    className="size-6 text-muted-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              </div>

              {loading
                ? (
                    <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                      <Loader2Icon className="size-3.5 animate-spin text-primary" />
                      <span>{t('ai_taxonomy_generating')}</span>
                    </div>
                  )
                : !hasAnyItem
                    ? (
                        <p className="pt-2 text-muted-foreground">{t('ai_taxonomy_empty')}</p>
                      )
                    : (
                        <div className="mt-2.5 grid gap-2.5">
                          {suggestion?.category && (
                            <div className="grid gap-1">
                              <span className="text-[11px] text-muted-foreground">{t('ai_taxonomy_category')}</span>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => applyCategory(suggestion.category!)}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors',
                                    currentCategory?.id === suggestion.category.id
                                      ? 'border-primary/40 bg-primary/10 text-primary font-medium'
                                      : 'bg-background hover:bg-accent',
                                  )}
                                >
                                  <span>{suggestion.category.name}</span>
                                  {currentCategory?.id === suggestion.category.id && <CheckIcon className="size-3" />}
                                </button>
                              </div>
                            </div>
                          )}

                          {(suggestion?.labels.length ?? 0) > 0 && (
                            <div className="grid gap-1">
                              <span className="text-[11px] text-muted-foreground">{t('ai_taxonomy_labels')}</span>
                              <div className="flex flex-wrap gap-1.5">
                                {suggestion!.labels.map((label) => {
                                  const selected = currentLabels.some(item => item.id === label.id)
                                  return (
                                    <button
                                      key={label.id}
                                      type="button"
                                      onClick={() => toggleExistingLabel(label)}
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors',
                                        selected
                                          ? 'border-primary/40 bg-primary/10 text-primary font-medium'
                                          : 'bg-background hover:bg-accent',
                                      )}
                                    >
                                      <span>{`#${label.name}`}</span>
                                      {selected && <CheckIcon className="size-3" />}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {(suggestion?.newLabels.length ?? 0) > 0 && (
                            <div className="grid gap-1">
                              <span className="text-[11px] text-muted-foreground">{t('ai_taxonomy_new_labels')}</span>
                              <div className="flex flex-wrap gap-1.5">
                                {suggestion!.newLabels.map((item) => {
                                  const busy = creatingSlug === item.slug
                                  return (
                                    <button
                                      key={item.slug}
                                      type="button"
                                      disabled={!!creatingSlug}
                                      onClick={() => void handleCreateNewLabel(item)}
                                      title={t('ai_taxonomy_create_and_add', { name: item.name })}
                                      className="inline-flex items-center gap-1 rounded-md border border-dashed bg-background/70 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                                    >
                                      {busy ? <Loader2Icon className="size-3 animate-spin" /> : <PlusIcon className="size-3" />}
                                      <span>{item.name}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
            </div>
          )}
    </div>
  )
}
