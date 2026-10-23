'use client'

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import type { AIPreview, AITarget } from './ai-write-utils'
import type { AIHighlight } from '@/components/tiptap-extension/ai-write-extension'
import type { AIPromptRef, AIWriteMode, AIWriteRequest, AIWriteScope, AIWriteTarget } from '@/models/ai-write'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { streamAIWrite } from '@/api/ai-write'
import { buildAIComponentGuide, convertAIComponentBlocks } from '@/components/content-components/ai-components'
import { AI_PREVIEW_META, aiWritePluginKey } from '@/components/tiptap-extension/ai-write-extension'
import { useStoredState } from '@/hooks/use-storage-state'
import { useErrorMessageT } from '@/hooks/use-translations'
import { repairTagQuotes, restoreMarkTokens, restoreRewriteKeeps, serializeRewriteSelection } from './ai-rewrite-markup'
import { buildMarkedDocument, buildPreview, markdownToSlice, resolveAITarget, syncDocTransaction } from './ai-write-utils'

/**
 * - prompting：等待输入要求
 * - connecting / queued / thinking / streaming：请求中（排队、模型思考、输出内容）
 * - done：生成结束（或被停止），等待接受 / 重新生成 / 放弃
 * - error：出错，可重试
 */
export type AIWriterStatus = 'idle' | 'prompting' | 'connecting' | 'queued' | 'thinking' | 'streaming' | 'done' | 'error'

export interface AIWriterOpenOptions {
  // 不传时按选区判断：有文字选区为润色，否则为帮写
  mode?: AIWriteMode
  prompt?: AIPromptRef
  instruction?: string
  // 打开后立即生成（快捷指令）
  run?: boolean
}

export interface AIWriterState {
  status: AIWriterStatus
  mode: AIWriteMode
  scope: AIWriteScope
  prompt?: AIPromptRef
  instruction: string
  error: string | null
  // 已停止生成（保留已输出的内容）
  stopped: boolean
}

interface AIWriterSession {
  target: AITarget
  baseDoc: PMNode
  baseSelection: Selection
  // 生成前的正文（带标记），每次生成复用
  document: string
  // 润色：选区的格式化表示（扩展 Markdown）与被占位符保护的节点
  selection?: string
  keeps: PMNode[]
  marks: string[]
  preview: AIPreview | null
}

// 只有独立成块的帮写可以插入组件；润色保持原有结构，段落中间与代码块内无法放置组件
function allowsAIComponents(target: { mode: AIWriteMode, scope: AIWriteScope }) {
  return target.mode === 'write' && target.scope === 'block'
}

const IDLE_STATE: AIWriterState = { status: 'idle', mode: 'write', scope: 'block', instruction: '', error: null, stopped: false }

// 生成中预览的最短刷新间隔：内容较长时每帧重新解析 Markdown 开销较大
const RENDER_INTERVAL_MS = 50

export const AI_WRITER_BUSY_STATUSES: AIWriterStatus[] = ['connecting', 'queued', 'thinking', 'streaming']

export interface UseAIWriterOptions {
  editor: Editor
  target: AIWriteTarget
  docId: number | undefined
  // 文章信息取编辑器中的最新值（可能尚未保存）
  getContext: () => Pick<AIWriteRequest, 'title' | 'description' | 'category' | 'labels'>
  // 会话期间锁定编辑器并暂停自动保存
  onBusyChange: (busy: boolean) => void
}

/**
 * 编辑器 AI 写作（帮写 / 润色）：
 * - 打开时记录目标位置与生成前的文档，并锁定编辑器
 * - 生成中把已输出的 Markdown 转为编辑器内容实时写入（不进入撤销历史、不触发自动保存）
 * - 接受时先还原为生成前的文档，再以一次可撤销的修改写入最终内容，撤销一次即可回到生成前
 * - 放弃时还原为生成前的文档与选区
 */
export function useAIWriter({ editor, target: contentTarget, docId, getContext, onBusyChange }: UseAIWriterOptions) {
  const t = useTranslations('Console.editor.ai')
  const errorMessageT = useErrorMessageT()
  const [state, setState] = React.useState<AIWriterState>(IDLE_STATE)
  const stateRef = React.useRef(state)
  stateRef.current = state
  const sessionRef = React.useRef<AIWriterSession | null>(null)
  // 是否附带全文上下文：默认不附带，选择记在浏览器中
  const [includeContext, setIncludeContext] = useStoredState('neo-editor-ai-include-context', false)
  const includeContextRef = React.useRef(includeContext)
  includeContextRef.current = includeContext
  const abortRef = React.useRef<AbortController | null>(null)
  const latestRef = React.useRef({ getContext, onBusyChange, docId, contentTarget })
  latestRef.current = { getContext, onBusyChange, docId, contentTarget }

  /** 以预览事务修改编辑器：不进入撤销历史、不触发自动保存与自动链接 */
  const dispatchPreview = React.useCallback((doc: PMNode | null, highlight: AIHighlight | null) => {
    if (editor.isDestroyed)
      return
    const tr = doc ? syncDocTransaction(editor.state, doc) : editor.state.tr
    tr.setMeta(aiWritePluginKey, highlight)
      .setMeta(AI_PREVIEW_META, true)
      .setMeta('addToHistory', false)
      .setMeta('preventAutolink', true)
    editor.view.dispatch(tr)
  }, [editor])

  const renderPreview = React.useCallback((markdown: string, streaming: boolean) => {
    const session = sessionRef.current
    if (!session)
      return
    // 占位符还原为原节点；生成结束时补回模型遗漏的节点，生成中不补，避免末尾闪现
    const structured = session.selection !== undefined
    const source = structured ? repairTagQuotes(markdown) : markdown
    // 润色还原编号标签；独立成块的帮写把组件代码块转换为组件块（不合法的降级为普通段落）
    const transform = structured
      ? (body: HTMLElement) => restoreMarkTokens(body, session.marks)
      : allowsAIComponents(session.target) ? convertAIComponentBlocks : undefined
    const parsed = markdownToSlice(editor.schema, source, session.target.scope, transform)
    const slice = restoreRewriteKeeps(parsed, session.keeps, editor.schema, !streaming)
    const preview = buildPreview(session.baseDoc, session.target, slice)
    session.preview = preview
    dispatchPreview(preview.doc, { from: preview.from, to: preview.to, kind: streaming ? 'generating' : 'generated' })
  }, [editor, dispatchPreview])

  /** 还原为生成前的文档，并标出目标位置 */
  const restoreBase = React.useCallback(() => {
    const session = sessionRef.current
    if (!session)
      return
    session.preview = null
    dispatchPreview(session.baseDoc, { from: session.target.from, to: session.target.to, kind: 'target' })
  }, [dispatchPreview])

  const finish = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    sessionRef.current = null
    setState(IDLE_STATE)
    latestRef.current.onBusyChange(false)
    if (!editor.isDestroyed)
      window.setTimeout(() => editor.commands.focus(), 0)
  }, [editor])

  const run = React.useCallback(async ({ prompt, instruction }: { prompt?: AIPromptRef, instruction: string }) => {
    const session = sessionRef.current
    const { docId: id, contentTarget: target, getContext: getCtx } = latestRef.current
    if (!session || !id)
      return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    restoreBase()
    setState(prev => ({ ...prev, status: 'connecting', prompt, instruction, error: null, stopped: false }))

    let markdown = ''
    let finished = false
    let streamError: string | null = null
    let lastRender = 0
    let timer: number | null = null
    const flush = () => {
      timer = null
      lastRender = performance.now()
      renderPreview(markdown, true)
    }
    const scheduleRender = () => {
      if (timer !== null)
        return
      timer = window.setTimeout(flush, Math.max(0, RENDER_INTERVAL_MS - (performance.now() - lastRender)))
    }
    const cancelRender = () => {
      if (timer !== null)
        window.clearTimeout(timer)
      timer = null
    }

    try {
      await streamAIWrite({
        target,
        id,
        signal: controller.signal,
        request: {
          mode: session.target.mode,
          scope: session.target.scope,
          promptId: prompt?.id,
          instruction,
          document: session.document,
          selection: session.selection,
          // 独立成块的帮写可以插入白名单组件，附上组件说明
          components: allowsAIComponents(session.target) ? buildAIComponentGuide() : undefined,
          includeContext: includeContextRef.current,
          ...getCtx(),
        },
        onEvent: (event) => {
          if (controller.signal.aborted)
            return
          switch (event.event) {
            case 'queued':
            case 'thinking':
              setState(prev => (prev.status === 'streaming' ? prev : { ...prev, status: event.event as AIWriterStatus }))
              break
            case 'delta':
              markdown += event.text
              setState(prev => (prev.status === 'streaming' ? prev : { ...prev, status: 'streaming' }))
              scheduleRender()
              break
            case 'done':
              finished = true
              break
            case 'error':
              streamError = event.message
              break
          }
        },
      })
      cancelRender()
      if (abortRef.current !== controller)
        return
      if (streamError !== null || !finished)
        throw new Error(streamError || 'ai_interrupted')
      renderPreview(markdown, false)
      setState(prev => ({ ...prev, status: 'done' }))
    }
    catch (error) {
      cancelRender()
      // 被新的生成取代或会话已关闭
      if (abortRef.current !== controller)
        return
      if (controller.signal.aborted) {
        // 用户停止：保留已生成的内容等待处理；尚无内容时回到输入状态
        if (markdown.trim()) {
          renderPreview(markdown, false)
          setState(prev => ({ ...prev, status: 'done', stopped: true }))
        }
        else {
          restoreBase()
          setState(prev => ({ ...prev, status: 'prompting' }))
        }
        return
      }
      restoreBase()
      setState(prev => ({ ...prev, status: 'error', error: errorMessageT(error) || t('failed') }))
    }
  }, [renderPreview, restoreBase, errorMessageT, t])

  const open = React.useCallback((options: AIWriterOpenOptions = {}) => {
    if (sessionRef.current || editor.isDestroyed || !editor.isEditable || !latestRef.current.docId)
      return
    const { selection } = editor.state
    const mode = options.mode ?? (selection.empty || selection instanceof NodeSelection ? 'write' : 'rewrite')
    const target = resolveAITarget(editor.state, mode)
    if (!target) {
      toast.warning(t('need_selection'))
      return
    }
    // 润色时把选区序列化为保留格式的标记文本（代码块内的选区仍按纯文本处理）
    const rewrite = mode === 'rewrite' && target.scope !== 'code'
      ? serializeRewriteSelection(editor.state.doc, editor.schema, target.from, target.to)
      : null
    sessionRef.current = {
      target,
      baseDoc: editor.state.doc,
      baseSelection: editor.state.selection,
      document: buildMarkedDocument(editor.state.doc, editor.schema, target),
      selection: rewrite?.markup,
      keeps: rewrite?.keeps ?? [],
      marks: rewrite?.marks ?? [],
      preview: null,
    }
    latestRef.current.onBusyChange(true)
    dispatchPreview(null, { from: target.from, to: target.to, kind: 'target' })
    setState({ ...IDLE_STATE, status: 'prompting', mode, scope: target.scope, prompt: options.prompt, instruction: options.instruction ?? '' })
    if (options.run)
      void run({ prompt: options.prompt, instruction: options.instruction ?? '' })
  }, [editor, dispatchPreview, run, t])

  /** 停止生成，保留已输出的内容 */
  const stop = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** 接受：还原后以一次可撤销的修改写入最终内容，光标移到生成内容末尾 */
  const accept = React.useCallback(() => {
    const session = sessionRef.current
    if (!session)
      return
    abortRef.current?.abort()
    abortRef.current = null
    const preview = session.preview
    if (preview && !editor.isDestroyed) {
      dispatchPreview(session.baseDoc, null)
      const tr = syncDocTransaction(editor.state, preview.doc)
      const end = Math.min(preview.to, tr.doc.content.size)
      tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1)).setMeta(aiWritePluginKey, null).scrollIntoView()
      editor.view.dispatch(tr)
    }
    else {
      dispatchPreview(null, null)
    }
    finish()
  }, [editor, dispatchPreview, finish])

  /** 放弃：还原为生成前的文档与选区 */
  const discard = React.useCallback(() => {
    const session = sessionRef.current
    if (!session)
      return
    abortRef.current?.abort()
    abortRef.current = null
    if (!editor.isDestroyed) {
      dispatchPreview(session.baseDoc, null)
      const selection = session.baseSelection.map(editor.state.doc, editor.state.tr.mapping)
      editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory', false))
    }
    finish()
  }, [editor, dispatchPreview, finish])

  const retry = React.useCallback(() => {
    const { prompt, instruction } = stateRef.current
    void run({ prompt, instruction })
  }, [run])

  /** 回到输入状态修改要求（已生成的内容保留到下次生成或放弃时） */
  const edit = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(prev => ({ ...prev, status: 'prompting', error: null }))
  }, [])

  // 卸载时取消请求
  React.useEffect(() => () => abortRef.current?.abort(), [])

  return {
    state,
    includeContext,
    setIncludeContext,
    open,
    run,
    stop,
    accept,
    discard,
    retry,
    edit,
    /** 当前目标 / 生成内容的范围（供面板定位） */
    getRange: () => {
      const highlight = editor.isDestroyed ? null : aiWritePluginKey.getState(editor.state)
      return highlight ? { from: highlight.from, to: highlight.to } : null
    },
    hasPreview: () => Boolean(sessionRef.current?.preview),
  }
}

export type AIWriterController = ReturnType<typeof useAIWriter>
