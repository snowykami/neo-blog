import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { useIsMobile } from '@/hooks/use-mobile'

// 手机上按钮之间留 8px（桌面 4px），减少误触；按钮数随之减到 5 个页码，保证一行放得下
const CONTENT_CLASS = 'select-none gap-2 md:gap-1'
const MOBILE_MAX_BUTTONS = 5

interface PaginationControllerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 总条目数（数据项个数，不是页数） */
  total: number
  /** 每页大小 */
  pageSize?: number
  /** 初始页（仅首次生效，之后内部自管理） */
  initialPage?: number
  /** 受控当前页；传入后父组件改变页码（如搜索后重置为 1）时控件会同步 */
  page?: number
  /** 最多显示的按钮数（会强制为 >=5 的奇数） */
  maxButtons?: number
  /** 页码变化回调（用户点击或自动校正时触发） */
  onPageChange?: (page: number) => void
  /** 生成指定页码（1-based）的链接地址；传入非空地址时渲染为可抓取的 <a>，未传或禁用时渲染为语义化 <button> */
  buildHref?: (page: number) => string
  /** 是否禁用交互 */
  disabled?: boolean
  /** 仅一页时隐藏组件（total>0 且 totalPages===1） */
  hideOnSinglePage?: boolean
  /** total 或 pageSize 变化导致越界时是否回调 onPageChange（默认 true） */
  reportAutoAdjust?: boolean
}

export interface PaginationControllerHandle {
  /** 以 1-based 设置当前页，会自动 clamp */
  setPage: (page: number) => void
  /** 获取当前页（1-based） */
  getPage: () => number
}

export const PaginationController = forwardRef<
  PaginationControllerHandle,
  PaginationControllerProps
>(
  (
    {
      total,
      pageSize = 10,
      initialPage = 1,
      page,
      maxButtons = 7,
      onPageChange,
      buildHref,
      disabled = false,
      hideOnSinglePage = false,
      reportAutoAdjust = true,
      className,
      ...rest
    },
    ref,
  ) => {
    const t = useTranslations('Components.pagination')
    const isMobile = useIsMobile()
    // 规范化 maxButtons: 至少5 且为奇数 (便于居中)；手机上最多 5 个
    const maxBtns = useMemo(() => {
      const m = Math.max(5, maxButtons || 7)
      return Math.min(isMobile ? MOBILE_MAX_BUTTONS : Infinity, m % 2 === 0 ? m + 1 : m)
    }, [maxButtons, isMobile])
    const totalPages = useMemo(
      () => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
      [total, pageSize],
    )
    const [currentPage, setCurrentPage] = useState(() => clampPage(page ?? initialPage, totalPages))
    const currentPageRef = useRef(currentPage)
    currentPageRef.current = currentPage
    const onPageChangeRef = useRef(onPageChange)
    onPageChangeRef.current = onPageChange
    // 初始化为初始页码，避免挂载首帧与受控 page 同步时反向回声触发父级 onPageChange
    const lastReportedRef = useRef<number | null>(currentPage)
    const syncingToRef = useRef<{ target: number, rawPage: number } | null>(null)

    // 受控模式：父组件页码变化时同步到内部状态；仅在 currentPage 真正切换到目标页后才对齐 lastReportedRef，
    // 防止同一次提交中旧 currentPage 闭包反向触发 onPageChange(1) 覆盖 URL 页码
    useEffect(() => {
      if (page === undefined)
        return
      const clamped = clampPage(page, totalPages)
      if (clamped !== currentPageRef.current) {
        syncingToRef.current = { target: clamped, rawPage: page }
        setCurrentPage(clamped)
      }
      else {
        syncingToRef.current = null
        if (clamped === page || total === 0 || !reportAutoAdjust)
          lastReportedRef.current = clamped
      }
    }, [page, reportAutoAdjust, total, totalPages])

    // 暴露方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        setPage: (p: number) => {
          syncingToRef.current = null
          setCurrentPage(() => clampPage(p, totalPages))
        },
        getPage: () => currentPage,
      }),
      [currentPage, totalPages],
    )
    // 越界校正（不直接通知父组件）
    useEffect(() => {
      setCurrentPage((prev) => {
        const clamped = clampPage(prev, totalPages)
        return clamped === prev ? prev : clamped
      })
    }, [totalPages])

    // 统一向父组件报告变化，避免在 setState 的 updater 中直接调用父级 setState 引发警告
    useEffect(() => {
      const cb = onPageChangeRef.current
      if (!cb)
        return
      if (syncingToRef.current !== null) {
        if (currentPage !== syncingToRef.current.target)
          return
        const sync = syncingToRef.current
        syncingToRef.current = null
        if (currentPage === sync.rawPage || total === 0 || !reportAutoAdjust) {
          lastReportedRef.current = currentPage
          return
        }
      }
      // 数据尚未加载（total 为 0）时页码会被临时校正为 1，此时不上报，避免把 URL 中的页码重置
      if (total === 0)
        return
      if (lastReportedRef.current === currentPage)
        return
      // 如果是自动校正且不希望报告，则跳过
      if (!reportAutoAdjust && lastReportedRef.current !== null && currentPage > totalPages)
        return
      lastReportedRef.current = currentPage
      cb(currentPage)
    }, [currentPage, reportAutoAdjust, total, totalPages])

    const handleSetPage = useCallback(
      (p: number) => {
        if (disabled)
          return
        syncingToRef.current = null
        setCurrentPage(() => clampPage(p, totalPages))
      },
      [disabled, totalPages],
    )

    // 计算要显示的页码集合
    const pages = useMemo(() => {
      if (totalPages <= maxBtns) {
        return { type: 'all' as const, list: range(1, totalPages) }
      }
      const windowSize = maxBtns - 4 // 去掉首尾及两个潜在省略号
      let start = currentPage - Math.floor(windowSize / 2)
      let end = start + windowSize - 1
      if (start < 3) {
        start = 3
        end = start + windowSize - 1
      }
      if (end > totalPages - 2) {
        end = totalPages - 2
        start = end - windowSize + 1
      }
      return {
        type: 'window' as const,
        list: range(start, end),
        start,
        end,
        windowSize,
      }
    }, [currentPage, maxBtns, totalPages])

    const resolveHref = (p: number) => {
      if (disabled || !buildHref)
        return undefined
      const href = buildHref(p).trim()
      return href.length > 0 ? href : undefined
    }

    // total=0 的场景: 显示单个不可切换页
    if (total === 0) {
      const firstHref = resolveHref(1)
      return (
        <div className={className} {...rest}>
          <Pagination>
            <PaginationContent className={CONTENT_CLASS}>
              <PaginationItem>
                {firstHref
                  ? (
                      <PaginationLink
                        isActive
                        href={firstHref}
                        aria-label={t('go_to_page', { page: 1 })}
                        onClick={(e) => {
                          if (isPlainLeftClick(e))
                            e.preventDefault()
                        }}
                      >
                        1
                      </PaginationLink>
                    )
                  : (
                      <PaginationLink asChild isActive>
                        <button
                          type="button"
                          disabled={disabled}
                          aria-label={t('go_to_page', { page: 1 })}
                        >
                          1
                        </button>
                      </PaginationLink>
                    )}
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )
    }

    if (hideOnSinglePage && totalPages === 1) {
      return null
    }

    const renderPage = (p: number) => {
      const href = resolveHref(p)
      const active = p === currentPage
      return (
        <PaginationItem key={p}>
          {href
            ? (
                <PaginationLink
                  href={href}
                  isActive={active}
                  aria-label={t('go_to_page', { page: p })}
                  onClick={(e) => {
                    if (isPlainLeftClick(e)) {
                      e.preventDefault()
                      handleSetPage(p)
                    }
                  }}
                >
                  {p}
                </PaginationLink>
              )
            : (
                <PaginationLink asChild isActive={active}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t('go_to_page', { page: p })}
                    onClick={() => handleSetPage(p)}
                  >
                    {p}
                  </button>
                </PaginationLink>
              )}
        </PaginationItem>
      )
    }

    const prevDisabled = disabled || currentPage <= 1
    const nextDisabled = disabled || currentPage >= totalPages
    const prevHref = !prevDisabled ? resolveHref(currentPage - 1) : undefined
    const nextHref = !nextDisabled ? resolveHref(currentPage + 1) : undefined

    return (
      <div className={className} {...rest}>
        <Pagination>
          <PaginationContent className={CONTENT_CLASS}>
            <PaginationItem>
              {prevHref
                ? (
                    <PaginationPrevious
                      href={prevHref}
                      aria-label={t('previous_page')}
                      onClick={(e) => {
                        if (isPlainLeftClick(e)) {
                          e.preventDefault()
                          handleSetPage(currentPage - 1)
                        }
                      }}
                    />
                  )
                : (
                    <PaginationPrevious asChild aria-label={t('previous_page')}>
                      <button
                        type="button"
                        disabled={prevDisabled}
                        onClick={() => handleSetPage(currentPage - 1)}
                      >
                        <ChevronLeftIcon aria-hidden />
                      </button>
                    </PaginationPrevious>
                  )}
            </PaginationItem>

            {pages.type === 'all' && pages.list.map(renderPage)}

            {pages.type === 'window' && (
              <>
                {renderPage(1)}
                {/* 前省略号 */}
                {pages.start! > 3
                  ? (
                      <PaginationItem>
                        <PaginationEllipsis aria-hidden />
                      </PaginationItem>
                    )
                  : (
                      renderPage(2)
                    )}

                {pages.list.map(renderPage)}

                {/* 后省略号 */}
                {pages.end! < totalPages - 2
                  ? (
                      <PaginationItem>
                        <PaginationEllipsis aria-hidden />
                      </PaginationItem>
                    )
                  : (
                      renderPage(totalPages - 1)
                    )}
                {renderPage(totalPages)}
              </>
            )}

            <PaginationItem>
              {nextHref
                ? (
                    <PaginationNext
                      href={nextHref}
                      aria-label={t('next_page')}
                      onClick={(e) => {
                        if (isPlainLeftClick(e)) {
                          e.preventDefault()
                          handleSetPage(currentPage + 1)
                        }
                      }}
                    />
                  )
                : (
                    <PaginationNext asChild aria-label={t('next_page')}>
                      <button
                        type="button"
                        disabled={nextDisabled}
                        onClick={() => handleSetPage(currentPage + 1)}
                      >
                        <ChevronRightIcon aria-hidden />
                      </button>
                    </PaginationNext>
                  )}
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    )
  },
)

// -------- helpers --------
function isPlainLeftClick(e: React.MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

function clampPage(p: number, totalPages: number) {
  if (Number.isNaN(p))
    return 1
  return Math.min(Math.max(1, Math.floor(p)), Math.max(1, totalPages))
}

function range(start: number, end: number) {
  const arr: number[] = []
  for (let i = start; i <= end; i++) arr.push(i)
  return arr
}
