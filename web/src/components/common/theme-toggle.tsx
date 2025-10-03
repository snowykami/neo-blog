
import { useDevice } from "@/contexts/device-context";
import { Sun, Moon, SunMoon } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";

// PC端：三状态轮换按钮
export function ThemeModeCycleButton({ mode, setMode }: { mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const nextMode = (mode: ThemeMode): ThemeMode => {
    if (mode === "light") return "dark";
    if (mode === "dark") return "system";
    return "light";
  };
  const icon = mode === "light" ? <Sun className="w-6 h-6" /> : mode === "dark" ? <Moon className="w-6 h-6" /> : <SunMoon className="w-6 h-6" />;
  return (
    <div
      className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-accent/50 transition-all duration-200 text-primary"
      onClick={() => setMode(nextMode(mode))}
      title={mode === "light" ? "Light Mode" : mode === "dark" ? "Dark Mode" : "System Mode"}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          setMode(nextMode(mode));
        }
      }}
    >
      {icon}
    </div>
  );
}

// 移动端：横向按钮组
export function ThemeModeSegmented(props: React.HTMLAttributes<HTMLDivElement> & { mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const { mode, setMode, className, style, ...rest } = props;
  const modes: { value: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun className="w-4 h-4" />, label: "Light" },
    { value: "system", icon: <SunMoon className="w-4 h-4" />, label: "System" },
    { value: "dark", icon: <Moon className="w-4 h-4" />, label: "Dark" },
  ];
  const activeIndex = modes.findIndex((m) => m.value === mode);
  const baseCls = "relative inline-flex bg-muted rounded-full p-1 gap-1 overflow-hidden";

  return (
    <div className={cn("theme-mode-segmented-wrapper", className)} style={style} {...rest}>
      <div className={baseCls}>
        {/* 滑动高亮块 */}
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="absolute w-12 h-8 rounded-full bg-white/70 shadow-sm z-1 top-1"
          style={{
            left: `calc(0.25rem + ${activeIndex} * (3rem + 0.25rem))`,
          }}
        />
        {modes.map((m) => (
          <button
            key={m.value}
            className={cn(
              "relative flex items-center justify-center w-12 h-8 rounded-full text-sm font-medium transition-all z-10",
              mode === m.value ? "text-primary" : "text-muted-foreground"
            )}
            onClick={() => setMode(m.value)}
            type="button"
          >
            {m.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

// 总组件：根据设备类型渲染
export function ThemeModeToggle(props: React.HTMLAttributes<HTMLElement> & { showSegmented?: boolean }) {
  const { mode, setMode } = useDevice();
  const Comp: React.ElementType = props.showSegmented ? ThemeModeSegmented : ThemeModeCycleButton;
  const { className, style } = props;
  return <Comp mode={mode} setMode={setMode} className={className} style={style} />;
}
