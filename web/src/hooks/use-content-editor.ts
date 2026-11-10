'use client'

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { AIWriterOpenOptions } from '@/components/tiptap-editor/use-ai-writer'
import type { Category } from '@/models/category'
import type { ContentSaveResult, EditEvent } from '@/models/edit-session'
import type { Label } from '@/models/label'
import type { PageLayout, PageModel } from '@/models/page'
import type { Post, PostBackground } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import { EditorState } from '@tiptap/pm/state'
import { getHTMLFromFragment, useEditor } from '@tiptap/react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isDraftConflict, isEditSessionConflict } from '@/api/edit-session'
import { uploadFile } from '@/api/file'
import { getPageById, updatePage } from '@/api/page'
import { getPostById, updatePost } from '@/api/post'
import { batchDeleteRevisions, deleteRevision, discardDraft, restoreRevision } from '@/api/revision'
import { AI_PREVIEW_META } from '@/components/tiptap-extension/ai-write-extension'
import { REMOTE_SYNC_META } from '@/components/tiptap-extension/remote-change-extension'
import { buildSlashItems, filterSlashItems } from '@/components/tiptap-ui/slash-menu/slash-items'
import { useEditEvents } from '@/hooks/use-edit-events'
import { useEditSession } from '@/hooks/use-edit-session'
import { useUnsavedChangesWarning } from '@/hooks/use-editor-helpers'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { mergeRemoteContent } from '@/lib/tiptap-remote-sync'

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
  /** 文章内容主题，空字符串表示跟随站点默认（页面固定跟随站点默认） */
  contentTheme: string
  isPrivate: boolean
  // 仅文章
  category: Category | null
  labels: Label[]
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
  // 保存正文时所基于的草稿版本号，草稿在此之后被他人改动过则保存被拒绝（draft_conflict）
  baseDraftVersion?: number
}

interface ContentAdapter {
  load: (id: string) => Promise<ContentDoc | null>
  toMeta: (doc: ContentDoc) => ContentMeta
  update: (args: UpdateArgs) => Promise<BaseResponse<ContentSaveResult>>
  // 把保存成功的元信息合并回文档对象（用于预览地址、标题等展示）
  mergeMeta: (doc: ContentDoc, meta: Partial<ContentMeta>) => ContentDoc
}

const EMPTY_META: ContentMeta = {
  title: '',
  description: '',
  slug: '',
  cover: '',
  background: EMPTY_BACKGROUND,
  contentTheme: '',
  isPrivate: false,
  category: null,
  labels: [],
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
      contentTheme: post.contentTheme || '',
      isPrivate: !!post.isPrivate,
      category: post.category ?? null,
      labels: post.labels ?? [],
    }
  },
  update: ({ id, draftContent, content, meta, sessionId, baseDraftVersion }) => {
    const patch: Partial<Post> & Pick<Post, 'id'> & { baseDraftVersion?: number } = { id, baseDraftVersion }
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
    if (meta.contentTheme !== undefined)
      patch.contentTheme = meta.contentTheme
    if (meta.isPrivate !== undefined)
      patch.isPrivate = meta.isPrivate
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
  update: ({ id, draftContent, content, meta, sessionId, baseDraftVersion }) => {
    const patch: Partial<PageModel> & Pick<PageModel, 'id'> & { baseDraftVersion?: number } = { id, baseDraftVersion }
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
    const { category: _category, labels: _labels, contentTheme: _contentTheme, ...rest } = meta
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

/**
 * 服务端草稿是否与本地基线不同步：版本号不同就要按最新草稿合并并重置基线。
 * 只判断「更新」不够：服务端版本号比基线小（如被旧数据写回）时，保存会一直 draft_conflict 而合并永远不触发
 */
export function remoteDraftDiverged(latestVersion: number | undefined, baseVersion: number): boolean {
  return (latestVersion ?? 0) !== baseVersion
}

export interface EditorUiActions {
  openLink?: () => void
  openAnnotation?: () => void
  openAI?: (options?: AIWriterOpenOptions) => void
  openComponentLibrary?: () => void
  editMath?: (pos: number) => void
  // 打开图标选择器在光标处插入；editIcon 为更换 pos 处的图标
  openIconPicker?: () => void
  editIcon?: (pos: number) => void
}

/**
 * 文章 / 页面编辑器的共用逻辑：
 * - 创建编辑器实例（共用扩展列表），加载草稿
 * - 编辑会话（申请 / 检查 / 被接管只读 / 接管）
 * - 与外部 AI 工具同时编辑：保存正文时带上草稿版本号；收到他人保存的事件（或保存被拒绝）时拉取最新草稿，
 *   按块三方合并进编辑器（双方改了同一块时保留本地版本），合并进来的块高亮，之后再保存
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
  // 图片与视频共用一个上传入口，失败提示按媒体类型区分；onProgress / signal 用于上传进度与取消
  const uploadMedia = useCallback(async (input: File, onProgress?: (event: { progress: number }) => void, signal?: AbortSignal) => {
    try {
      const res = await uploadFile({
        file: input,
        onProgress: onProgress ? progress => onProgress({ progress }) : undefined,
        signal,
      })
      return res.data.url
    }
    catch {
      // 主动取消不提示
      if (!signal?.aborted)
        toast.error(postEditT(input.type.startsWith('video/') ? 'video_upload_failed' : 'image_upload_failed'))
      return ''
    }
  }, [postEditT])

  // 扩展只创建一次，文案与回调通过 ref 读取最新值
  const latestRef = useRef({ t, format, uploadMedia })
  latestRef.current = { t, format, uploadMedia }
  const slashItems = useMemo(
    () => buildSlashItems(t, componentT, date => format.dateTime(date, { dateStyle: 'long' }), () => uiActionsRef.current.openAI?.({ mode: 'write' }), () => uiActionsRef.current.openComponentLibrary?.(), () => uiActionsRef.current.openIconPicker?.()),
    [t, componentT, format],
  )
  const slashItemsRef = useRef(slashItems)
  slashItemsRef.current = slashItems

  const extensions = useMemo(() => createContentExtensions({
    upload: (file, onProgress, signal) => latestRef.current.uploadMedia(file, onProgress, signal),
    placeholder: ({ nodeName, level }) => nodeName === 'heading'
      ? latestRef.current.t('heading_placeholder', { level: level ?? 1 })
      : latestRef.current.t('body_placeholder'),
    getSlashItems: query => filterSlashItems(slashItemsRef.current, query),
    onOpenLink: () => uiActionsRef.current.openLink?.(),
    onOpenAnnotation: () => uiActionsRef.current.openAnnotation?.(),
    onOpenAI: () => uiActionsRef.current.openAI?.(),
    onEditMath: pos => uiActionsRef.current.editMath?.(pos),
    onEditIcon: pos => uiActionsRef.current.editIcon?.(pos),
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
        // content-body：与前台正文共用内容主题样式，主题由外壳通过 data-content-theme 切换
        'class': 'neo-editor-content content-body prose max-w-none dark:prose-invert pangu-autospace',
      },
    },
    extensions,
  }, [])

  // ---------- 加载 ----------
  // 合并的基线：本地上次与服务端同步（载入、保存成功、合并）时的草稿版本号与正文
  const baseVersionRef = useRef(0)
  const baseDocRef = useRef<PMNode | null>(null)
  const applyDoc = useCallback((next: ContentDoc, ed: Editor) => {
    const draft = next.draftContent || next.content || ''
    // 载入内容不进入撤销历史，避免撤销到空文档后被自动保存成空草稿
    ed.chain().setMeta('addToHistory', false).setContent(draft, { emitUpdate: false }).run()
    // 清空撤销历史：恢复版本、放弃修改或接管后，撤销不能再回到载入前的内容
    ed.view.updateState(EditorState.create({ doc: ed.state.doc, plugins: ed.state.plugins }))
    baseVersionRef.current = next.draftVersion ?? 0
    baseDocRef.current = ed.state.doc
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
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
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
  // 合并他人修改的状态（见下方 syncRemote）：进行中、期间又有新事件，以及最近一次远端保存来自哪个外部 AI 工具
  const syncingRef = useRef(false)
  const pendingSyncRef = useRef(false)
  const remoteActorRef = useRef<string | undefined>(undefined)
  // 保存失败的元信息快照：未再修改前自动保存不再重复提交，避免持续报错（如 slug 冲突）
  const failedMetaRef = useRef<string | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  // 保存进行中又有新修改时，保存结束后重新安排一次自动保存
  const scheduleAutosaveRef = useRef<() => void>(() => {})

  const metaDirty = useMemo(() => diffMeta(meta, savedMeta) !== null, [meta, savedMeta])
  const isDirty = contentDirty || metaDirty
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  // 草稿冲突时合并最新草稿（定义见下方），保存失败后调用
  const syncRemoteRef = useRef<() => Promise<void>>(async () => {})
  const save = useCallback(async ({ manual = false }: { manual?: boolean } = {}): Promise<boolean> => {
    if (!editor || !doc || !canSave || aiBusyRef.current)
      return false
    // 正在合并他人的修改：合并结束后会重新安排保存
    if (syncingRef.current) {
      pendingSaveRef.current = true
      return false
    }
    if (savingRef.current) {
      pendingSaveRef.current = true
      return false
    }
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    const html = editor.getHTML()
    const savedDoc = editor.state.doc
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
    // 手动保存时总是提交草稿（与旧版“存草稿”一致）
    const submitDraft = contentChanged || manual
    try {
      const res = await adapter.update({
        id: doc.id,
        draftContent: submitDraft ? html : undefined,
        meta: patch ?? {},
        sessionId,
        baseDraftVersion: submitDraft ? baseVersionRef.current : undefined,
      })
      // 只有提交了正文时版本号才是本次保存的；只改元信息时不更新基线
      if (submitDraft) {
        baseVersionRef.current = res.data.draftVersion
        baseDocRef.current = savedDoc
      }
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
      // 草稿在此期间被他人（外部 AI 工具）改过：合并最新草稿后会重新安排保存
      if (isDraftConflict(error)) {
        pendingSaveRef.current = true
        void syncRemoteRef.current()
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

  // 离开编辑页前（隐藏/关闭标签页、点返回）把待保存的修改立即写入，不让防抖窗口内的编辑丢掉
  // 返回 false 表示保存失败，调用方据此不跳转；其余情况（包括生成中/只读）一律允许离开
  const flushSave = useCallback(async (): Promise<boolean> => {
    // 没有修改，或只读 / 无会话 / AI 生成中（结束后会自行补保存）时没有可立即保存的内容
    if (!isDirtyRef.current || !canSave || aiBusyRef.current)
      return true
    // 已有保存在进行：让它结束后再补一次（不阻塞跳转，SPA 跳转不会中断已发出的请求）
    if (savingRef.current || syncingRef.current) {
      pendingSaveRef.current = true
      return true
    }
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    return saveRef.current()
  }, [canSave])

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
      // AI 生成中的预览内容、合并进来的他人修改不算作本地修改
      if (transaction.getMeta(AI_PREVIEW_META) || transaction.getMeta(REMOTE_SYNC_META))
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
    // 会话期间延后的合并与跳过的自动保存在结束后补上
    if (!busy && pendingSyncRef.current)
      void syncRemoteRef.current()
    else if (!busy && isDirtyRef.current)
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

  // ---------- 合并他人的修改 ----------
  // 他人（外部 AI 工具）保存后拉取最新草稿，按块三方合并进编辑器；本地有未保存的修改时合并后再保存
  // 进行中的保存、输入法组字结束后再合并；编辑器内 AI 写作进行中时延后到结束
  const waitForIdle = useCallback(async () => {
    for (let i = 0; (savingRef.current || editor?.view.composing) && i < 300; i++)
      await new Promise(resolve => window.setTimeout(resolve, 100))
  }, [editor])
  const syncRemote = useCallback(async () => {
    if (!editor || !doc)
      return
    if (syncingRef.current || aiBusyRef.current) {
      pendingSyncRef.current = true
      return
    }
    syncingRef.current = true
    try {
      do {
        pendingSyncRef.current = false
        await waitForIdle()
        const latest = await adapter.load(routeId).catch(() => null)
        if (!latest || editor.isDestroyed || !baseDocRef.current)
          break
        // 拉取期间开始了编辑器内 AI 写作：结束后再合并
        if (aiBusyRef.current) {
          pendingSyncRef.current = true
          break
        }
        // 正文：草稿版本与本地基线不同时合并（只改了元信息时版本不变，正文不用合并）
        let result: ReturnType<typeof mergeRemoteContent> | null = null
        if (remoteDraftDiverged(latest.draftVersion, baseVersionRef.current)) {
          await waitForIdle()
          result = mergeRemoteContent(editor, baseDocRef.current, latest.draftContent || latest.content || '')
          baseDocRef.current = result.remoteDoc
          baseVersionRef.current = latest.draftVersion ?? 0
          // 没有本地修改时合并后与远端一致；有本地修改时以远端为已保存的内容，之后保存合并结果
          const remoteHtml = result.localChanged ? getHTMLFromFragment(result.remoteDoc.content, editor.schema) : editor.getHTML()
          setSavedHtml(remoteHtml)
          savedHtmlRef.current = remoteHtml
          setPublishedHtml(!latest.draftContent || latest.draftContent === latest.content ? remoteHtml : latest.content)
          setContentDirty(result.localChanged || result.conflicts > 0)
          if (result.localChanged)
            pendingSaveRef.current = true
        }
        // 元信息：本地未保存的字段保留本地值，其余采用远端的值
        const remoteMeta = adapter.toMeta(latest)
        const localMetaPatch = diffMeta(metaRef.current, savedMetaRef.current)
        setMetaState({ ...remoteMeta, ...localMetaPatch })
        setSavedMeta(remoteMeta)
        setDoc(latest)
        if (localMetaPatch)
          pendingSaveRef.current = true
        if (!result)
          continue
        // 只读（被接管）时由提示条说明，不再弹出提示
        if (!readOnlyRef.current && result.ranges.length > 0) {
          const first = result.ranges[0].from
          toast(t('remote.merged', { name: remoteActorRef.current || t('remote.someone'), count: result.ranges.length }), {
            action: {
              label: t('remote.view'),
              onClick: () => {
                const dom = editor.view.nodeDOM(first)
                if (dom instanceof HTMLElement)
                  dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
              },
            },
          })
        }
        if (!readOnlyRef.current && result.conflicts > 0)
          toast.warning(t('remote.conflict', { count: result.conflicts }))
      } while (pendingSyncRef.current)
    }
    finally {
      syncingRef.current = false
      if (pendingSaveRef.current && !readOnlyRef.current) {
        pendingSaveRef.current = false
        scheduleAutosaveRef.current()
      }
    }
  }, [editor, doc, adapter, routeId, waitForIdle, t])
  syncRemoteRef.current = syncRemote

  // 编辑事件：他人保存（版本比本地新）或可能错过事件（重连、resync）时合并最新草稿；会话变化时尽快发现被接管
  // 首次连上的 ready 不处理（内容刚载入）
  const eventsConnectedRef = useRef(false)
  useEditEvents(kind, doc?.id ?? 0, (event: EditEvent) => {
    if (event.type === 'ready' && !eventsConnectedRef.current) {
      eventsConnectedRef.current = true
      return
    }
    if (event.type === 'session') {
      checkEditSession()
      return
    }
    // 持有会话时，不是外部 AI 工具的保存只可能是自己的（其他编辑页会先顶掉本页），不用处理；
    // 外部 AI 工具只改元信息时版本号不变，仍要同步元信息
    if (event.type === 'saved' && !event.apiTokenName && !readOnlyRef.current)
      return
    if (event.type === 'saved')
      remoteActorRef.current = event.apiTokenName
    void syncRemote()
  })

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
    const savedDoc = editor.state.doc
    const patch = diffMeta(currentMeta, savedMetaRef.current)
    setPublishing(true)
    try {
      const res = await adapter.update({ id: doc.id, draftContent: html, content: html, meta: patch ?? {}, sessionId, baseDraftVersion: baseVersionRef.current })
      baseVersionRef.current = res.data.draftVersion
      baseDocRef.current = savedDoc
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
      // 草稿刚被他人改过：合并后请作者确认再发布，不直接发布合并后的内容
      if (isDraftConflict(error)) {
        await syncRemoteRef.current()
        toast.warning(t('remote.publish_conflict'))
        return false
      }
      const message = errorMessageT(error)
      toast.error(message ? `${operationT('publish_failed')}: ${message}` : operationT('publish_failed'))
      return false
    }
    finally {
      setPublishing(false)
    }
  }, [editor, doc, canSave, publishing, adapter, sessionId, operationT, postEditT, errorMessageT, markTakenOver, t])

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
    flushSave,
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
