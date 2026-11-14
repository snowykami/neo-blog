/**
 * 快捷键拆分纯辅助函数（不带 `'use client'`，也不引入 `zod`）。
 * 独立存放原因同 content-components/safe-url.ts：同时被 `kbd.content.ts`（写路径/服务端降级，带 zod）
 * 与 `kbd.content-view.tsx`（读路径/前台 `'use client'` 纯视图，0 Zod）复用，既不能让视图引入 zod，
 * 也不能让定义文件从 `'use client'` 视图反向导入函数导致 RSC 拿到 Client Reference 代理。
 */

/** 按 + 拆分快捷键序列并去除首尾空白 */
export function splitKeys(keys: string): string[] {
  return keys.split('+').map(key => key.trim()).filter(Boolean)
}
