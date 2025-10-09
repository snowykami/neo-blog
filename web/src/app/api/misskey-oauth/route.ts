import { getSiteInfo } from "@/api/misc";
import { fallbackSiteInfo } from "@/utils/common/siteinfo";

export async function GET() {
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  return new Response(`<link rel='redirect_uri' href='${siteInfo.baseUrl}/api/v1/user/oidc/login/liteyuki-lab'>
<!-- ユーザーに見せるアプリの名前になります。なかったらこのページのアドレスが名前になります。 -->
<div class='h-app'>
    <a href="/" class="u-url p-name">My Misskey App</a>
</div>`, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}