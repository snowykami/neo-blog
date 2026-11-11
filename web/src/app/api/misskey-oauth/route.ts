import { connection } from 'next/server'
import { getSiteInfo } from '@/api/misc'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

export async function GET() {
  // 按请求生成：构建期连不上后端，预渲染会把兜底的站点地址固化进去
  await connection()
  const siteInfo = await getSiteInfo()
    .then(res => res.data)
    .catch(() => fallbackSiteInfo)
  return new Response(
    `<link rel='redirect_uri' href='${siteInfo.baseUrl}/api/v1/user/oidc/login/liteyuki-lab'>
<!-- ユーザーに見せるアプリの名前になります。なかったらこのページのアドレスが名前になります。 -->
<div class='h-app'>
    <a href="/" class="u-url p-name">My Misskey App</a>
</div>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  )
}
