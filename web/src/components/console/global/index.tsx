import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function GlobalPage() {
  return (
    <div>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">
          全局设置
        </h1>
        <div className="grid w-full max-w-sm items-center gap-3 mt-4">
          <Label htmlFor="themeColor">配色方案</Label>
          <Input type="color" id="themeColor" />
        </div>
      </div>
    </div>
  )
}

export function ColorPick() {

}
