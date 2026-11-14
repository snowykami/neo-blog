import nodeProcess from 'node:process'
import { IMAGE_OPTIMIZE_HOSTS, parseImageOptimizeHosts } from './image'

/**
 * 服务端运行时读取图片优化域名白名单：
 * 优先读取启动环境变量 IMAGE_OPTIMIZE_HOSTS（其次 NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS），
 * 仅在环境变量均未设置时回退到构建期内联的 IMAGE_OPTIMIZE_HOSTS
 */
export function getServerImageOptimizeHosts(): string[] {
  const runtimeRaw = nodeProcess.env.IMAGE_OPTIMIZE_HOSTS ?? nodeProcess.env.NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS
  if (runtimeRaw !== undefined)
    return parseImageOptimizeHosts(runtimeRaw)
  return [...IMAGE_OPTIMIZE_HOSTS]
}
