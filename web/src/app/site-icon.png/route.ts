import { serveFixedPublicImage } from '@/app/api/site-icon/public-image-proxy'

/**
 * 站点图标固定外链反代（供友链交换等外部固定引用，不裁圆角、保留原比例并做轻量小图缓存）
 */
export async function GET() {
  return serveFixedPublicImage('site-icon', siteInfo => siteInfo.metadata?.icon?.trim() ?? '')
}
