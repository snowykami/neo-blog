import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import Link from "next/link"
import { SiGithub } from "react-icons/si";

export function SiteHeader({ title }: { title?: string }) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" className=" h-8 w-8" asChild>
            <Link
              href="https://github.com/snowykami/neo-blog"
              rel="noopener noreferrer"
              target="_blank"
              className="dark:text-foreground"
            >
              <SiGithub className="h-full w-full" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
