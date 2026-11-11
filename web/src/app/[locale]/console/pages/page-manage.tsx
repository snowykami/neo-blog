'use client'

import type { PageModel } from '@/models/page'
import type { BaseResponseError } from '@/models/resp'
import { CodeXmlIcon, Ellipsis, Eye, LinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { deletePage, listPages, updatePage } from '@/api/page'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/auth-context'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { OrderBy } from '@/models/common'
import { getPageEditUrl, getPageUrl } from '@/utils/common/route'
import { PageMetaDialog } from './page-meta-dialog'

const PAGE_SIZE = 15

// 查看：链接页面直接打开其地址
function getPageViewUrl(page: PageModel) {
  return page.kind === 'link' && page.linkUrl ? page.linkUrl : getPageUrl(page)
}

// 列表为空时的固定引用：onPageChange 的 useCallback 依赖 pages
const EMPTY_PAGES: PageModel[] = []

export function PageManage() {
  const { user } = useAuth()
  const t = useTranslations('Console.pages')
  const errorMessageT = useErrorMessageT()
  const operationT = useOperationT()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(PAGE_SIZE)
  const [queryInput, setQueryInput, debouncedQueryInput] = useDebouncedState('', 200)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const pagesQuery = useConsoleQuery(
    user ? ['page/list', page, size, debouncedQueryInput] : null,
    () => listPages({
      page,
      size,
      query: debouncedQueryInput,
      noContent: true,
      userId: user!.id,
      orderBy: OrderBy.CreatedAt,
      desc: true,
    }).then(res => ({ pages: res.data.pages, total: res.data.total })),
    { onError: error => toast.error(`${operationT('fetch_failed')}: ${errorMessageT(error)}`) },
  )
  const pages = pagesQuery.data?.pages ?? EMPTY_PAGES
  const total = pagesQuery.data?.total ?? 0
  const { refresh: loadPages, setData: setPageList } = pagesQuery

  // 搜索词变化时回到第一页
  const prevQueryRef = useRef(debouncedQueryInput)
  useEffect(() => {
    if (prevQueryRef.current === debouncedQueryInput)
      return
    prevQueryRef.current = debouncedQueryInput
    setPage(1)
  }, [debouncedQueryInput])

  // 已有页面就地更新；新建页面需要后端的排序与分页结果，重新拉取列表
  const onPageChange = useCallback(({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => {
    if (!pages.some(item => item.id === page.id)) {
      loadPages()
      return
    }
    setPageList(prev => prev && { ...prev, pages: prev.pages.map(item => (item.id === page.id ? { ...item, ...page } : item)) })
  }, [pages, loadPages, setPageList])

  const onPageDelete = useCallback(({ pageId }: { pageId: number }) => {
    setPageList(prev => prev && { pages: prev.pages.filter(item => item.id !== pageId), total: Math.max(0, prev.total - 1) })
  }, [setPageList])

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <Input
          type="search"
          placeholder={t('search_pages')}
          value={queryInput}
          onChange={event => setQueryInput(event.target.value)}
          className="max-w-sm"
        />
        <Button size="sm" onClick={() => setCreateDialogOpen(true)}>{t('create_page')}</Button>
        <PageMetaDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          page={null}
          onPageChange={onPageChange}
        />
      </div>
      <Separator />
      {pages.map(pageItem => (
        <div key={pageItem.id}>
          <PageItem page={pageItem} onPageChange={onPageChange} onPageDelete={onPageDelete} />
          <Separator />
        </div>
      ))}
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

function PageItem({
  onPageChange,
  onPageDelete,
  page,
}: {
  onPageChange: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  onPageDelete: ({ pageId }: { pageId: number }) => void
  page: PageModel
}) {
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const t = useTranslations('Console.pages')
  const stateT = useTranslations('State')
  const operationT = useOperationT()
  return (
    <div className="flex w-full items-center gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{page.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
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
          <Badge className={page.isPrivate ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}>
            {page.isPrivate ? stateT('private') : stateT('public')}
          </Badge>
          {page.showInNav && (
            <Badge className="bg-blue-100 text-blue-800">
              {t('nav_order', { order: page.navOrder })}
            </Badge>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <a href={getPageViewUrl(page)} target="_blank" rel="noreferrer" aria-label={operationT('view')} title={operationT('view')}>
            <Eye className="size-4" />
          </a>
        </Button>
        <PageDropdownMenu page={page} onPageChange={onPageChange} onPageDelete={onPageDelete} setMetaDialogOpen={setMetaDialogOpen} />
        <PageMetaDialog
          open={metaDialogOpen}
          onOpenChange={setMetaDialogOpen}
          page={page}
          onPageChange={onPageChange}
        />
      </div>
    </div>
  )
}

function PageDropdownMenu({
  onPageChange,
  onPageDelete,
  page,
  setMetaDialogOpen,
}: {
  onPageChange: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  onPageDelete: ({ pageId }: { pageId: number }) => void
  page: PageModel
  setMetaDialogOpen: (open: boolean) => void
}) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const togglePrivate = () => {
    updatePage({ page: { id: page.id, isPrivate: !page.isPrivate } })
      .then(() => {
        toast.success(operationT('update_success'))
        onPageChange({ page: { id: page.id, isPrivate: !page.isPrivate } })
      })
      .catch((error: BaseResponseError) => toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`))
  }

  // 失败时抛出，由 Popconfirm 统一提示并保持打开
  const handleDelete = async () => {
    await deletePage({ id: page.id })
    toast.success(operationT('delete_success'))
    onPageDelete({ pageId: page.id })
  }

  return (
    <DropdownMenu>
      {/* 菜单项关闭菜单后，删除确认气泡以菜单按钮为锚点就地弹出 */}
      <Popconfirm
        anchorOnly
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={page.title ? operationT('delete_confirm_title', { name: page.title }) : operationT('confirm_delete')}
        description={operationT('delete_description')}
        confirmText={operationT('delete')}
        errorText={operationT('delete_failed')}
        destructive
        onConfirm={handleDelete}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={operationT('more')} title={operationT('more')}>
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Popconfirm>
      <DropdownMenuContent
        className="min-w-36"
        align="end"
        // 打开删除确认时不把焦点还给菜单按钮，焦点交给气泡
        onCloseAutoFocus={e => confirmOpen && e.preventDefault()}
      >
        {/* 链接页面没有正文，编辑即打开设置 */}
        {page.kind === 'link'
          ? <DropdownMenuItem onClick={() => setMetaDialogOpen(true)}>{operationT('edit')}</DropdownMenuItem>
          // 客户端跳转（不整页刷新）；菜单打开时（链接挂载）就完整预取编辑器的页面与 JS
          : <DropdownMenuItem asChild><Link href={getPageEditUrl(page)} prefetch>{operationT('edit')}</Link></DropdownMenuItem>}
        <DropdownMenuItem onClick={() => setMetaDialogOpen(true)}>{operationT('setting')}</DropdownMenuItem>
        <DropdownMenuItem asChild><a href={getPageViewUrl(page)} target="_blank" rel="noreferrer">{operationT('view')}</a></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={togglePrivate}>{operationT(page.isPrivate ? 'set_public' : 'set_private')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setConfirmOpen(true)} className="text-destructive">
          {operationT('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
