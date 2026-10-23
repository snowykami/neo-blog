// 当前运行的前端版本（构建时注入的 commit），已打开的页面据此判断是否部署了新版本
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    // 必须使用全局 process：构建时只会内联全局 process.env.NEXT_PUBLIC_*，导入的 process 不会被替换
    // eslint-disable-next-line node/prefer-global/process
    { version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() ?? '' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
