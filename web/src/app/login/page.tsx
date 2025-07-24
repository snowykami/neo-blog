import { GalleryVerticalEnd } from "lucide-react"

import Image from "next/image"
import { LoginForm } from "@/components/login-form"
import config from "@/config"

export default function LoginPage() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-3 self-center font-bold text-2xl">
          <div className="flex size-10 items-center justify-center rounded-full overflow-hidden border-2 border-gray-300 dark:border-gray-600">
            <Image
              src={config.metadata.icon}
              alt="Logo"
              width={40}
              height={40}
              className="rounded-full object-cover"
            />
          </div>
          <span className="font-bold text-2xl">{config.metadata.name}</span>
        </a>
        <LoginForm />
      </div>
    </div>
  )
}
