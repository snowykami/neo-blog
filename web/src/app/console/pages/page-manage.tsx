'use client'

import type { PageModel } from '@/models/page'
import type { BaseResponseError } from '@/models/resp'
import { Ellipsis, Eye } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { deletePage, listPages, updatePage } from '@/api/page'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
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
import { useDebouncedState } from '@/hooks/use-debounce'
import { useDoubleConfirm } from '@/hooks/use-double-confirm'
import { useOperationT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { getErrorMessage } from '@/utils/common/error'
import { getPageEditUrl, getPageUrl } from '@/utils/common/route'
import { PageMetaDialog } from './page-meta-dialog'

const PAGE_SIZE = 15

export function PageManage() {
  const { user } = useAuth()
  const t = useTranslations('Console.pages')
  const operationT = useOperationT()
  const [pages, setPages] = useState<PageModel[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(PAGE_SIZE)
  const [queryInput, setQueryInput, debouncedQueryInput] = useDebouncedState('', 200)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const loadPages = useCallback(() => {
    if (!user)
      return
    listPages({
      page,
      size,
      query: debouncedQueryInput,
      noContent: true,
      userId: user.id,
      orderBy: OrderBy.CreatedAt,
      desc: true,
    }).then((res) => {
      setPages(res.data.pages)
      setTotal(res.data.total)
    }).catch((error: BaseResponseError) => {
      toast.error(`${operationT('fetch_failed')}: ${getErrorMessage(error)}`)
    })
  }, [debouncedQueryInput, operationT, page, size, user])

  useEffect(() => {
    loadPages()
  }, [loadPages])

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
    setPages(prev => prev.map(item => (item.id === page.id ? { ...item, ...page } : item)))
  }, [pages, loadPages])

  const onPageDelete = useCallback(({ pageId }: { pageId: number }) => {
    setPages(prev => prev.filter(item => item.id !== pageId))
    setTotal(prev => Math.max(0, prev - 1))
  }, [])

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
          initialSize={size}
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
  return (
    <div className="flex w-full items-center gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{page.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            ID:
            {page.id}
          </Badge>
          <Badge variant="secondary">{page.slug}</Badge>
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
        <Button variant="ghost" size="sm" asChild>
          <a href={getPageUrl(page)} target="_blank" rel="noreferrer"><Eye className="size-4" /></a>
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
  const { confirming, onBlur, onClick } = useDoubleConfirm()

  const togglePrivate = () => {
    updatePage({ page: { id: page.id, isPrivate: !page.isPrivate } })
      .then(() => {
        toast.success(operationT('update_success'))
        onPageChange({ page: { id: page.id, isPrivate: !page.isPrivate } })
      })
      .catch((error: BaseResponseError) => toast.error(`${operationT('update_failed')}: ${getErrorMessage(error)}`))
  }

  const handleDelete = () => {
    deletePage({ id: page.id })
      .then(() => {
        toast.success(operationT('delete_success'))
        onPageDelete({ pageId: page.id })
      })
      .catch((error: BaseResponseError) => toast.error(`${operationT('delete_failed')}: ${getErrorMessage(error)}`))
  }

  return (
    <DropdownMenu onOpenChange={open => !open && onBlur()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost"><Ellipsis className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem asChild><a href={getPageEditUrl(page)}>{operationT('edit')}</a></DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMetaDialogOpen(true)}>{operationT('setting')}</DropdownMenuItem>
        <DropdownMenuItem asChild><a href={getPageUrl(page)} target="_blank" rel="noreferrer">{operationT('view')}</a></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={togglePrivate} className="text-destructive">{operationT(page.isPrivate ? 'set_public' : 'set_private')}</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            if (!confirming)
              event.preventDefault()
            onClick(handleDelete)
          }}
          className="text-destructive"
        >
          {confirming ? operationT('confirm_delete') : operationT('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
