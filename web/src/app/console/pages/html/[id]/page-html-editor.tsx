'use client'

import type { PageHtmlVersion, PageModel } from '@/models/page'
import { isAxiosError } from 'axios'
import { ArrowLeft, CloudUploadIcon, CodeXmlIcon, ExternalLink, Eye, Settings2, ShieldCheck } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getPageById, listPageHtmlVersions, updatePageHtmlVersion, uploadPageHtml } from '@/api/page'
import Forbidden from '@/components/common/forbidden'
import { HtmlPageFrame } from '@/components/html-page/html-page-frame'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { formatDataSize } from '@/utils/common/datasize'
import { isAdmin } from '@/utils/common/permission'
import { consolePath, getPageUrl } from '@/utils/common/route'
import { PageMetaDialog } from '../../page-meta-dialog'

const UPLOAD_ACCEPT = '.html,.htm,.zip'
const KEEP_VERSIONS = 5 // 与后端 constant.PageHTMLKeepVersions 一致

/** 文件包校验失败时后端在 data.path 中返回出错的文件 */
function getErrorPath(error: unknown): string | undefined {
  if (!isAxiosError(error))
    return undefined
  const path = (error.response?.data as { data?: { path?: unknown } } | undefined)?.data?.path
  return typeof path === 'string' ? path : undefined
}

export function PageHtmlEditor() {
  const { user } = useAuth()
  const { id } = useParams() as { id: string }
  // 控制台布局在登录状态确认前不渲染页面；HTML 页面可运行任意脚本，只开放给管理员（后端同样校验）
  if (!user || !isAdmin({ user }))
    return <Forbidden />
  return <PageHtmlEditorContent id={id} />
}

function PageHtmlEditorContent({ id }: { id: string }) {
  const t = useTranslations('Console.pages.html')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [page, setPage] = useState<PageModel | null>(null)
  const [versions, setVersions] = useState<PageHtmlVersion[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)

  const loadVersions = useCallback(async (pageId: number) => {
    const res = await listPageHtmlVersions({ pageId })
    setVersions(res.data.versions)
    return res.data.versions
  }, [])

  useEffect(() => {
    let cancelled = false
    getPageById({ id })
      .then(async (res) => {
        const loaded = res.data
        if (!loaded || cancelled)
          return
        const list = await loadVersions(loaded.id)
        if (cancelled)
          return
        setPage(loaded)
        setSelectedId(list.find(v => v.active)?.id ?? list[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(errorMessageT(error))
      })
    return () => {
      cancelled = true
    }
  }, [id, loadVersions, errorMessageT])

  const onUploaded = useCallback(async (version: PageHtmlVersion) => {
    if (!page)
      return
    await loadVersions(page.id).catch(() => {})
    setSelectedId(version.id)
  }, [loadVersions, page])

  const activate = async (version: PageHtmlVersion) => {
    if (!page)
      return
    await updatePageHtmlVersion({ pageId: page.id, versionId: version.id, active: true })
      .then(() => {
        toast.success(t('switch_success', { version: version.version }))
        setVersions(prev => prev.map(item => ({ ...item, active: item.id === version.id })))
      })
      .catch((error: unknown) => toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`))
  }

  const changeEntry = async (version: PageHtmlVersion, entry: string) => {
    if (!page)
      return
    await updatePageHtmlVersion({ pageId: page.id, versionId: version.id, entry })
      .then((res) => {
        toast.success(t('entry_updated'))
        setVersions(prev => prev.map(item => (item.id === version.id ? res.data : item)))
      })
      .catch((error: unknown) => toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`))
  }

  if (loadError)
    return <p role="alert" className="text-sm text-destructive">{`${t('load_failed')}: ${loadError}`}</p>
  if (!page)
    return <EditorSkeleton />

  const selected = versions.find(v => v.id === selectedId) ?? null
  const isHtmlPage = page.kind === 'html'

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={consolePath.page}>
            <ArrowLeft />
            {t('back')}
          </Link>
        </Button>
        <div className="grid min-w-0 gap-0.5">
          <h2 className="truncate font-semibold">{page.title}</h2>
          <span className="truncate font-mono text-xs text-muted-foreground">{getPageUrl(page)}</span>
        </div>
        <div className="ml-auto flex gap-3">
          <Button variant="outline" size="sm" onClick={() => setMetaOpen(true)}>
            <Settings2 />
            {operationT('setting')}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={getPageUrl(page)} target="_blank" rel="noreferrer">
              <Eye />
              {operationT('view')}
            </a>
          </Button>
        </div>
      </div>
      <PageMetaDialog
        open={metaOpen}
        onOpenChange={setMetaOpen}
        page={page}
        onPageChange={({ page: patch }) => setPage(prev => (prev ? { ...prev, ...patch } : prev))}
      />

      {!isHtmlPage
        ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><CodeXmlIcon /></EmptyMedia>
                <EmptyTitle>{t('not_html_title')}</EmptyTitle>
                <EmptyDescription>{t('not_html_description')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" onClick={() => setMetaOpen(true)}>{operationT('setting')}</Button>
              </EmptyContent>
            </Empty>
          )
        : (
            <>
              <Alert>
                <ShieldCheck />
                <AlertDescription>{t('sandbox_hint')}</AlertDescription>
              </Alert>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="grid min-w-0 content-start gap-4">
                  <PreviewCard version={selected} title={page.title} />
                  {selected && <FilesCard version={selected} onEntryChange={entry => changeEntry(selected, entry)} />}
                </div>
                <div className="grid min-w-0 content-start gap-4">
                  <UploadCard pageId={page.id} onUploaded={onUploaded} />
                  <VersionsCard versions={versions} selectedId={selectedId} onSelect={setSelectedId} onActivate={activate} />
                </div>
              </div>
            </>
          )}
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-9 w-full max-w-sm" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  )
}

function PreviewCard({ version, title }: { version: PageHtmlVersion | null, title: string }) {
  const t = useTranslations('Console.pages.html')
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>{version ? t('preview_title', { version: version.version }) : t('preview')}</CardTitle>
        {version && (
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              {/* 直接打开同样运行在沙箱中 */}
              <a href={version.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {t('open_in_new_tab')}
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {version
          ? (
              <div className="h-[min(70vh,48rem)] overflow-hidden rounded-lg border">
                <HtmlPageFrame src={version.url} title={title} allowSameOrigin={version.allowSameOrigin} className="size-full" />
              </div>
            )
          : (
              <Empty className="h-64 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><CodeXmlIcon /></EmptyMedia>
                  <EmptyDescription>{t('versions_empty')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
      </CardContent>
    </Card>
  )
}

function FilesCard({ version, onEntryChange }: { version: PageHtmlVersion, onEntryChange: (entry: string) => void }) {
  const t = useTranslations('Console.pages.html')
  const documents = version.files.filter(file => /\.html?$/i.test(file.path))
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('files_title')}</CardTitle>
        <CardDescription>{t('file_summary', { count: version.files.length, size: formatDataSize({ size: version.totalSize }) })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        <div className="grid gap-2">
          <Label htmlFor="page-html-entry">{t('entry')}</Label>
          <Select value={version.entry} onValueChange={onEntryChange}>
            <SelectTrigger id="page-html-entry" className="w-full font-mono text-[13px] sm:max-w-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {documents.map(file => (
                <SelectItem key={file.path} value={file.path} className="font-mono text-[13px]">{file.path}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('entry_hint')}</p>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('file_path')}</TableHead>
                <TableHead>{t('file_type')}</TableHead>
                <TableHead className="text-right">{t('file_size')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {version.files.map(file => (
                <TableRow key={file.path}>
                  <TableCell className="max-w-80 truncate font-mono text-xs" title={file.path}>
                    {file.path}
                    {file.path === version.entry && <Badge variant="secondary" className="ml-2">{t('entry')}</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{file.mimeType.split(';')[0]}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatDataSize({ size: file.size })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function UploadCard({ pageId, onUploaded }: { pageId: number, onUploaded: (version: PageHtmlVersion) => Promise<void> }) {
  const t = useTranslations('Console.pages.html')
  const errorMessageT = useErrorMessageT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  // 离开页面时中止仍在进行的上传
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => controllerRef.current?.abort(), [])

  const upload = async (file: File | undefined) => {
    if (!file || progress !== null)
      return
    if (!/\.(?:html?|zip)$/i.test(file.name)) {
      toast.error(t('unsupported_file'))
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setProgress(0)
    try {
      const res = await uploadPageHtml({ pageId, file, signal: controller.signal, onProgress: setProgress })
      toast.success(t('upload_success', { version: res.data.version }))
      await onUploaded(res.data)
    }
    catch (error: unknown) {
      if (!controller.signal.aborted) {
        const path = getErrorPath(error)
        toast.error(`${t('upload_failed')}: ${errorMessageT(error)}${path ? ` (${path})` : ''}`)
      }
    }
    finally {
      setProgress(null)
    }
  }

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('upload_title')}</CardTitle>
        <CardDescription>{t('upload_hint', { count: KEEP_VERSIONS })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={progress !== null}
          data-drag-over={dragOver}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            void upload(e.dataTransfer.files[0])
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/15 bg-muted/40 px-6 py-8 text-center outline-none transition-colors hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-60 data-[drag-over=true]:border-primary data-[drag-over=true]:bg-primary/5"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <CloudUploadIcon className="size-5" />
          </span>
          <span className="text-sm text-foreground/85">{t('dropzone')}</span>
          <span className="text-xs text-muted-foreground">{UPLOAD_ACCEPT}</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={UPLOAD_ACCEPT}
          onChange={(e) => {
            void upload(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {progress !== null && (
          <div className="grid gap-2">
            <Progress value={progress} />
            <span className="text-xs text-muted-foreground">{progress < 100 ? t('uploading', { progress }) : t('processing')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function VersionsCard({
  versions,
  selectedId,
  onSelect,
  onActivate,
}: {
  versions: PageHtmlVersion[]
  selectedId: number | null
  onSelect: (id: number) => void
  onActivate: (version: PageHtmlVersion) => void
}) {
  const t = useTranslations('Console.pages.html')
  const format = useFormatter()
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('versions_title')}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {versions.length === 0
          ? <p className="text-sm text-muted-foreground">{t('versions_empty')}</p>
          : (
              <ul className="grid gap-2">
                {versions.map(version => (
                  <li
                    key={version.id}
                    data-selected={version.id === selectedId}
                    className="grid gap-2 rounded-lg border p-3 data-[selected=true]:border-primary/60 data-[selected=true]:bg-primary/5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t('version_label', { version: version.version })}</span>
                      {version.active && <Badge>{t('active')}</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {format.dateTime(new Date(version.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={version.sourceName}>
                      {[version.sourceName, t('file_summary', { count: version.files.length, size: formatDataSize({ size: version.totalSize }) })].filter(Boolean).join(' · ')}
                    </div>
                    <div className="flex gap-3">
                      <Button size="sm" variant={version.id === selectedId ? 'secondary' : 'ghost'} onClick={() => onSelect(version.id)}>
                        {version.id === selectedId ? t('previewing') : t('preview')}
                      </Button>
                      {!version.active && (
                        <Button size="sm" variant="outline" onClick={() => onActivate(version)}>{t('switch_to')}</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
      </CardContent>
    </Card>
  )
}
