import { connection } from 'next/server'

// 当前运行的前端版本（构建时注入的 commit），已打开的页面据此判断是否部署了新版本；按请求处理（connection()），不预渲染
export async function GET() {
  await connection()
  return Response.json(
    // 必须使用全局 process：构建时只会内联全局 process.env.NEXT_PUBLIC_*，导入的 process 不会被替换。
    // builtAt：构建时间（毫秒），浏览器据此只把「更新的」版本当作升级（见 utils/client/chunk-error.ts）
    // eslint-disable-next-line node/prefer-global/process
    { version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() ?? '', builtAt: Number(process.env.NEXT_PUBLIC_BUILD_TIME) || 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
