import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingPage() {
  return <div>
    <h2 className="text-2xl font-bold">
      全局设置
    </h2>
    <div className="grid w-full max-w-sm items-center gap-3 mt-4">
      <Label htmlFor="themeColor">配色方案</Label>
      <Input type="color" id="themeColor" />
    </div>
  </div>;
}

export function ColorPick() {

}