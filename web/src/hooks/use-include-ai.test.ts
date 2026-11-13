import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { INCLUDE_AI_STORAGE_KEY, resetIncludeAICache, useIncludeAI } from './use-include-ai'

describe('useIncludeAI', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    localStorage.clear()
    resetIncludeAICache()
  })

  it('defaults to true and syncs updates across multiple consumers via a single localStorage key', async () => {
    const snapshots: { a?: boolean, b?: boolean, setA?: (next: boolean) => void } = {}

    function ConsumerA() {
      const [val, setVal] = useIncludeAI()
      snapshots.a = val
      snapshots.setA = setVal
      return React.createElement('span', { 'data-a': String(val) })
    }

    function ConsumerB() {
      const [val] = useIncludeAI()
      snapshots.b = val
      return React.createElement('span', { 'data-b': String(val) })
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(React.Fragment, null, React.createElement(ConsumerA), React.createElement(ConsumerB)))
    })

    expect(snapshots.a).toBe(true)
    expect(snapshots.b).toBe(true)
    expect(localStorage.getItem(INCLUDE_AI_STORAGE_KEY)).toBeNull()

    await act(async () => {
      snapshots.setA?.(false)
    })

    expect(localStorage.getItem(INCLUDE_AI_STORAGE_KEY)).toBe('false')
    expect(snapshots.a).toBe(false)
    expect(snapshots.b).toBe(false)

    await act(async () => {
      snapshots.setA?.(true)
    })

    expect(localStorage.getItem(INCLUDE_AI_STORAGE_KEY)).toBe('true')
    expect(snapshots.a).toBe(true)
    expect(snapshots.b).toBe(true)

    await act(async () => {
      root.unmount()
    })
  })

  it('hydrates stored false preference from localStorage on initial mount', async () => {
    localStorage.setItem(INCLUDE_AI_STORAGE_KEY, 'false')
    resetIncludeAICache()

    let current: boolean | undefined
    function Consumer() {
      const [val] = useIncludeAI()
      current = val
      return null
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(Consumer))
    })

    expect(current).toBe(false)

    await act(async () => {
      root.unmount()
    })
  })
})
