import type { CaptchaProps } from '@/types/captcha'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import AIOCaptchaWidget from '.'

export function DialogCaptcha({ className, ...props }: React.ComponentProps<'div'> & CaptchaProps) {
  return (
    <div className={cn(className)}>
      <Dialog>
        <DialogTrigger>{props.children}</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Captcha</DialogTitle>
          </DialogHeader>
          <AIOCaptchaWidget {...props} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
