"use client";

import { BlogCardGrid } from "@/components/blog-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, Clock, Heart, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import config from '@/config';
import type { Label } from "@/models/label";
import type { Post } from "@/models/post";
import { listPosts } from "@/api/post";

import { useEffect, useState } from "react";
import { useStoredState } from '@/hooks/use-storage-state';
import { listLabels } from "@/api/label";
import GravatarAvatar from "./gravatar";
import { POST_SORT_TYPE } from "@/localstore";

// 定义排序类型
type SortType = 'latest' | 'popular';

export default function BlogHome() {
    const [labels, setLabels] = useState<Label[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(false);
    const [sortType, setSortType, sortTypeLoaded] = useStoredState<SortType>(POST_SORT_TYPE, 'latest');

    // 根据排序类型获取文章
    useEffect(() => {
        if (!sortTypeLoaded) return; // 等待从 localStorage 加载完成

        const fetchPosts = async () => {
            try {
                setLoading(true);
                let orderedBy: string;
                let reverse: boolean;
                switch (sortType) {
                    case 'latest':
                        orderedBy = 'updated_at';
                        reverse = false;
                        break;
                    case 'popular':
                        orderedBy = 'heat';
                        reverse = false;
                        break;
                    default:
                        orderedBy = 'updated_at';
                        reverse = false;
                }
                const data = await listPosts({
                    page: 1,
                    size: 10,
                    orderedBy,
                    reverse
                });
                setPosts(data.data);
                console.log(`${sortType} posts:`, data.data);
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
            setLabels(data.data);
            console.log("Labels:", data.data);
        }).catch(error => {
            console.error("Failed to fetch labels:", error);
        });
    }, []);

    // 

    // 处理排序切换
    const handleSortChange = (type: SortType) => {
        if (sortType !== type) {
            setSortType(type);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:bg-gradient-to-br dark:from-slate-900 dark:via-blue-900 dark:to-indigo-900">
            {/* Hero Section */}
            <section className="relative py-10 lg:py-16 overflow-hidden">
                {/* 背景装饰 */}
                <div className="absolute inset-0 bg-grid-white/[0.02] bg-grid-16 pointer-events-none" />

                {/* 容器 - 关键布局 */}
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
                    <div className="text-center max-w-4xl mx-auto">
                        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 bg-clip-text text-transparent dark:from-slate-100 dark:via-blue-100 dark:to-slate-100">
                            {config.metadata.name}
                        </h1>
                        <p className="text-xl md:text-2xl text-slate-600 mb-8 max-w-2xl mx-auto leading-relaxed">
                            {config.metadata.description}
                        </p>

                        {/* 搜索框 */}
                        <div className="relative max-w-md mx-auto mb-0">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                            <Input
                                placeholder="搜索文章..."
                                className="pl-10 pr-4 py-0 text-lg border-slate-200 focus:border-blue-500 rounded-full"
                            />
                        </div>

                        {/* 热门标签 */}
                        {/* <div className="flex flex-wrap justify-center gap-2 mb-8">
                            {labels.map(label => (
                                <Badge
                                    key={label.id}
                                    variant="outline"
                                    className="text-xs hover:bg-blue-50 cursor-pointer"
                                >
                                    {label.key}
                                </Badge>
                            ))}
                        </div> */}
                    </div>
                </div>
            </section>

            {/* 主内容区域 */}
            <section className="py-16">
                {/* 容器 - 关键布局 */}
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* 主要内容区域 */}
                        <div className="lg:col-span-3">
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
                        </div>

                        {/* 侧边栏 */}
                        <div className="lg:col-span-1 space-y-6">
                            {/* 关于我 */}
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

                            {/* 热门文章 */}
                            {posts.length > 0 && (
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
                            )}

                            {/* 标签云 */}
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
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}