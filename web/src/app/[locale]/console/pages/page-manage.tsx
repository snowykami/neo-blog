'use client'

import type { PageModel } from '@/models/page'
import type { BaseResponseError } from '@/models/resp'
import { CodeXmlIcon, Ellipsis, Eye, LinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsBoolean, parseAsInteger, useQueryState } from 'nuqs'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listPagesAdmin } from '@/api/admin'
import { deletePage, listMyPages, updatePage } from '@/api/page'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageSizeSelector } from '@/components/common/page-size-selector'
import { PaginationController } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth-context'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { OrderBy } from '@/models/common'
import { isAdmin } from '@/utils/common/permission'
import { getPageEditUrl, getPageViewUrl } from '@/utils/common/route'
import { PageMetaDialog } from './page-meta-dialog'

const PAGE_SIZE = 15

// 查看：链接页面直接打开其地址；私密页面前台 404，打开后台预览
function getPageOpenUrl(page: PageModel) {
  return page.kind === 'link' && page.linkUrl ? page.linkUrl : getPageViewUrl(page)
}

// 「查看」打开的是后台预览（私密的正文 / HTML 页面）
function isPreview(page: PageModel) {
  return page.isPrivate && !(page.kind === 'link' && page.linkUrl)
}

// 列表为空时的固定引用：onPageChange 的 useCallback 依赖 pages
const EMPTY_PAGES: PageModel[] = []

const PageItem = memo(({
  onPageChange,
  onRequestEditMeta,
  onRequestDelete,
  page,
  showAuthor,
}: {
  onPageChange: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  onRequestEditMeta: (page: PageModel) => void
  onRequestDelete: (page: PageModel) => void
  page: PageModel
  showAuthor: boolean // 管理员看所有人的页面时显示作者
}) => {
  const t = useTranslations('Console.pages')
  const editorT = useTranslations('Console.editor')
  const stateT = useTranslations('State')
  const operationT = useOperationT()
  return (
    <div className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <div className="min-w-0">
        {page.kind === 'link'
          ? (
              <button
                type="button"
                onClick={() => onRequestEditMeta(page)}
                className="block w-fit max-w-full cursor-pointer truncate text-left text-sm font-medium transition-colors hover:text-primary"
              >
                {page.title || editorT('untitled_page')}
              </button>
            )
          : (
              <Link
                href={getPageEditUrl(page)}
                className="block w-fit max-w-full truncate text-sm font-medium transition-colors hover:text-primary"
              >
                {page.title || editorT('untitled_page')}
              </Link>
            )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">
            ID:
            {page.id}
          </Badge>
          {/* 链接页面的 slug 只是内部标识，显示链接地址 */}
          {page.kind !== 'link' && <Badge variant="secondary">{page.slug}</Badge>}
          {page.kind === 'link' && (
            <Badge variant="outline" className="max-w-56 gap-1 font-mono" title={page.linkUrl}>
              <LinkIcon aria-hidden className="size-3" />
              <span className="truncate">{page.linkUrl}</span>
            </Badge>
          )}
          {page.kind === 'html' && (
            <Badge variant="outline" className="gap-1">
              <CodeXmlIcon aria-hidden className="size-3" />
              {t('html_badge')}
            </Badge>
          )}
          {page.fullscreen && <Badge variant="outline">{t('fullscreen_badge')}</Badge>}
          {page.hasDraft && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {editorT('status_unpublished_changes')}
            </Badge>
          )}
          <Badge
            variant="secondary"
            className={page.isPrivate
              ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'
              : 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'}
          >
            {page.isPrivate ? stateT('private') : stateT('public')}
          </Badge>
          {page.showInNav && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">
              {t('nav_order', { order: page.navOrder })}
            </Badge>
          )}
          {showAuthor && page.user && (
            <Badge variant="secondary" className="bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300">
              {t('author', { name: page.user.nickname || page.user.username })}
            </Badge>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <a href={getPageOpenUrl(page)} target="_blank" rel="noreferrer" aria-label={operationT(isPreview(page) ? 'preview' : 'view')} title={operationT(isPreview(page) ? 'preview' : 'view')}>
            <Eye className="size-4" />
          </a>
        </Button>
        <PageDropdownMenu
          page={page}
          onPageChange={onPageChange}
          onRequestEditMeta={onRequestEditMeta}
          onRequestDelete={onRequestDelete}
        />
      </div>
    </div>
  )
})

export function PageManage() {
  const { user } = useAuth()
  // 管理员可管理所有人的页面（与文章管理一致，可切换「只看我的」），编辑者只能管理自己的页面
  const isAdminUser = !!user && isAdmin({ user })
  const t = useTranslations('Console.pages')
  const errorMessageT = useErrorMessageT()
  const operationT = useOperationT()
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [size, setSize] = useQueryState(
    'size',
    parseAsInteger.withDefault(PAGE_SIZE).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [queryInput, setQueryInput, debouncedQueryInput] = useDebouncedState('', 200)
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const [editingPage, setEditingPage] = useState<PageModel | null>(null)
  const [deletingPage, setDeletingPage] = useState<PageModel | null>(null)
  const [onlyMine, setOnlyMine] = useQueryState(
    'only_mine',
    parseAsBoolean.withDefault(false).withOptions({ history: 'replace', clearOnDefault: true }),
  )

  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const pagesQuery = useConsoleQuery(
    user ? ['page/list', isAdminUser, page, size, debouncedQueryInput, onlyMine] : null,
    () => {
      const params = { page, size, query: debouncedQueryInput, noContent: true, orderBy: OrderBy.CreatedAt, desc: true }
      return (isAdminUser ? listPagesAdmin({ ...params, userId: onlyMine ? user!.id : 0 }) : listMyPages(params))
        .then(res => ({ pages: res.data.pages, total: res.data.total }))
    },
    { onError: error => toast.error(`${operationT('fetch_failed')}: ${errorMessageT(error)}`) },
  )
  const pages = pagesQuery.data?.pages ?? EMPTY_PAGES
  const total = pagesQuery.data?.total ?? 0
  const loading = (!user && !pagesQuery.data) || (pagesQuery.loading && !pagesQuery.data)
  const { refresh: loadPages, setData: setPageList } = pagesQuery

  // 搜索词变化时回到第一页
  const prevQueryRef = useRef(debouncedQueryInput)
  useEffect(() => {
    if (prevQueryRef.current === debouncedQueryInput)
      return
    prevQueryRef.current = debouncedQueryInput
    void setPage(1)
  }, [debouncedQueryInput, setPage])

  // 已有页面就地更新；新建页面需要后端的排序与分页结果，重新拉取列表
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const onPageChange = useCallback(({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => {
    if (!pagesRef.current.some(item => item.id === page.id)) {
      loadPages()
      return
    }
    setPageList(prev => prev && { ...prev, pages: prev.pages.map(item => (item.id === page.id ? { ...item, ...page } : item)) })
  }, [loadPages, setPageList])

  const onPageDelete = useCallback(({ pageId }: { pageId: number }) => {
    setPageList(prev => prev && { pages: prev.pages.filter(item => item.id !== pageId), total: Math.max(0, prev.total - 1) })
  }, [setPageList])

  const openCreateDialog = useCallback(() => {
    setEditingPage(null)
    setMetaDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((target: PageModel) => {
    setEditingPage(target)
    setMetaDialogOpen(true)
  }, [])

  const handleDeleteOne = useCallback(async () => {
    if (!deletingPage)
      return
    await deletePage({ id: deletingPage.id })
    toast.success(operationT('delete_success'))
    onPageDelete({ pageId: deletingPage.id })
  }, [deletingPage, operationT, onPageDelete])

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="search"
            placeholder={t('search_pages')}
            value={queryInput}
            onChange={event => setQueryInput(event.target.value)}
            className="max-w-sm"
          />
          {isAdminUser && (
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="page-manage-only-mine"
                checked={onlyMine}
                onCheckedChange={(checked) => {
                  setOnlyMine(checked)
                  setPage(1)
                }}
              />
              <Label htmlFor="page-manage-only-mine">{t('only_mine')}</Label>
            </div>
          )}
        </div>
        <Button size="sm" onClick={openCreateDialog}>{t('create_page')}</Button>
      </div>
      <PageMetaDialog
        open={metaDialogOpen}
        onOpenChange={setMetaDialogOpen}
        page={editingPage}
        onPageChange={onPageChange}
      />
      <ConfirmDialog
        open={!!deletingPage}
        onOpenChange={open => !open && setDeletingPage(null)}
        title={deletingPage?.title ? operationT('delete_confirm_title', { name: deletingPage.title }) : operationT('confirm_delete')}
        description={operationT('delete_description')}
        confirmLabel={operationT('delete')}
        errorText={operationT('delete_failed')}
        confirmVariant="destructive"
        onConfirm={handleDeleteOne}
      />
      <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] empty:hidden dark:shadow-none">
        {loading && (
          <div className="divide-y" aria-busy="true">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5 max-w-xs" />
                  <div className="flex gap-2">
                    <Skeleton className="h-4 w-14 rounded-md" />
                    <Skeleton className="h-4 w-20 rounded-md" />
                    <Skeleton className="h-4 w-16 rounded-md" />
                  </div>
                </div>
                <Skeleton className="size-8 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
        )}
        {/* 加载完成后列表为空：区分「没有页面」与「没有匹配搜索的页面」 */}
        {!loading && pagesQuery.data && pages.length === 0 && (
          <Empty className="py-12">
            <EmptyDescription>{t(debouncedQueryInput ? 'empty_search' : 'empty')}</EmptyDescription>
          </Empty>
        )}
        {!loading && pages.length > 0 && (
          <div className="divide-y">
            {pages.map(pageItem => (
              <PageItem
                key={pageItem.id}
                page={pageItem}
                showAuthor={isAdminUser}
                onPageChange={onPageChange}
                onRequestEditMeta={openEditDialog}
                onRequestDelete={setDeletingPage}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-center items-center py-4">
        {total > 0 && (
          <PaginationController page={page} onPageChange={setPage} total={total} pageSize={size} />
        )}
        <PageSizeSelector
          size={size}
          onSizeChange={(nextSize) => {
            setSize(nextSize)
            setPage(1)
          }}
        />
      </div>
    </div>
  )
}

function PageDropdownMenu({
  onPageChange,
  onRequestEditMeta,
  onRequestDelete,
  page,
}: {
  onPageChange: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  onRequestEditMeta: (page: PageModel) => void
  onRequestDelete: (page: PageModel) => void
  page: PageModel
}) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()

  const togglePrivate = () => {
    updatePage({ page: { id: page.id, isPrivate: !page.isPrivate } })
      .then(() => {
        toast.success(operationT('update_success'))
        onPageChange({ page: { id: page.id, isPrivate: !page.isPrivate } })
      })
      .catch((error: BaseResponseError) => toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={operationT('more')} title={operationT('more')}>
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-36" align="end">
        {/* 链接页面没有正文，编辑即打开设置 */}
        {page.kind === 'link'
          ? <DropdownMenuItem onClick={() => onRequestEditMeta(page)}>{operationT('edit')}</DropdownMenuItem>
          // 客户端跳转（不整页刷新）；菜单打开时（链接挂载）就完整预取编辑器的页面与 JS
          : <DropdownMenuItem asChild><Link href={getPageEditUrl(page)} prefetch>{operationT('edit')}</Link></DropdownMenuItem>}
        <DropdownMenuItem onClick={() => onRequestEditMeta(page)}>{operationT('setting')}</DropdownMenuItem>
        <DropdownMenuItem asChild><a href={getPageOpenUrl(page)} target="_blank" rel="noreferrer">{operationT(isPreview(page) ? 'preview' : 'view')}</a></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={togglePrivate}>{operationT(page.isPrivate ? 'set_public' : 'set_private')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRequestDelete(page)} className="text-destructive">
          {operationT('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
