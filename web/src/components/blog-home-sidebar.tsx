import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart, TrendingUp, Eye } from "lucide-react";
import GravatarAvatar from "./gravatar";
import { Badge } from "@/components/ui/badge";
import type { Label } from "@/models/label";
import type { Post } from "@/models/post";
import type configType from '@/config';
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// 侧边栏父组件，接收卡片组件列表
export default function Sidebar({ cards }: { cards: React.ReactNode[] }) {
  return (
    <div className="lg:col-span-1 space-y-6 self-start">
      {cards.map((card, idx) => (
        <div key={idx}>{card}</div>
      ))}
    </div>
  );
}

// 关于我卡片
export function SidebarAbout({ config }: { config: typeof configType }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-red-500" />
          关于我
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center mb-4">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
            <GravatarAvatar email={config.owner.gravatarEmail} className="w-full h-full object-cover" />
          </div>
          <h3 className="font-semibold text-lg">{config.owner.name}</h3>
          <p className="text-sm text-slate-600">{config.owner.motto}</p>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          {config.owner.description}
        </p>
      </CardContent>
    </Card>
  );
}

// 热门文章卡片
export function SidebarHotPosts({ posts, sortType }: { posts: Post[], sortType: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-orange-500" />
          {sortType === 'latest' ? '热门文章' : '最新文章'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {posts.slice(0, 3).map((post, index) => (
          <div key={post.id} className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
              {index + 1}
            </span>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm line-clamp-2 mb-1">
                {post.title}
              </h4>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {post.viewCount}
                </span>
                <span className="flex items-center gap-1">
                  <Heart className="w-3 h-3" />
                  {post.likeCount}
                </span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// 标签云卡片
export function SidebarTags({ labels }: { labels: Label[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>标签云</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {labels.map((label) => (
            <Badge
              key={label.id}
              variant="outline"
              className="text-xs hover:bg-blue-50 cursor-pointer"
            >
              {label.key}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}


export function SidebarIframe(props?: { src?: string; scriptSrc?: string; title?: string; height?: string }) {
  const {
    src = "",
    scriptSrc = "",
    title = "External Content",
    height = "400px",
  } = props || {};
  const t = useTranslations('HomePage');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <iframe
          src={src}
          className="w-full border-none"
          style={{ height }}
          height={height}
          title={title}
        />
        {scriptSrc && (
          <script
            src={scriptSrc}
            async
            defer
            className="w-full"
          ></script>
        )}
      </CardContent>
    </Card>
  );
}

// 只在客户端渲染 iframe，避免 hydration 报错
export function SidebarMisskeyIframe() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(true);
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Misskey</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {show && (
          <>
            <iframe
              src="https://lab.liteyuki.org/embed/user-timeline/a2utaz241qx60001?maxHeight=700&border=false"
              data-misskey-embed-id="v1_aali1lvxt0"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              style={{
                border: "none",
                width: "100%",
                maxWidth: "500px",
                height: "300px",
                colorScheme: "light dark"
              }}
            ></iframe>
            <script defer src="https://lab.liteyuki.org/embed.js"></script>
          </>
        )}
      </CardContent>
    </Card>
  );
}