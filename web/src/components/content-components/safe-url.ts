/**
 * 与组件共用的纯校验 / 正则辅助函数（不带 `'use client'`，也不引入 `zod`）。
 *
 * 为什么必须放在独立纯 `.ts` 文件中（双向陷阱）：
 * - 若放进 `*.content.ts` 或 `schema.ts`：纯展示视图（*.tsx）导入时会把 `zod` 连带拖进前台访客包；
 * - 若放进带 `'use client'` 的 `.tsx` 视图再由 `*.content.ts` 反向导入：`*.content.ts` 中的 `fallback` / `schema`
 *   在服务端（RSC / Node）执行时拿到的是 React Client Reference 代理而非真实函数，会导致服务端调用报错。
 */

// 与后端校验规则一致的 GitHub owner/repo 格式（含排除末端 . / ..）
export const GITHUB_REPO_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,38}\/[\w.-]{1,100}$/i

export function isSafeGithubRepo(repo: string): boolean {
  const trimmed = repo.trim()
  return GITHUB_REPO_PATTERN.test(trimmed) && !/\/\.{1,2}$/.test(trimmed)
}

/** 链接 / 媒体地址安全校验：只允许 http(s) 绝对地址（allowRelative 时还允许站内 / 路径），拒绝 javascript: 等危险协议 */
export function isSafeHref(value: string, allowRelative = false): boolean {
  const trimmed = value.trim()
  // 站内相对路径：以单个 / 开头（排除 //host 形式的协议相对地址）
  if (allowRelative && /^\/(?!\/)/.test(trimmed))
    return true
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}
