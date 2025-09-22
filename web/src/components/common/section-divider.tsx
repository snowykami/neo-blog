import { cn } from "@/lib/utils";

export function SectionDivider({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={
        cn("after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t",
          className)
      }
    >
      <span className="bg-card text-muted-foreground relative z-10 px-2" {...props}>
      </span>
    </div>
  );
}