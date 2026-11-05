// 存活与就绪检查：只要 Next.js 服务能响应即可，不依赖后端，避免后端异常时前端实例也被反复重启。
// 退出时 Next.js 收到 SIGTERM 会先停止接收新连接、处理完进行中的请求；部署时配合 preStop 等待几秒，留给负载均衡摘掉本实例
export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response('OK', { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
