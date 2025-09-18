import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { useEffect, useState, useCallback } from "react"

export function PaginationController({
  initialPage = 1,
  totalPages = 10,
  buttons = 7, // recommended odd number >=5
  onPageChange,
  ...props
}: {
  initialPage?: number
  totalPages: number
  buttons?: number
  onPageChange?: (page: number) => void
} & React.HTMLAttributes<HTMLDivElement>) {
  const btns = Math.max(5, buttons ?? 7);
  const buttonsToShow = totalPages < btns ? totalPages : btns;

  const [currentPage, setCurrentPage] = useState(() => Math.min(Math.max(1, initialPage ?? 1), Math.max(1, totalPages)));
  useEffect(() => {
    const p = Math.min(Math.max(1, initialPage ?? 1), Math.max(1, totalPages));
    setCurrentPage(p);
  }, [initialPage, totalPages]);

  const handleSetPage = useCallback((p: number) => {
    const next = Math.min(Math.max(1, Math.floor(p)), Math.max(1, totalPages));
    setCurrentPage(next);
    if (typeof onPageChange === 'function') onPageChange(next);
  }, [onPageChange, totalPages]);

  // helper to render page link
  const renderPage = (pageNum: number) => (
    <PaginationItem key={pageNum}>
      <PaginationLink
        isActive={pageNum === currentPage}
        aria-current={pageNum === currentPage ? 'page' : undefined}
        onClick={() => handleSetPage(pageNum)}
        type="button"
      >
        {pageNum}
      </PaginationLink>
    </PaginationItem>
  );

  // if totalPages small, render all
  if (totalPages <= buttonsToShow) {
    return (
      <Pagination>
        <PaginationContent className="select-none">
          <PaginationItem>
            <PaginationPrevious
              aria-disabled={currentPage === 1}
              onClick={() => currentPage > 1 && handleSetPage(currentPage - 1)}
            />
          </PaginationItem>
          {Array.from({ length: totalPages }).map((_, i) => renderPage(i + 1))}
          <PaginationItem>
            <PaginationNext
              aria-disabled={currentPage === totalPages}
              onClick={() => currentPage < totalPages && handleSetPage(currentPage + 1)}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  }

  // for larger totalPages, show: 1, 2 or ellipsis, center range, ellipsis or N-1, N
  const centerCount = buttonsToShow - 4; // slots for center pages
  let start = currentPage - Math.floor(centerCount / 2);
  let end = start + centerCount - 1;
  if (start < 3) {
    start = 3;
    end = start + centerCount - 1;
  }
  if (end > totalPages - 2) {
    end = totalPages - 2;
    start = end - (centerCount - 1);
  }

  const centerPages = [] as number[];
  for (let i = start; i <= end; i++) centerPages.push(i);

  return (
    <div {...props}>
      <Pagination >
        <PaginationContent className="select-none">
          <PaginationItem>
            <PaginationPrevious aria-disabled={currentPage === 1} onClick={() => currentPage > 1 && handleSetPage(currentPage - 1)} />
          </PaginationItem>

          {renderPage(1)}

          {/* second slot: either page 2 or ellipsis if center starts later */}
          {start > 3 ? (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          ) : renderPage(2)}

          {/* center pages */}
          {centerPages.map((p) => (
            <PaginationItem key={p}>
              <PaginationLink
                isActive={p === currentPage}
                aria-current={p === currentPage ? 'page' : undefined}
                onClick={() => handleSetPage(p)}
                type="button"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ))}

          {end < totalPages - 2 ? (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          ) : renderPage(totalPages - 1)}

          {renderPage(totalPages)}

          <PaginationItem>
            <PaginationNext aria-disabled={currentPage === totalPages} onClick={() => currentPage < totalPages && handleSetPage(currentPage + 1)} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
