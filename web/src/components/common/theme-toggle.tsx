
import { useDevice } from "@/contexts/device-context";
import { Sun, Moon, Monitor } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";

// PC端：三状态轮换按钮
export function ThemeModeCycleButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const { mode, setMode, className, style, onClick, ...rest } = props;
  const nextMode = (mode: ThemeMode): ThemeMode => {
    if (mode === "light") return "dark";
    if (mode === "dark") return "system";
    return "light";
  };
  const icon = mode === "light" ? <Sun className="w-4 h-4" /> : mode === "dark" ? <Moon className="w-4 h-4" /> : <Monitor className="w-4 h-4" />;
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);

  const baseCls = "flex items-center gap-2 px-2 py-2 rounded-full bg-muted hover:bg-accent border border-input text-sm font-medium transition-all";
  const mergedClassName = cn(baseCls, className);

  return (
    <button
      className={mergedClassName}
      style={style}
      onClick={(e) => {
        setMode(nextMode(mode));
        onClick?.(e);
      }}
      title={`切换主题（当前：${label}）`}
      {...rest}
    >
      {icon}
    </button>
  );
}

// 移动端：横向按钮组
export function ThemeModeSegmented(props: React.HTMLAttributes<HTMLDivElement> & { mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const { mode, setMode, className, style, ...rest } = props;
  const modes: { value: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun className="w-4 h-4" />, label: "Light" },
    { value: "system", icon: <Monitor className="w-4 h-4" />, label: "System" },
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
export function ThemeModeToggle(props: React.HTMLAttributes<HTMLElement> = {}) {
  const { isMobile, mode, setMode } = useDevice();
  const Comp: React.ElementType = isMobile ? ThemeModeSegmented : ThemeModeCycleButton;
  const { className, style } = props;
  // 仅转发 className / style，避免复杂的 prop 类型不匹配
  return <Comp mode={mode} setMode={setMode} className={className} style={style} />;
}
