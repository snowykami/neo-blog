import { isSelfProxyPath, serveFixedPublicImage } from '@/app/api/site-icon/public-image-proxy'

/**
 * 站长头像固定外链反代（供友链交换等外部固定引用，不裁圆角、保留原比例并做轻量小图缓存）
 */
export async function GET() {
  return serveFixedPublicImage('avatar', (siteInfo) => {
    const ownerAvatar = siteInfo.owner?.avatar?.trim() ?? ''
    if (ownerAvatar && !isSelfProxyPath(ownerAvatar))
      return ownerAvatar
    return siteInfo.metadata?.icon?.trim() ?? ''
  })
}
