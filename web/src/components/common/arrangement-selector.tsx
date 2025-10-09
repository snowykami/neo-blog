import { Grid3X3, LayoutGrid, List } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ArrangementMode } from '@/models/common'

const ARRANGEMENT_MODE_ICONS = {
  [ArrangementMode.Grid]: Grid3X3,
  [ArrangementMode.List]: List,
  [ArrangementMode.Card]: LayoutGrid,
}

export function ArrangementSelector({
  initialArrangement,
  onArrangementChange,
  arrangementModes,
}: {
  initialArrangement: ArrangementMode
  arrangementModes?: ArrangementMode[]
  onArrangementChange: (arrangement: ArrangementMode) => void
}) {
  const arrangementT = useTranslations('Arrangement')
  const [open, setOpen] = useState(false)
  const [arrangement, setArrangement] = useState<ArrangementMode>(initialArrangement)

  arrangementModes = arrangementModes || [ArrangementMode.Grid, ArrangementMode.List, ArrangementMode.Card]

  const handleArrangementChange = (newArrangement: ArrangementMode) => {
    onArrangementChange(newArrangement)
    setArrangement(newArrangement)
    setOpen(false)
  }

  const getCurrentIcon = () => {
    const IconComponent = ARRANGEMENT_MODE_ICONS[arrangement]
    return IconComponent ? <IconComponent className="w-4 h-4" /> : null
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {getCurrentIcon()}
          <span className="ml-1 hidden md:block">{arrangementT(arrangement)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end" side="bottom" sideOffset={8}>
        <div className="flex flex-col">
          {arrangementModes.map((am) => {
            const IconComponent = ARRANGEMENT_MODE_ICONS[am]

            return (
              <Button
                key={am}
                variant="ghost"
                size="sm"
                className={`justify-start ${
                  arrangement === am ? 'bg-accent' : ''
                }`}
                onClick={() => handleArrangementChange(am)}
              >
                {IconComponent && <IconComponent className="w-4 h-4 mr-2" />}
                {arrangementT(am)}
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
