import config from "@/config";
import Image from "next/image";

export function AuthHeader() {
  return (
    <div className="flex items-center gap-3 self-center font-bold text-2xl">
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
    </div>
  )
}