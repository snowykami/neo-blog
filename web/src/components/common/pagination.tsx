import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface PaginationControllerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 总条目数（数据项个数，不是页数） */
  total: number
  /** 每页大小 */
  pageSize?: number
  /** 初始页（仅首次生效，之后内部自管理） */
  initialPage?: number
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

export const PaginationController = forwardRef<PaginationControllerHandle, PaginationControllerProps>(({
  total,
  pageSize = 10,
  initialPage = 1,
  maxButtons = 7,
  onPageChange,
  disabled = false,
  hideOnSinglePage = false,
  reportAutoAdjust = true,
  className,
  ...rest
}, ref) => {
  // 规范化 maxButtons: 至少5 且为奇数 (便于居中)
  const maxBtns = useMemo(() => {
    const m = Math.max(5, maxButtons || 7)
    return m % 2 === 0 ? m + 1 : m
  }, [maxButtons])
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / Math.max(1, pageSize))), [total, pageSize])
  const [currentPage, setCurrentPage] = useState(() => clampPage(initialPage, totalPages))

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    setPage: (p: number) => setCurrentPage(() => clampPage(p, totalPages)),
    getPage: () => currentPage,
  }), [currentPage, totalPages])
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
    if (lastReportedRef.current === currentPage)
      return
    // 如果是自动校正且不希望报告，则跳过
    if (!reportAutoAdjust && lastReportedRef.current !== null && currentPage > totalPages)
      return
    lastReportedRef.current = currentPage
    onPageChange(currentPage)
  }, [currentPage, onPageChange, reportAutoAdjust, totalPages])

  const handleSetPage = useCallback((p: number) => {
    if (disabled)
      return
    setCurrentPage(() => clampPage(p, totalPages))
  }, [disabled, totalPages])

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
    return { type: 'window' as const, list: range(start, end), start, end, windowSize }
  }, [currentPage, maxBtns, totalPages])

  // total=0 的场景: 显示单个不可切换页
  if (total === 0) {
    return (
      <div className={className} {...rest}>
        <Pagination>
          <PaginationContent className="select-none">
            <PaginationItem>
              <PaginationLink isActive aria-current="page">1</PaginationLink>
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
        aria-label={`Go to page ${p}`}
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
              aria-label="Previous page"
              tabIndex={prevDisabled ? -1 : 0}
              onClick={(e) => {
                if (prevDisabled)
                  return
                e.preventDefault()
                handleSetPage(currentPage - 1)
              }}
            />
          </PaginationItem>

          {pages.type === 'all' && (
            pages.list.map(renderPage)
          )}

          {pages.type === 'window' && (
            <>
              {renderPage(1)}
              {/* 前省略号 */}
              {pages.start! > 3
                ? (
                    <PaginationItem>
                      <PaginationEllipsis aria-hidden aria-label="Truncated" />
                    </PaginationItem>
                  )
                : renderPage(2)}

              {pages.list.map(renderPage)}

              {/* 后省略号 */}
              {pages.end! < totalPages - 2
                ? (
                    <PaginationItem>
                      <PaginationEllipsis aria-hidden aria-label="Truncated" />
                    </PaginationItem>
                  )
                : renderPage(totalPages - 1)}
              {renderPage(totalPages)}
            </>
          )}

          <PaginationItem>
            <PaginationNext
              aria-disabled={nextDisabled}
              aria-label="Next page"
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
})

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

export function PageSizeSelector({ initialSize, onSizeChange }: { initialSize?: number, onSizeChange: (size: number) => void }) {
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState(initialSize || 10)
  const sizeList = [10, 20, 30, 50, 100]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {size}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <div className="flex flex-col">
          {sizeList.map(item => (
            <Button
              key={item}
              variant="ghost"
              size="sm"
              onClick={() => {
                setSize(item)
                setOpen(false)
                onSizeChange(item)
              }}
            >
              {item}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
