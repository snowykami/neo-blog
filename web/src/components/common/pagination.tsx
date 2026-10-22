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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
      disabled = false,
      hideOnSinglePage = false,
      reportAutoAdjust = true,
      className,
      ...rest
    },
    ref,
  ) => {
    const t = useTranslations('Components.pagination')
    // 规范化 maxButtons: 至少5 且为奇数 (便于居中)
    const maxBtns = useMemo(() => {
      const m = Math.max(5, maxButtons || 7)
      return m % 2 === 0 ? m + 1 : m
    }, [maxButtons])
    const totalPages = useMemo(
      () => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
      [total, pageSize],
    )
    const [currentPage, setCurrentPage] = useState(() => clampPage(page ?? initialPage, totalPages))

    // 受控模式：父组件页码变化时同步到内部状态
    useEffect(() => {
      if (page === undefined)
        return
      setCurrentPage(prev => (prev === page ? prev : clampPage(page, totalPages)))
    }, [page, totalPages])

    // 暴露方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        setPage: (p: number) => setCurrentPage(() => clampPage(p, totalPages)),
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
    const lastReportedRef = useRef<number | null>(null)
    useEffect(() => {
      if (!onPageChange)
        return
      // 数据尚未加载（total 为 0）时页码会被临时校正为 1，此时不上报，避免把 URL 中的页码重置
      if (total === 0)
        return
      if (lastReportedRef.current === currentPage)
        return
      // 如果是自动校正且不希望报告，则跳过
      if (!reportAutoAdjust && lastReportedRef.current !== null && currentPage > totalPages)
        return
      lastReportedRef.current = currentPage
      onPageChange(currentPage)
    }, [currentPage, onPageChange, reportAutoAdjust, total, totalPages])

    const handleSetPage = useCallback(
      (p: number) => {
        if (disabled)
          return
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

    // total=0 的场景: 显示单个不可切换页
    if (total === 0) {
      return (
        <div className={className} {...rest}>
          <Pagination>
            <PaginationContent className="select-none">
              <PaginationItem>
                <PaginationLink isActive aria-current="page">
                  1
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )
    }

    if (hideOnSinglePage && totalPages === 1) {
      return null
    }

    const renderPage = (p: number) => (
      <PaginationItem key={p}>
        <PaginationLink
          isActive={p === currentPage}
          aria-current={p === currentPage ? 'page' : undefined}
          aria-label={t('go_to_page', { page: p })}
          onClick={(e) => {
            e.preventDefault()
            handleSetPage(p)
          }}
          tabIndex={disabled ? -1 : 0}
        >
          {p}
        </PaginationLink>
      </PaginationItem>
    )

    const prevDisabled = disabled || currentPage === 1
    const nextDisabled = disabled || currentPage === totalPages

    return (
      <div className={className} {...rest}>
        <Pagination>
          <PaginationContent className="select-none">
            <PaginationItem>
              <PaginationPrevious
                aria-disabled={prevDisabled}
                aria-label={t('previous_page')}
                tabIndex={prevDisabled ? -1 : 0}
                onClick={(e) => {
                  if (prevDisabled)
                    return
                  e.preventDefault()
                  handleSetPage(currentPage - 1)
                }}
              />
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
              <PaginationNext
                aria-disabled={nextDisabled}
                aria-label={t('next_page')}
                tabIndex={nextDisabled ? -1 : 0}
                onClick={(e) => {
                  if (nextDisabled)
                    return
                  e.preventDefault()
                  handleSetPage(currentPage + 1)
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    )
  },
)

// -------- helpers --------
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

const PAGE_SIZE_OPTIONS = [10, 15, 20, 30, 50, 100]

export function PageSizeSelector({
  size,
  initialSize,
  onSizeChange,
  options = PAGE_SIZE_OPTIONS,
}: {
  /** 受控每页条数（推荐），通常来自 URL 状态 */
  size?: number
  /** @deprecated 仅在未传入 size 时作为非受控初始值，保留以兼容旧调用 */
  initialSize?: number
  onSizeChange: (size: number) => void
  /** 可选的每页条数列表 */
  options?: number[]
}) {
  const t = useTranslations('Components.pagination')
  const [innerSize, setInnerSize] = useState(initialSize || 10)
  const current = size ?? innerSize
  // 当前值不在候选列表中时（如移动端默认值）也要能正常显示
  const sizeList = options.includes(current)
    ? options
    : [...options, current].sort((a, b) => a - b)
  return (
    <Select
      value={String(current)}
      onValueChange={(value) => {
        const next = Number(value)
        if (size === undefined)
          setInnerSize(next)
        onSizeChange(next)
      }}
    >
      <SelectTrigger size="sm" className="w-auto" aria-label={t('page_size')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sizeList.map(item => (
          <SelectItem key={item} value={String(item)}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
