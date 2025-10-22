'use client'

import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import { Check, ChevronsUpDown, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getLabels } from '@/api/label'
import { getCategories } from '@/api/post'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import {
  CreateOrUpdateCategoryDialogWithButton,
  CreateOrUpdateLabelDialogWithButton,
} from './create-label-and-category'

export function PostCategorySelector({
  category,
  onCategoryChange,
}: {
  category: Category | null
  onCategoryChange: (category: Category | null) => void
}) {
  const t = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const [items, setItems] = useState<Category[]>([])
  const [open, setOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    getCategories()
      .then((res) => {
        setItems(res.data.categories)
      })
      .catch(() => { })
  }, [refreshKey])

  return (
    <FormField
      name="category"
      render={() => (
        <FormItem>
          <FormLabel>{t('post_category')}</FormLabel>
          <FormControl>
            <Popover open={open} onOpenChange={setOpen} modal={true}>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      role="combobox"
                      aria-expanded={open}
                      className={cn(
                        'w-full h-auto py-2 justify-between text-left',
                        !category && 'text-muted-foreground',
                      )}
                    >
                      {category ? `${category.name} (${category.slug})` : t('select_category')}
                      <ChevronsUpDown className="ml-2 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                </div>
                <div className="flex-shrink-0">
                  <CreateOrUpdateCategoryDialogWithButton
                    category={null}
                    buttonSize="default"
                    onSaved={() => setRefreshKey(k => k + 1)}
                  />
                </div>
              </div>
              <PopoverContent className="w-[240px] p-0">
                <Command>
                  <CommandInput
                    autoFocus={false}
                    placeholder={operationT('search')}
                    className="h-9"
                  />
                  <CommandList>
                    <CommandEmpty>{t('no_category')}</CommandEmpty>
                    <CommandGroup className="max-h-60 overflow-y-auto">
                      {[
                        {
                          id: 0,
                          name: t('uncategorized'),
                          slug: '-',
                          description: '',
                        },
                        ...items,
                      ].map(c => (
                        <CommandItem
                          key={c.id}
                          value={c.name + c.slug}
                          onSelect={() => {
                            onCategoryChange(c)
                            setOpen(false)
                          }}
                        >
                          {c.name}
                          {' '}
                          (
                          {c.slug}
                          )
                          <Check
                            className={cn(
                              'ml-auto',
                              category?.id === c.id ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function PostLabelSelector({
  labels,
  onSelectedLabelsChange,
}: {
  labels: Label[]
  onSelectedLabelsChange: (labels: Label[]) => void
}) {
  const t = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const [items, setItems] = useState<Label[]>([])
  const [open, setOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    getLabels()
      .then((res) => {
        setItems(res?.data?.labels ?? [])
      })
      .catch(() => { })
  }, [refreshKey])

  const toggle = (label: Label) => {
    const exists = (labels ?? []).find(l => l.id === label.id)
    if (exists) {
      onSelectedLabelsChange((labels ?? []).filter(l => l.id !== label.id))
    }
    else {
      onSelectedLabelsChange([...(labels ?? []), label])
    }
  }

  const remove = (label: Label, e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectedLabelsChange((labels ?? []).filter(l => l.id !== label.id))
  }

  // 渲染时也使用安全变量
  const safeItems = items ?? []
  const safeLabels = labels ?? []

  return (
    <FormField
      name="labels"
      render={() => (
        <FormItem>
          <FormLabel>{t('post_labels')}</FormLabel>
          <FormControl>
            <Popover open={open} onOpenChange={setOpen} modal={true}>
              <div className="">
                {/* 标签列表 */}
                <div className="max-h-18 p-2 rounded-lg border overflow-y-auto overflow-x-hidden">
                  <div className="flex flex-wrap gap-2">
                    {safeLabels.length === 0
                      ? (
                          <div className="text-muted-foreground">{t('select_labels')}</div>
                        )
                      : (
                          safeLabels.map(l => (
                            <button
                              key={l.id}
                              type="button"
                              className="inline-flex items-center gap-2 px-2 py-0.5 rounded-lg bg-muted text-sm hover:opacity-90"
                              title={l.name}
                            >
                              <span>{l.name}</span>
                              <XIcon
                                onClick={e => remove(l, e)}
                                className="w-3 h-3 text-muted-foreground"
                              />
                            </button>
                          ))
                        )}
                  </div>
                </div>
                {/* 标签选择器和创建行 */}
                <div className="flex items-center justify-between mt-2">
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      role="combobox"
                      aria-expanded={open}
                      className={cn(
                        'w-auto h-auto py-2 justify-between text-left',
                        safeLabels.length === 0 && 'text-muted-foreground',
                      )}
                    >
                      {t('select_labels')}
                      <ChevronsUpDown className="ml-2 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <div>
                    <CreateOrUpdateLabelDialogWithButton
                      buttonSize="default"
                      label={null}
                      onLabelCreated={() => setRefreshKey(key => key + 1)}
                    />
                  </div>
                </div>
              </div>
              <PopoverContent className="w-auto p-0 overflow-visible">
                <Command>
                  <CommandInput
                    autoFocus={false}
                    placeholder={operationT('search')}
                    className="h-9"
                  />
                  {/* 把滚动限制放在 CommandList 上（真实渲染的容器） */}
                  <CommandList
                    className="max-h-60 overflow-y-auto"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
                    <CommandEmpty>{t('no_label')}</CommandEmpty>
                    <CommandGroup>
                      {safeItems.map(l => (
                        <CommandItem
                          key={l.id}
                          value={l.name + l.slug}
                          onSelect={() => toggle(l)}
                        >
                          {l.name}
                          {' '}
                          (
                          {l.slug}
                          )
                          <Check
                            className={cn(
                              'ml-auto',
                              safeLabels.find(label => label.id === l.id) ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {/* 可选：在这里提供“创建新标签”按钮 */}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
