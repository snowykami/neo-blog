/**
 * 浏览器直连后端的地址（可选）。
 *
 * 不配置时，浏览器把请求发到同源的 `/api/v1`，由 `app/api/v1/[...path]` 转发给后端；
 * 配置后浏览器直接请求这个地址，省掉前端这一跳（以及大响应经 Next 转发的那一段）。
 *
 * 构建期变量 `NEXT_PUBLIC_BACKEND_URL`（Next 原生内联的浏览器可见变量）。
 *
 * 跨源部署的额外要求（不在前端代码里）：
 * - 后端要对博客源返回 CORS 头，且带 `Access-Control-Allow-Credentials: true`
 *   （不能用 `*`，否则带凭据的请求会被浏览器拒绝）
 * - 登录态走 cookie：同主域的子域（blog.example.com → api.example.com）算同站，Lax 即可；
 *   不同站时需要把 cookie 改成 `SameSite=None; Secure`
 */
// 必须使用全局 process：构建时只会内联全局 process.env.*，导入的 process 不会被替换
// eslint-disable-next-line node/prefer-global/process
export const PUBLIC_BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '')

/** 给浏览器侧的后端地址加前缀；未配置时原样返回（走同源代理） */
export function apiUrl(path: string): string {
  return PUBLIC_BACKEND_URL ? `${PUBLIC_BACKEND_URL}${path}` : path
}
