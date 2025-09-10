"use client";

import { BlogCardGrid } from "@/components/blog-home/blog-home-card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Clock, } from "lucide-react";
import Sidebar, { SidebarAbout, SidebarHotPosts, SidebarMisskeyIframe, SidebarTags } from "../blog/blog-sidebar-card";
import config from '@/config';
import type { Label } from "@/models/label";
import type { Post } from "@/models/post";
import { listPosts } from "@/api/post";

import { useEffect, useState } from "react";
import { useStoredState } from '@/hooks/use-storage-state';
import { listLabels } from "@/api/label";
import { POST_SORT_TYPE } from "@/localstore";
import { motion } from "framer-motion";
import { useDevice } from "@/hooks/use-device";

// 定义排序类型
type SortType = 'latest' | 'popular';

export default function BlogHome() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const { isMobile } = useDevice();
  const [sortType, setSortType, sortTypeLoaded] = useStoredState<SortType>(POST_SORT_TYPE, 'latest');
  useEffect(() => {
    if (!sortTypeLoaded) return;
    const fetchPosts = async () => {
      try {
        setLoading(true);
        let orderBy: string;
        let desc: boolean;
        switch (sortType) {
          case 'latest':
            orderBy = 'updated_at';
            desc = true;
            break;
          case 'popular':
            orderBy = 'heat';
            desc = true;
            break;
          default:
            orderBy = 'updated_at';
            desc = true;
        }
        // 处理关键词，空格分割转逗号
        const keywords = ""?.trim() ? ""?.trim().split(/\s+/).join(",") : undefined;
        const data = await listPosts({
          page: 1,
          size: 10,
          orderBy: orderBy,
          desc: desc,
          keywords
        });
        setPosts(data.data);
      } catch (error) {
        console.error("Failed to fetch posts:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [sortType, sortTypeLoaded]);

  // 获取标签
  useEffect(() => {
    listLabels().then(data => {
      setLabels(data.data || []);
    }).catch(error => {
      console.error("Failed to fetch labels:", error);
    });
  }, []);

  // 处理排序切换
  const handleSortChange = (type: SortType) => {
    if (sortType !== type) {
      setSortType(type);
    }
  };

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
              initial={{ y: isMobile ? 30 : 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: config.animationDurationSecond, ease: "easeOut" }}>
              {/* 文章列表标题 */}
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {sortType === 'latest' ? '最新文章' : '热门文章'}
                  {posts.length > 0 && (
                    <span className="text-sm font-normal text-slate-500 ml-2">
                      ({posts.length} 篇)
                    </span>
                  )}
                </h2>

                {/* 排序按钮组 */}
                <div className="flex items-center gap-2">
                  <Button
                    variant={sortType === 'latest' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleSortChange('latest')}
                    disabled={loading}
                    className="transition-all duration-200"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    最新
                  </Button>
                  <Button
                    variant={sortType === 'popular' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleSortChange('popular')}
                    disabled={loading}
                    className="transition-all duration-200"
                  >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    热门
                  </Button>
                </div>
              </div>

              {/* 博客卡片网格 */}
              <BlogCardGrid posts={posts} isLoading={loading} showPrivate={true} />

              {/* 加载更多按钮 */}
              {!loading && posts.length > 0 && (
                <div className="text-center mt-12">
                  <Button size="lg" className="px-8">
                    加载更多文章
                  </Button>
                </div>
              )}

              {/* 加载状态指示器 */}
              {loading && (
                <div className="text-center py-8">
                  <div className="inline-flex items-center gap-2 text-slate-600">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    正在加载{sortType === 'latest' ? '最新' : '热门'}文章...
                  </div>
                </div>
              )}
            </motion.div>


            {/* 侧边栏 */}
            <motion.div
              initial={isMobile ? { y: 30, opacity: 0 } : { x: 80, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              transition={{ duration: config.animationDurationSecond , ease: "easeOut" }}
            >
              <Sidebar
                cards={[
                  <SidebarAbout key="about" config={config} />,
                  posts.length > 0 ? <SidebarHotPosts key="hot" posts={posts} sortType={sortType} /> : null,
                  <SidebarTags key="tags" labels={labels} />,
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