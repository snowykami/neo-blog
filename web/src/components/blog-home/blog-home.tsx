"use client"

import { BlogCardGrid } from "@/components/blog-home/blog-home-card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Clock, } from "lucide-react";
import Sidebar, { SidebarAbout, SidebarHotPosts, SidebarMisskeyIframe, SidebarTags } from "../blog/blog-sidebar-card";
import config from '@/config';
import type { Post } from "@/models/post";
import { listPosts } from "@/api/post";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { OrderBy } from "@/models/common";
import { PaginationController } from "@/components/common/pagination";
import { QueryKey } from "@/constant";
import { useStoredState } from "@/hooks/use-storage-state";
import { parseAsInteger, useQueryState } from "nuqs";

// 定义排序类型
enum SortBy {
  Latest = 'latest',
  Hottest = 'hottest',
}

const DEFAULT_SORTBY: SortBy = SortBy.Latest;

export default function BlogHome() {
  // 从路由查询参数中获取页码和标签们
  const t = useTranslations("BlogHome");
  const [labels, setLabels] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1).withOptions({ history: "replace", clearOnDefault: true }));
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy, isSortByLoaded] = useStoredState<SortBy>(QueryKey.SortBy, DEFAULT_SORTBY);

  useEffect(() => {
    if (!isSortByLoaded) return;
    setLoading(true);
    listPosts(
      {
        page,
        size: config.postsPerPage,
        orderBy: sortBy === SortBy.Latest ? OrderBy.CreatedAt : OrderBy.Heat,
        desc: true,
        keywords: keywords.join(",") || undefined,
        labels: labels.join(",") || undefined,
      }
    ).then(res => {
      setPosts(res.data.posts);
      setTotalPosts(res.data.total);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [keywords, labels, page, sortBy, isSortByLoaded]);

  const handleSortChange = (type: SortBy) => {
    if (sortBy !== type) {
      setSortBy(type);
      setPage(1);
    }
  };

  const handlePageChange = (page: number) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setPage(page);
  }

  return (
    <>
      {/* 主内容区域 */}
      <section className="py-16">
        {/* 容器 - 关键布局 */}
        <div className="">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* 主要内容区域 */}
            <motion.div
              className="lg:col-span-3 self-start"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: config.animationDurationSecond, ease: "easeOut" }}>
              {/* 文章列表标题 */}
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {sortBy === 'latest' ? t("latest_posts") : t("hottest_posts")}
                  {posts.length > 0 && (
                    <span className="text-xl font-normal text-slate-500 ml-2">
                      ({posts.length})
                    </span>
                  )}
                </h2>
                {/* 排序按钮组 */}
                {isSortByLoaded && <div className="flex items-center gap-2">
                  <Button
                    variant={sortBy === SortBy.Latest ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleSortChange(SortBy.Latest)}
                    disabled={loading}
                    className="transition-all duration-200"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    {t("latest")}
                  </Button>
                  <Button
                    variant={sortBy === 'hottest' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleSortChange(SortBy.Hottest)}
                    disabled={loading}
                    className="transition-all duration-200"
                  >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    {t("hottest")}
                  </Button>
                </div>}
              </div>
              {/* 博客卡片网格 */}
              <BlogCardGrid posts={posts} isLoading={loading} showPrivate={true} />
              {/* 分页控制器 */}
              <div className="mt-8">
                {totalPosts > 0 && <PaginationController
                  className="pt-4 flex justify-center"
                  pageSize={config.postsPerPage}
                  initialPage={page}
                  total={totalPosts}
                  onPageChange={handlePageChange}
                />}
              </div>
              {/* 加载状态指示器 */}
              {loading && (
                <div className="text-center py-8">
                  <div className="inline-flex items-center gap-2 text-slate-600">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <span>{t("loading")}</span>
                  </div>
                </div>
              )}
            </motion.div>
            {/* 侧边栏 */}
            <motion.div
              initial={{ x: 80, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              transition={{ duration: config.animationDurationSecond, ease: "easeOut" }}
            >
              <Sidebar
                cards={[
                  <SidebarAbout key="about" config={config} />,
                  posts.length > 0 ? <SidebarHotPosts key="hot" posts={posts} sortType={sortBy} /> : null,
                  <SidebarTags key="tags" labels={[]} />,
                  <SidebarMisskeyIframe key="misskey" />,
                ].filter(Boolean)}
              />
            </motion.div>

          </div>
        </div>
      </section>
    </>
  );
}