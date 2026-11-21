'use client'

import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useFormContext, useFormState } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'

export interface FloatingSaveBarProps {
  dirty: boolean
  saving?: boolean
  saveDisabled?: boolean
  resetDisabled?: boolean
  onReset: () => void
  onSave?: () => void
  className?: string
}

/**
 * 后台通用悬浮胶囊保存栏：仅在存在未保存更改或正在保存时于视口底部浮起。
 * 放在 `<form>` 内时默认以 `type="submit"` 触发表单提交；跨多子表单协同保存时可传入 `onSave`。
 */
export function FloatingSaveBar({
  dirty,
  saving = false,
  saveDisabled = false,
  resetDisabled = false,
  onReset,
  onSave,
  className,
}: FloatingSaveBarProps) {
  const operationT = useOperationT()

  if (!dirty && !saving)
    return null

  return (
    <div
      className={cn(
        'sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mx-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-full border border-primary/25 bg-card/90 px-4 py-2 shadow-lg backdrop-blur-md animate-in duration-200 fade-in slide-in-from-bottom-2',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
        <span className="truncate font-medium text-foreground">{operationT('unsaved_changes')}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={saving || resetDisabled}
          onClick={onReset}
        >
          {operationT('discard_changes')}
        </Button>
        <Button
          type={onSave ? 'button' : 'submit'}
          size="sm"
          className="rounded-full"
          disabled={saving || saveDisabled}
          onClick={onSave}
        >
          {saving ? operationT('saving') : operationT('save')}
        </Button>
      </div>
    </div>
  )
}

export interface FormFloatingSaveBarProps {
  extraDirty?: boolean
  saving?: boolean
  saveDisabled?: boolean
  resetDisabled?: boolean
  dirtyFieldsRef?: React.RefObject<Record<string, unknown>>
  onReset: () => void
  onSave?: () => void
  className?: string
}

/**
 * 绑定当前 `FormProvider` 的悬浮保存栏：在子组件局部订阅 `isDirty / isSubmitting / dirtyFields`，
 * 避免大型表单顶层读取 `form.formState` 导致每次按键整页重渲染。
 */
export function FormFloatingSaveBar({
  extraDirty = false,
  saving,
  saveDisabled,
  resetDisabled,
  dirtyFieldsRef,
  onReset,
  onSave,
  className,
}: FormFloatingSaveBarProps) {
  const { control } = useFormContext()
  const { isDirty, isSubmitting, dirtyFields } = useFormState({ control })
  if (dirtyFieldsRef) {
    dirtyFieldsRef.current = dirtyFields as Record<string, unknown>
  }

  return (
    <FloatingSaveBar
      dirty={isDirty || extraDirty}
      saving={saving ?? isSubmitting}
      saveDisabled={saveDisabled}
      resetDisabled={resetDisabled}
      onReset={onReset}
      onSave={onSave}
      className={className}
    />
  )
}

export type CoordinatedSaveResult = 'saved' | 'invalid' | 'error' | 'noop'

interface SaveCoordinatorEntry {
  dirty: boolean
  saving: boolean
  save: () => Promise<CoordinatedSaveResult>
  reset: () => void
}

export interface SaveCoordinator {
  register: (id: string, entry: SaveCoordinatorEntry) => void
  unregister: (id: string) => void
}

export interface SaveCoordinatorController {
  coordinator: SaveCoordinator
  dirty: boolean
  saving: boolean
  saveAll: () => Promise<{ savedCount: number, hasInvalid: boolean, hasError: boolean }>
  resetAll: () => void
}

/**
 * 同页多子表单保存协调器（如「个人偏好设置」页同时包含通知偏好、桌面灵动岛端口、AI 写作习惯）：
 * 汇总各子表单脏状态与保存动作，只展示单条底部悬浮保存栏，避免多条胶囊重叠。
 */
export function useSaveCoordinator(): SaveCoordinatorController {
  const entriesRef = useRef<Map<string, SaveCoordinatorEntry>>(new Map())
  const [dirty, setDirty] = useState(false)
  const [subSaving, setSubSaving] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)

  const syncFlags = useCallback(() => {
    let nextDirty = false
    let nextSaving = false
    for (const entry of entriesRef.current.values()) {
      if (entry.dirty)
        nextDirty = true
      if (entry.saving)
        nextSaving = true
    }
    setDirty(prev => (prev === nextDirty ? prev : nextDirty))
    setSubSaving(prev => (prev === nextSaving ? prev : nextSaving))
  }, [])

  const register = useCallback((id: string, entry: SaveCoordinatorEntry) => {
    entriesRef.current.set(id, entry)
    syncFlags()
  }, [syncFlags])

  const unregister = useCallback((id: string) => {
    if (entriesRef.current.delete(id))
      syncFlags()
  }, [syncFlags])

  const coordinator = useMemo<SaveCoordinator>(() => ({ register, unregister }), [register, unregister])

  const resetAll = useCallback(() => {
    for (const entry of entriesRef.current.values()) {
      if (entry.dirty)
        entry.reset()
    }
  }, [])

  const saveAll = useCallback(async () => {
    const targets = [...entriesRef.current.values()].filter(entry => entry.dirty)
    if (targets.length === 0)
      return { savedCount: 0, hasInvalid: false, hasError: false }

    setBatchSaving(true)
    try {
      const results = await Promise.all(targets.map(entry => entry.save()))
      let savedCount = 0
      let hasInvalid = false
      let hasError = false
      for (const res of results) {
        if (res === 'saved')
          savedCount++
        else if (res === 'invalid')
          hasInvalid = true
        else if (res === 'error')
          hasError = true
      }
      return { savedCount, hasInvalid, hasError }
    }
    finally {
      setBatchSaving(false)
    }
  }, [])

  return {
    coordinator,
    dirty,
    saving: batchSaving || subSaving,
    saveAll,
    resetAll,
  }
}

/**
 * 将单个 `react-hook-form` 子表单接入页面级 `SaveCoordinator`。
 * 未传入 `coordinator` 时完全空操作，不影响子组件在弹窗或独立页面的默认用法。
 */
export function useBindSaveCoordinator<TFieldValues extends FieldValues>(
  coordinator: SaveCoordinator | undefined,
  form: UseFormReturn<TFieldValues>,
  options: {
    saving?: boolean
    saveDisabled?: boolean
    onSaveValues: (values: TFieldValues) => Promise<CoordinatedSaveResult> | CoordinatedSaveResult
    onReset?: () => void
  },
) {
  const id = useId()
  const { isDirty, isSubmitting } = useFormState({ control: form.control })
  const optionsRef = useRef(options)
  optionsRef.current = options

  const effectiveDirty = isDirty && !options.saveDisabled
  const effectiveSaving = options.saving ?? isSubmitting

  useEffect(() => {
    if (!coordinator)
      return
    coordinator.register(id, {
      dirty: effectiveDirty,
      saving: effectiveSaving,
      reset: () => {
        if (optionsRef.current.onReset)
          optionsRef.current.onReset()
        else
          form.reset()
      },
      save: () =>
        new Promise<CoordinatedSaveResult>((resolve) => {
          void form.handleSubmit(
            async (values) => {
              const result = await optionsRef.current.onSaveValues(values)
              resolve(result)
            },
            () => resolve('invalid'),
          )()
        }),
    })
  }, [coordinator, effectiveDirty, effectiveSaving, form, id])

  useEffect(() => {
    if (!coordinator)
      return
    return () => coordinator.unregister(id)
  }, [coordinator, id])
}
