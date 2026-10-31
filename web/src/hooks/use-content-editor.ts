'use client'

import type { Editor } from '@tiptap/react'
import type { AIWriterOpenOptions } from '@/components/tiptap-editor/use-ai-writer'
import type { Category } from '@/models/category'
import type { Label } from '@/models/label'
import type { PageLayout, PageModel } from '@/models/page'
import type { Post, PostBackground } from '@/models/post'
import { EditorState } from '@tiptap/pm/state'
import { useEditor } from '@tiptap/react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isEditSessionConflict } from '@/api/edit-session'
import { uploadFile } from '@/api/file'
import { getPageById, updatePage } from '@/api/page'
import { getPostById, updatePost } from '@/api/post'
import { batchDeleteRevisions, deleteRevision, discardDraft, restoreRevision } from '@/api/revision'
import { AI_PREVIEW_META } from '@/components/tiptap-extension/ai-write-extension'
import { buildSlashItems, filterSlashItems } from '@/components/tiptap-ui/slash-menu/slash-items'
import { useEditSession } from '@/hooks/use-edit-session'
import { useUnsavedChangesWarning } from '@/hooks/use-editor-helpers'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { createContentExtensions } from '@/lib/tiptap-extensions'

/** 文章背景的默认值：全部留空即沿用全站背景 */
export const EMPTY_BACKGROUND: PostBackground = { image: '', blur: 0, opacity: 1, veil: 0.72, veilColor: '' }

const EMPTY_BACKGROUND_KEYS: (keyof PostBackground)[] = ['image', 'blur', 'opacity', 'veil', 'veilColor']

export type ContentKind = 'post' | 'page'

export type ContentDoc = Post | PageModel

/** 编辑器可编辑的元信息：文章与页面字段的并集，未用到的字段保持默认值 */
export interface ContentMeta {
  title: string
  description: string
  slug: string
  cover: string
  /** 文章专属背景（页面没有这个概念，仅文章设置里出现） */
  background: PostBackground
  isPrivate: boolean
  // 仅文章
  category: Category | null
  labels: Label[]
  top: number
  // 仅页面
  showInNav: boolean
  navOrder: number
  layout: PageLayout
  fullscreen: boolean
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

// 停止输入后自动保存的延迟；定时器作为兜底，同时用于检查编辑会话
const AUTOSAVE_DEBOUNCE_MS = 2000
const AUTOSAVE_INTERVAL_MS = 10_000

interface UpdateArgs {
  id: number
  draftContent?: string
  content?: string
  meta: Partial<ContentMeta>
  sessionId: string | null
}

interface ContentAdapter {
  load: (id: string) => Promise<ContentDoc | null>
  toMeta: (doc: ContentDoc) => ContentMeta
  update: (args: UpdateArgs) => Promise<unknown>
  // 把保存成功的元信息合并回文档对象（用于预览地址、标题等展示）
  mergeMeta: (doc: ContentDoc, meta: Partial<ContentMeta>) => ContentDoc
}

const EMPTY_META: ContentMeta = {
  title: '',
  description: '',
  slug: '',
  cover: '',
  background: EMPTY_BACKGROUND,
  isPrivate: false,
  category: null,
  labels: [],
  top: 0,
  showInNav: false,
  navOrder: 0,
  layout: 'reading',
  fullscreen: false,
}

const postAdapter: ContentAdapter = {
  load: id => getPostById({ id, type: 'draft' }).then(res => res.data),
  toMeta: (doc) => {
    const post = doc as Post
    return {
      ...EMPTY_META,
      title: post.title || '',
      description: post.description || '',
      slug: post.slug || '',
      cover: post.cover || '',
      background: post.background ?? EMPTY_BACKGROUND,
      isPrivate: !!post.isPrivate,
      category: post.category ?? null,
      labels: post.labels ?? [],
      top: post.top || 0,
    }
  },
  update: ({ id, draftContent, content, meta, sessionId }) => {
    const patch: Partial<Post> & Pick<Post, 'id'> = { id }
    if (draftContent !== undefined)
      patch.draftContent = draftContent
    if (content !== undefined) {
      patch.content = content
      patch.type = 'html'
    }
    // 后端忽略空标题，这里不提交，避免误以为已清空
    if (meta.title !== undefined && meta.title.trim())
      patch.title = meta.title.trim()
    if (meta.description !== undefined)
      patch.description = meta.description
    if (meta.slug !== undefined)
      patch.slug = meta.slug.trim()
    if (meta.cover !== undefined)
      patch.cover = meta.cover
    if (meta.background !== undefined)
      patch.background = meta.background
    if (meta.isPrivate !== undefined)
      patch.isPrivate = meta.isPrivate
    if (meta.top !== undefined)
      patch.top = Number(meta.top) || 0
    // 后端约定 categoryId 为 0 表示清空分类，未传表示不修改
    if (meta.category !== undefined)
      patch.categoryId = meta.category?.id ?? 0
    if (meta.labels !== undefined)
      patch.labelIds = meta.labels.map(label => label.id)
    return updatePost({ post: patch, editSessionId: sessionId })
  },
  mergeMeta: (doc, meta) => {
    const { showInNav: _showInNav, navOrder: _navOrder, layout: _layout, fullscreen: _fullscreen, ...rest } = meta
    return { ...(doc as Post), ...rest, slug: meta.slug !== undefined ? meta.slug || null : (doc as Post).slug }
  },
}

const pageAdapter: ContentAdapter = {
  load: id => getPageById({ id, type: 'draft' }).then(res => res.data),
  toMeta: (doc) => {
    const page = doc as PageModel
    return {
      ...EMPTY_META,
      title: page.title || '',
      description: page.description || '',
      slug: page.slug || '',
      cover: page.cover || '',
      isPrivate: !!page.isPrivate,
      showInNav: !!page.showInNav,
      navOrder: page.navOrder || 0,
      layout: page.layout === 'wide' ? 'wide' : 'reading',
      fullscreen: !!page.fullscreen,
    }
  },
  update: ({ id, draftContent, content, meta, sessionId }) => {
    const patch: Partial<PageModel> & Pick<PageModel, 'id'> = { id }
    if (draftContent !== undefined)
      patch.draftContent = draftContent
    if (content !== undefined) {
      patch.content = content
      patch.type = 'html'
    }
    if (meta.title !== undefined && meta.title.trim())
      patch.title = meta.title.trim()
    if (meta.description !== undefined)
      patch.description = meta.description
    if (meta.slug !== undefined && meta.slug.trim())
      patch.slug = meta.slug.trim()
    if (meta.cover !== undefined)
      patch.cover = meta.cover
    if (meta.isPrivate !== undefined)
      patch.isPrivate = meta.isPrivate
    if (meta.showInNav !== undefined)
      patch.showInNav = meta.showInNav
    if (meta.navOrder !== undefined)
      patch.navOrder = Number(meta.navOrder) || 0
    if (meta.layout !== undefined)
      patch.layout = meta.layout
    if (meta.fullscreen !== undefined)
      patch.fullscreen = meta.fullscreen
    return updatePage({ page: patch, editSessionId: sessionId })
  },
  mergeMeta: (doc, meta) => {
    const { category: _category, labels: _labels, top: _top, ...rest } = meta
    return { ...(doc as PageModel), ...rest }
  },
}

const ADAPTERS: Record<ContentKind, ContentAdapter> = { post: postAdapter, page: pageAdapter }

/** 只保留与已保存值不同的字段（分类、标签按 id 比较） */
function diffMeta(next: ContentMeta, saved: ContentMeta): Partial<ContentMeta> | null {
  const patch: Partial<ContentMeta> = {}
  for (const key of Object.keys(next) as (keyof ContentMeta)[]) {
    const a = next[key]
    const b = saved[key]
    let same: boolean
    if (key === 'category')
      same = (next.category?.id ?? 0) === (saved.category?.id ?? 0)
    else if (key === 'labels')
      same = next.labels.map(l => l.id).join(',') === saved.labels.map(l => l.id).join(',')
    // 背景是对象，按字段比较，避免重建出的等价对象被当成「有改动」触发多余保存
    else if (key === 'background')
      same = EMPTY_BACKGROUND_KEYS.every(field => (next.background?.[field] ?? null) === (saved.background?.[field] ?? null))
    else
      same = a === b
    if (!same)
      (patch as Record<string, unknown>)[key] = a
  }
  return Object.keys(patch).length ? patch : null
}

export interface EditorUiActions {
  openLink?: () => void
  openAnnotation?: () => void
  openAI?: (options?: AIWriterOpenOptions) => void
  openComponentLibrary?: () => void
}

/**
 * 文章 / 页面编辑器的共用逻辑：
 * - 创建编辑器实例（共用扩展列表），加载草稿
 * - 编辑会话（申请 / 检查 / 被接管只读 / 接管）
 * - 保存状态机 idle | dirty | saving | saved | error：停止输入约 2 秒后自动保存，10 秒定时兜底，⌘S 立即保存
 * - 标题、摘要与设置面板中的元信息与正文走同一保存路径，只提交有变化的字段
 * - 发布：草稿与正文一起提交
 * - AI 写作期间锁定编辑器并暂停保存，生成中的预览内容不算作修改，接受后再进入正常的保存流程
 */
export function useContentEditor(kind: ContentKind, routeId: string) {
  const adapter = ADAPTERS[kind]
  const t = useTranslations('Console.editor')
  const componentT = useTranslations('ContentComponents')
  const postEditT = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const format = useFormatter()

  const [doc, setDoc] = useState<ContentDoc | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [meta, setMetaState] = useState<ContentMeta>(EMPTY_META)
  const [savedMeta, setSavedMeta] = useState<ContentMeta>(EMPTY_META)
  const [contentDirty, setContentDirty] = useState(false)
  // 本次打开编辑器后是否保存过修改（自动保存也算），决定能否“放弃本次修改”
  const [changedSinceOpen, setChangedSinceOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [publishing, setPublishing] = useState(false)
  // 已保存的草稿与已发布的正文，用于判断“有未发布的修改”
  const [savedHtml, setSavedHtml] = useState<string | null>(null)
  const [publishedHtml, setPublishedHtml] = useState<string | null>(null)

  // 同一内容同时只允许最新打开的编辑页保存，被顶掉后只读
  const editSession = useEditSession(kind, doc?.id ?? 0)
  const { sessionId, status: sessionStatus, markTakenOver, check: checkEditSession } = editSession
  const isTakenOver = sessionStatus === 'taken_over'
  // 被顶掉或会话申请中不保存；申请失败时（如后端未更新）退化为不带会话保存
  const canSave = Boolean(doc) && (sessionStatus === 'active' || sessionStatus === 'error')

  // 供工具栏等 UI 注册弹层打开函数，快捷键通过它打开链接 / 注释编辑
  const uiActionsRef = useRef<EditorUiActions>({})

  // ---------- 编辑器 ----------
  const uploadImage = useCallback(async (file: File) => {
    try {
      const res = await uploadFile({ file })
      return res.data.url
    }
    catch {
      toast.error(postEditT('image_upload_failed'))
      return ''
    }
  }, [postEditT])

  // 扩展只创建一次，文案与回调通过 ref 读取最新值
  const latestRef = useRef({ t, format, uploadImage })
  latestRef.current = { t, format, uploadImage }
  const slashItems = useMemo(
    () => buildSlashItems(t, componentT, date => format.dateTime(date, { dateStyle: 'long' }), () => uiActionsRef.current.openAI?.({ mode: 'write' }), () => uiActionsRef.current.openComponentLibrary?.()),
    [t, componentT, format],
  )
  const slashItemsRef = useRef(slashItems)
  slashItemsRef.current = slashItems

  const extensions = useMemo(() => createContentExtensions({
    upload: file => latestRef.current.uploadImage(file),
    placeholder: ({ nodeName, level }) => nodeName === 'heading'
      ? latestRef.current.t('heading_placeholder', { level: level ?? 1 })
      : latestRef.current.t('body_placeholder'),
    getSlashItems: query => filterSlashItems(slashItemsRef.current, query),
    onOpenLink: () => uiActionsRef.current.openLink?.(),
    onOpenAnnotation: () => uiActionsRef.current.openAnnotation?.(),
    onOpenAI: () => uiActionsRef.current.openAI?.(),
  }), [])

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: false,
    editorProps: {
      attributes: {
        'autocomplete': 'off',
        'autocorrect': 'off',
        'autocapitalize': 'off',
        'spellcheck': 'false',
        'aria-label': kind === 'post' ? postEditT('editor_aria_label') : postEditT('page_editor_aria_label'),
        'class': 'neo-editor-content prose max-w-none dark:prose-invert pangu-autospace',
      },
    },
    extensions,
  }, [])

  // ---------- 加载 ----------
  const applyDoc = useCallback((next: ContentDoc, ed: Editor) => {
    const draft = next.draftContent || next.content || ''
    // 载入内容不进入撤销历史，避免撤销到空文档后被自动保存成空草稿
    ed.chain().setMeta('addToHistory', false).setContent(draft, { emitUpdate: false }).run()
    // 清空撤销历史：恢复版本、放弃修改或接管后，撤销不能再回到载入前的内容
    ed.view.updateState(EditorState.create({ doc: ed.state.doc, plugins: ed.state.plugins }))
    const html = ed.getHTML()
    setSavedHtml(html)
    // 草稿与正文一致时视为已发布；否则记录服务端正文用于比较
    setPublishedHtml(!next.draftContent || next.draftContent === next.content ? html : next.content)
    const nextMeta = adapter.toMeta(next)
    setMetaState(nextMeta)
    setSavedMeta(nextMeta)
    setContentDirty(false)
    setSaveError(null)
    setChangedSinceOpen(false)
    setDoc(next)
  }, [adapter])

  const [pendingDoc, setPendingDoc] = useState<ContentDoc | null>(null)
  const load = useCallback(() => {
    setLoadFailed(false)
    adapter.load(routeId)
      .then((res) => {
        if (!res)
          throw new Error('not found')
        setPendingDoc(res)
      })
      .catch(() => setLoadFailed(true))
  }, [adapter, routeId])

  useEffect(() => {
    load()
  }, [load])

  // 编辑器与数据都就绪后写入内容（只在加载时写入一次，之后修改元信息不会覆盖正文）
  useEffect(() => {
    if (!editor || !pendingDoc)
      return
    const timer = window.setTimeout(() => {
      applyDoc(pendingDoc, editor)
      setPendingDoc(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editor, pendingDoc, applyDoc])

  // 被其他编辑会话顶掉后只读
  const readOnly = !doc || isTakenOver
  // AI 写作进行中（输入要求、生成、等待确认）：锁定编辑器，避免生成位置失效或保存半成品
  const [aiBusy, setAiBusyState] = useState(false)
  const aiBusyRef = useRef(false)
  useEffect(() => {
    // 不触发 update 事件，避免切换锁定时被误判为正文修改
    if (editor && !editor.isDestroyed)
      editor.setEditable(!readOnly && !aiBusy, false)
  }, [editor, readOnly, aiBusy])

  // ---------- 保存 ----------
  const metaRef = useRef(meta)
  metaRef.current = meta
  const savedMetaRef = useRef(savedMeta)
  savedMetaRef.current = savedMeta
  const savedHtmlRef = useRef(savedHtml)
  savedHtmlRef.current = savedHtml
  const savingRef = useRef(false)
  const pendingSaveRef = useRef(false)
  // 保存失败的元信息快照：未再修改前自动保存不再重复提交，避免持续报错（如 slug 冲突）
  const failedMetaRef = useRef<string | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  // 保存进行中又有新修改时，保存结束后重新安排一次自动保存
  const scheduleAutosaveRef = useRef<() => void>(() => {})

  const metaDirty = useMemo(() => diffMeta(meta, savedMeta) !== null, [meta, savedMeta])
  const isDirty = contentDirty || metaDirty
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  const save = useCallback(async ({ manual = false }: { manual?: boolean } = {}): Promise<boolean> => {
    if (!editor || !doc || !canSave || aiBusyRef.current)
      return false
    if (savingRef.current) {
      pendingSaveRef.current = true
      return false
    }
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    const html = editor.getHTML()
    const contentChanged = html !== savedHtmlRef.current
    const currentMeta = metaRef.current
    let patch = diffMeta(currentMeta, savedMetaRef.current)
    const metaKey = patch ? JSON.stringify(patch) : null
    if (!manual && metaKey && metaKey === failedMetaRef.current)
      patch = null
    if (!manual && !contentChanged && !patch) {
      setContentDirty(false)
      return true
    }

    savingRef.current = true
    setSaving(true)
    try {
      await adapter.update({
        id: doc.id,
        // 手动保存时总是提交草稿（与旧版“存草稿”一致）
        draftContent: contentChanged || manual ? html : undefined,
        meta: patch ?? {},
        sessionId,
      })
      setSavedHtml(html)
      savedHtmlRef.current = html
      if (patch) {
        const appliedPatch = patch
        setSavedMeta(prev => ({ ...prev, ...appliedPatch }))
        setDoc(prev => (prev ? adapter.mergeMeta(prev, appliedPatch) : prev))
      }
      failedMetaRef.current = null
      setSaveError(null)
      setLastSavedAt(new Date())
      setChangedSinceOpen(true)
      if (editor.getHTML() === html)
        setContentDirty(false)
      if (manual)
        toast.success(operationT('save_success'))
      return true
    }
    catch (error) {
      // 已被其他编辑会话接管，切换为只读并提示
      if (isEditSessionConflict(error)) {
        markTakenOver()
        return false
      }
      const message = errorMessageT(error)
      if (metaKey)
        failedMetaRef.current = metaKey
      setSaveError(message || operationT('save_failed'))
      toast.error(message ? `${operationT('save_failed')}: ${message}` : operationT('save_failed'))
      return false
    }
    finally {
      savingRef.current = false
      setSaving(false)
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false
        scheduleAutosaveRef.current()
      }
    }
  }, [editor, doc, canSave, adapter, sessionId, operationT, errorMessageT, markTakenOver])

  const saveRef = useRef(save)
  saveRef.current = save

  // 停止输入一段时间后自动保存
  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current)
      window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null
      void saveRef.current()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [])
  scheduleAutosaveRef.current = scheduleAutosave

  useEffect(() => () => {
    if (autosaveTimerRef.current)
      window.clearTimeout(autosaveTimerRef.current)
  }, [])

  // 正文变化：标记未保存并安排自动保存
  useEffect(() => {
    if (!editor)
      return
    const onUpdate = ({ transaction }: { transaction: { getMeta: (key: string) => unknown } }) => {
      // AI 生成中的预览内容不算作修改
      if (transaction.getMeta(AI_PREVIEW_META))
        return
      setContentDirty(true)
      scheduleAutosave()
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, scheduleAutosave])

  const setAiBusy = useCallback((busy: boolean) => {
    aiBusyRef.current = busy
    setAiBusyState(busy)
    // 立即锁定，随后的高亮事务即可让气泡菜单等按只读状态隐藏
    if (editor && !editor.isDestroyed)
      editor.setEditable(!readOnly && !busy, false)
    // 会话期间跳过的自动保存在结束后补上
    if (!busy && isDirtyRef.current)
      scheduleAutosave()
  }, [editor, readOnly, scheduleAutosave])

  const updateMeta = useCallback((patch: Partial<ContentMeta>) => {
    if (readOnly)
      return
    setMetaState(prev => ({ ...prev, ...patch }))
    scheduleAutosave()
  }, [readOnly, scheduleAutosave])

  // 定时兜底：有修改则保存，没有修改时只检查编辑会话是否仍有效
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isDirtyRef.current)
        void saveRef.current()
      else
        checkEditSession()
    }, AUTOSAVE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [checkEditSession])

  // ⌘S / Ctrl+S 立即保存
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveRef.current({ manual: true })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 有未保存修改时关闭标签页前提示
  const hasUnsavedChanges = useCallback(() => isDirtyRef.current || savingRef.current, [])
  useUnsavedChangesWarning(hasUnsavedChanges)

  // ---------- 发布 ----------
  const publish = useCallback(async (): Promise<boolean> => {
    if (!editor || !doc || !canSave || publishing || aiBusyRef.current)
      return false
    const currentMeta = metaRef.current
    if (!currentMeta.title.trim()) {
      toast.error(postEditT('title_required'))
      return false
    }
    const html = editor.getHTML()
    const patch = diffMeta(currentMeta, savedMetaRef.current)
    setPublishing(true)
    try {
      await adapter.update({ id: doc.id, draftContent: html, content: html, meta: patch ?? {}, sessionId })
      setSavedHtml(html)
      setPublishedHtml(html)
      if (patch) {
        const appliedPatch = patch
        setSavedMeta(prev => ({ ...prev, ...appliedPatch }))
        setDoc(prev => (prev ? adapter.mergeMeta(prev, appliedPatch) : prev))
      }
      setDoc(prev => (prev ? { ...prev, content: html, draftContent: html } : prev))
      failedMetaRef.current = null
      setSaveError(null)
      setLastSavedAt(new Date())
      setChangedSinceOpen(true)
      if (editor.getHTML() === html)
        setContentDirty(false)
      toast.success(operationT('publish_success'))
      return true
    }
    catch (error) {
      if (isEditSessionConflict(error)) {
        markTakenOver()
        return false
      }
      const message = errorMessageT(error)
      toast.error(message ? `${operationT('publish_failed')}: ${message}` : operationT('publish_failed'))
      return false
    }
    finally {
      setPublishing(false)
    }
  }, [editor, doc, canSave, publishing, adapter, sessionId, operationT, postEditT, errorMessageT, markTakenOver])

  // ---------- 接管 ----------
  // 重新申请会话并加载服务端最新内容（本地未保存的内容以服务端为准）
  const takeOver = useCallback(async () => {
    if (!editor || !(await editSession.takeOver()))
      return
    const latest = await adapter.load(routeId).catch(() => null)
    if (!latest) {
      toast.error(postEditT('load_failed'))
      return
    }
    applyDoc(latest, editor)
  }, [editor, editSession, adapter, routeId, postEditT, applyDoc])

  // ---------- 版本：放弃修改 / 恢复版本 ----------
  // 先停掉待执行的自动保存并等进行中的保存结束，再在服务端恢复，最后重新载入（本地未保存的修改一并丢弃）
  // 出错时抛出，由确认弹窗统一提示；编辑会话被接管时切换为只读
  // changed：执行后内容是否可能与编辑起点不同（恢复版本、放弃未发布的修改后仍可“放弃本次修改”回到起点）
  const runRevisionAction = useCallback(async (action: () => Promise<unknown>, changed: boolean) => {
    if (!editor || !doc || aiBusyRef.current)
      return
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    pendingSaveRef.current = false
    for (let i = 0; savingRef.current && i < 100; i++)
      await new Promise(resolve => window.setTimeout(resolve, 50))
    try {
      await action()
    }
    catch (error) {
      if (isEditSessionConflict(error))
        markTakenOver()
      throw error
    }
    const latest = await adapter.load(routeId)
    if (!latest)
      throw new Error(postEditT('load_failed'))
    applyDoc(latest, editor)
    setChangedSinceOpen(changed)
    setLastSavedAt(new Date())
  }, [editor, doc, adapter, routeId, applyDoc, markTakenOver, postEditT])

  const baseRevisionId = editSession.baseRevisionId
  /** 放弃本次修改：正文与元信息恢复到打开编辑器时的版本 */
  const revertSession = useCallback(() => runRevisionAction(async () => {
    if (doc && baseRevisionId)
      await restoreRevision({ target: kind, id: doc.id, revisionId: baseRevisionId, sessionId })
  }, false), [runRevisionAction, doc, baseRevisionId, kind, sessionId])
  /** 放弃未发布的修改：正文草稿恢复为已发布的正文 */
  const discardUnpublished = useCallback(() => runRevisionAction(async () => {
    if (doc)
      await discardDraft({ target: kind, id: doc.id, sessionId })
  }, true), [runRevisionAction, doc, kind, sessionId])
  /** 恢复为指定的历史版本（写入草稿，不直接发布） */
  const restoreToRevision = useCallback((revisionId: number) => runRevisionAction(async () => {
    if (doc)
      await restoreRevision({ target: kind, id: doc.id, revisionId, sessionId })
  }, true), [runRevisionAction, doc, kind, sessionId])
  /** 删除历史版本（单个或批量），不影响正文；出错时抛出，编辑会话被接管时切换为只读 */
  const deleteRevisions = useCallback(async (revisionIds: number[]) => {
    if (!doc || revisionIds.length === 0)
      return
    try {
      if (revisionIds.length === 1)
        await deleteRevision({ target: kind, id: doc.id, revisionId: revisionIds[0], sessionId })
      else
        await batchDeleteRevisions({ target: kind, id: doc.id, revisionIds, sessionId })
    }
    catch (error) {
      if (isEditSessionConflict(error))
        markTakenOver()
      throw error
    }
  }, [doc, kind, sessionId, markTakenOver])

  // ---------- 派生状态 ----------
  let saveState: SaveState = 'idle'
  if (saving)
    saveState = 'saving'
  else if (saveError && isDirty)
    saveState = 'error'
  else if (isDirty)
    saveState = 'dirty'
  else if (lastSavedAt)
    saveState = 'saved'

  const hasUnpublishedChanges = contentDirty || (savedHtml !== null && publishedHtml !== null && savedHtml !== publishedHtml)

  return {
    kind,
    doc,
    loadState: loadFailed ? 'error' as const : doc ? 'ready' as const : 'loading' as const,
    reload: load,
    editor,
    meta,
    updateMeta,
    saveState,
    saveError,
    lastSavedAt,
    save,
    canSave,
    publish,
    publishing,
    hasUnpublishedChanges,
    // 版本
    canRevertSession: Boolean(baseRevisionId) && (changedSinceOpen || isDirty) && !readOnly,
    canDiscardUnpublished: hasUnpublishedChanges && Boolean(doc?.content) && !readOnly,
    revertSession,
    discardUnpublished,
    restoreToRevision,
    deleteRevisions,
    editSession,
    readOnly,
    takeOver,
    uiActionsRef,
    aiBusy,
    setAiBusy,
  }
}

export type ContentEditorController = ReturnType<typeof useContentEditor>
