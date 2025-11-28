import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SearchMode } from '@/models/common'

// interface Mode {
//   name: SearchMode
// }

export function SearchModeSelector({
  initialMode,
  onSearchModeChange,
}: {
  initialMode: SearchMode
  onSearchModeChange: (mode: SearchMode) => void
}) {
  const orderT = useTranslations('searchModes')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SearchMode>(initialMode)

  const searchModesList: SearchMode[] = [
    SearchMode.All,
    SearchMode.Title,
    SearchMode.Content,
    SearchMode.Tag,
  ]
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button variant="outline" onClick={() => setOpen(!open)}>
          <div className="text-sm font-bold hidden md:block">{orderT('searchModes')}</div>
          {orderT(mode)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0" // 宽度自适应，无内边距
        align="end" // 靠右对齐
        side="bottom" // 显示在触发元素下方
        sideOffset={8} // 与触发元素的间距为8px
      >
        <div className="flex flex-col">
          {searchModesList.map((mo, index) => ( // 修正map回调函数语法
            <Button
              key={index}
              variant="ghost"
              size="sm"
              className={`justify-start ${mo === mode ? 'bg-accent' : ''}`}
              onClick={() => {
                onSearchModeChange(mo)
                setMode(mo)
                setOpen(false)
              }}
            >
              {orderT(mo)}
              {' '}
              {/* 修正为当前遍历项mo的name */}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
