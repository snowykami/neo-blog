import type { UseFormReturn } from 'react-hook-form'
import type { CoordinatedSaveResult, SaveCoordinator, SaveCoordinatorController } from './floating-save-bar'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import { useBindSaveCoordinator, useSaveCoordinator } from './floating-save-bar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

interface ChildValues {
  text: string
}

function SubForm({
  coordinator,
  initial,
  required,
  onSave,
  onForm,
}: {
  coordinator: SaveCoordinator
  initial: string
  required?: boolean
  onSave: (val: string) => Promise<CoordinatedSaveResult> | CoordinatedSaveResult
  onForm: (form: UseFormReturn<ChildValues>) => void
}) {
  const form = useForm<ChildValues>({ defaultValues: { text: initial } })
  form.register('text', required ? { required: 'required' } : undefined)
  onForm(form)
  useBindSaveCoordinator(coordinator, form, {
    onSaveValues: values => onSave(values.text),
  })
  return null
}

function Harness({
  showB = true,
  requiredB = false,
  saveA,
  saveB,
  onState,
  onForms,
}: {
  showB?: boolean
  requiredB?: boolean
  saveA: (val: string) => Promise<CoordinatedSaveResult> | CoordinatedSaveResult
  saveB: (val: string) => Promise<CoordinatedSaveResult> | CoordinatedSaveResult
  onState: (ctrl: SaveCoordinatorController) => void
  onForms: (forms: { a?: UseFormReturn<ChildValues>, b?: UseFormReturn<ChildValues> }) => void
}) {
  const ctrl = useSaveCoordinator()
  onState(ctrl)
  const forms: { a?: UseFormReturn<ChildValues>, b?: UseFormReturn<ChildValues> } = {}
  return createElement(
    'div',
    null,
    createElement(SubForm, {
      coordinator: ctrl.coordinator,
      initial: 'a0',
      onSave: saveA,
      onForm: (f) => {
        forms.a = f
        onForms(forms)
      },
    }),
    showB
      ? createElement(SubForm, {
          coordinator: ctrl.coordinator,
          initial: 'b0',
          required: requiredB,
          onSave: saveB,
          onForm: (f) => {
            forms.b = f
            onForms(forms)
          },
        })
      : null,
  )
}

describe('多子表单悬浮保存协调器', () => {
  it('聚合多个子表单的脏状态，仅保存已修改项并支持一键撤销', async () => {
    let latestCtrl!: SaveCoordinatorController
    let latestForms: { a?: UseFormReturn<ChildValues>, b?: UseFormReturn<ChildValues> } = {}
    const saveA = vi.fn(async (next: string) => {
      latestForms.a?.reset({ text: next })
      return 'saved' as const
    })
    const saveB = vi.fn(async (next: string) => {
      latestForms.b?.reset({ text: next })
      return 'saved' as const
    })

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(Harness, {
        saveA,
        saveB,
        onState: (c) => { latestCtrl = c },
        onForms: (f) => { latestForms = f },
      }))
    })

    expect(latestCtrl.dirty).toBe(false)

    // 只改动表单 A
    await act(async () => {
      latestForms.a!.setValue('text', 'a1', { shouldDirty: true })
    })
    expect(latestCtrl.dirty).toBe(true)

    // 一键撤销恢复默认值
    await act(async () => {
      latestCtrl.resetAll()
    })
    expect(latestCtrl.dirty).toBe(false)
    expect(latestForms.a!.getValues('text')).toBe('a0')

    // 再次改动表单 A 并统一保存：不应误触发未改动的表单 B
    await act(async () => {
      latestForms.a!.setValue('text', 'a2', { shouldDirty: true })
    })
    let res!: Awaited<ReturnType<SaveCoordinatorController['saveAll']>>
    await act(async () => {
      res = await latestCtrl.saveAll()
    })
    expect(res).toEqual({ savedCount: 1, hasInvalid: false, hasError: false })
    expect(saveA).toHaveBeenCalledTimes(1)
    expect(saveB).not.toHaveBeenCalled()
    expect(latestCtrl.dirty).toBe(false)

    await act(async () => root.unmount())
  })

  it('校验失败时标记 hasInvalid，子表单卸载时自动注销脏状态', async () => {
    let latestCtrl!: SaveCoordinatorController
    let latestForms: { a?: UseFormReturn<ChildValues>, b?: UseFormReturn<ChildValues> } = {}
    const saveA = vi.fn(() => 'saved' as const)
    const saveB = vi.fn(() => 'saved' as const)

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(Harness, {
        showB: true,
        requiredB: true,
        saveA,
        saveB,
        onState: (c) => { latestCtrl = c },
        onForms: (f) => { latestForms = f },
      }))
    })

    // 将必填的表单 B 清空制造脏且非法状态
    await act(async () => {
      latestForms.b!.setValue('text', '', { shouldDirty: true })
    })
    expect(latestCtrl.dirty).toBe(true)

    let res!: Awaited<ReturnType<SaveCoordinatorController['saveAll']>>
    await act(async () => {
      res = await latestCtrl.saveAll()
    })
    expect(res).toEqual({ savedCount: 0, hasInvalid: true, hasError: false })
    expect(saveB).not.toHaveBeenCalled()
    expect(latestCtrl.dirty).toBe(true)

    // 卸载子表单 B 后脏状态自动归零
    await act(async () => {
      root.render(createElement(Harness, {
        showB: false,
        requiredB: true,
        saveA,
        saveB,
        onState: (c) => { latestCtrl = c },
        onForms: (f) => { latestForms = f },
      }))
    })
    expect(latestCtrl.dirty).toBe(false)

    await act(async () => root.unmount())
  })
})
