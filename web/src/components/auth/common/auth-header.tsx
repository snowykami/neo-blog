import config from "@/config";
import Image from "next/image";
import Link from "next/link";

export function AuthHeader() {
  return (
    <div className="flex items-center gap-2 self-center font-bold text-2xl">
      <Link href="/" className="flex items-center gap-3">
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
      </Link>
    </div>
  )
}