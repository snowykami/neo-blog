"use client"

import type { Post } from '@/models/post'
import { Calendar, Eye, Heart, Lock, MessageCircle } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { motion } from 'motion/react'
import { deceleration } from '@/motion/curve'
import { Skeleton } from '@/components/ui/skeleton'
import { useSiteInfo } from '@/contexts/site-info-context'
import { getPostUrl } from '@/utils/common/route'


export function BlogCard({ post, className }: {
  post: Post
  className?: string
}) {
  const {siteInfo} = useSiteInfo();
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }
  return (
    <Card className={cn(
      'group overflow-hidden hover:shadow-xl h-full flex flex-col cursor-pointer pt-0 pb-4',
      className,
    )}
    >
      {/* 封面图片区域 */}
      <div
        className="relative aspect-[16/9] overflow-hidden"
      >
        {/* 自定义封面图片 */}
        <motion.div
          initial={{ scale: 1.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            duration: siteInfo.animationDurationSecond,
            ease: deceleration,
          }}
          className="absolute inset-0 w-full h-full"
        >
            <Image
              src={post.cover || siteInfo.defaultCover || "https://cdn.liteyuki.org/blog/background.png"}
              alt={post.title}
              fill
              className="object-cover w-full h-full group-hover:scale-105 !duration-300 !transition-transform"
              sizes="(max-width: 768px) 100vw, 33vw"
              priority={false}
            />
        </motion.div>


        {/* 覆盖层 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* 私有文章标识 */}
        {post.isPrivate && (
          <Badge
            variant="destructive"
            className="absolute top-2 left-2 bg-blue-300/90 text-white hover:bg-blue-400 text-xs"
          >
            <Lock className="w-3 h-3 mr-1" />
            私有
          </Badge>
        )}

        {/* 统计信息 */}
        <div className="absolute bottom-2 left-2">
          <Badge className="bg-gradient-to-r from-blue-200 to-purple-300 text-white border-0 dark:bg-gradient-to-r dark:from-blue-700 dark:to-purple-700">
            {/* 统计信息 */}
            <div className="grid grid-cols-1 gap-4 text-muted-foreground">
              <div className="flex items-center gap-3 text-xs">
                {/* 点赞数 */}
                <div className="flex items-center gap-1 ">
                  <Heart className="w-3 h-3" />
                  <span>{post.likeCount}</span>
                </div>
                {/* 评论数 */}
                <div className="flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" />
                  <span>{post.commentCount}</span>
                </div>
                {/* 阅读量 */}
                <div className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  <span>{post.viewCount}</span>
                </div>
              </div>
            </div>
          </Badge>
        </div>

        {/* 热度指示器 */}
        {post.heat > 50 && (
          <div className="absolute bottom-2 right-2">
            <Badge className="bg-gradient-to-r from-orange-500 to-red-500 text-white border-0 text-xs">
              🔥
              {' '}
              {post.heat}
            </Badge>
          </div>
        )}
      </div>

      {/* Card Header - 标题区域 */}
      <CardHeader className="">
        <CardTitle className="line-clamp-2 group-hover:text-primary transition-colors text-lg leading-tight">
          {post.title}
        </CardTitle>

      </CardHeader>

      {/* Card Content - 主要内容 */}
      <CardContent className="flex-1">
        <CardDescription className="line-clamp-3 leading-relaxed">
          {post.content.replace(/[#*`]/g, '').substring(0, 150)}
          {post.content.length > 150 ? '...' : ''}
        </CardDescription>
      </CardContent>

      {/* Card Footer - 日期和操作区域 */}
      <CardFooter className="pb-0 border-t border-border/50 flex items-center justify-between">
        {/* 左侧：最新日期 */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <time dateTime={post.updatedAt !== post.createdAt ? post.updatedAt : post.createdAt}>
            {formatDate(post.updatedAt !== post.createdAt ? post.updatedAt : post.createdAt)}
          </time>
        </div>
      </CardFooter>

    </Card>
  )
}

// 骨架屏加载组件 - 使用 shadcn Card 结构
export function BlogCardSkeleton() {
  return (
    <Card className="group overflow-hidden hover:shadow-xl transition-all duration-300 h-full flex flex-col cursor-default pt-0 pb-4">
      {/* 封面骨架 */}
      <div className="relative aspect-[16/9] overflow-hidden">
        <Skeleton className="absolute inset-0" />

        {/* 覆盖层（模拟暗色遮罩） */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

        {/* 私有标识骨架 */}
        <div className="absolute top-2 left-2">
          <Skeleton className="h-6 w-14 rounded-md" />
        </div>

        {/* 统计信息骨架 */}
        <div className="absolute bottom-2 left-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-6 rounded" />
            <Skeleton className="h-3 w-6 rounded" />
            <Skeleton className="h-3 w-6 rounded" />
          </div>
        </div>

        {/* 热度骨架 */}
        <div className="absolute bottom-2 right-2">
          <Skeleton className="h-6 w-12 rounded-md" />
        </div>
      </div>

      {/* 标题骨架 */}
      <CardHeader className="pb-3">
        <CardTitle>
          <Skeleton className="h-5 w-3/4 rounded" />
        </CardTitle>
      </CardHeader>

      {/* 内容骨架 */}
      <CardContent className="flex-1">
        <CardDescription>
          <div className="space-y-2">
            <Skeleton className="h-4 rounded" />
            <Skeleton className="h-4 w-5/6 rounded" />
            <Skeleton className="h-4 w-2/3 rounded" />
          </div>
        </CardDescription>
      </CardContent>

      {/* 底部骨架 */}
      <CardFooter className="pb-0 border-t border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24 rounded" />
        </div>
        <Skeleton className="h-4 w-20 rounded" />
      </CardFooter>
    </Card>
  )
}

// 网格布局的博客卡片列表
export function BlogCardGrid({
  posts,
  isLoading,
  showPrivate = false,
}: {
  posts: Post[]
  isLoading?: boolean
  showPrivate?: boolean
}) {
  const {siteInfo} = useSiteInfo();
  const filteredPosts = showPrivate ? posts : posts.filter(post => !post.isPrivate)

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: siteInfo.postsPerPage || 9 }).map((_, index) => (
          <BlogCardSkeleton key={index} />
        ))}
      </div>
    )
  }

  if (filteredPosts.length === 0) {
    return (
      <Card className="p-12 text-center">
        <CardContent>
          <p className="text-muted-foreground text-lg">暂无文章</p>
          <p className="text-sm text-muted-foreground mt-2">
            {showPrivate ? '没有找到任何文章' : '没有找到公开的文章'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filteredPosts.map(post => (
        <Link key={post.id} href={getPostUrl(post)} className="block h-full">
          <BlogCard post={post} />
        </Link>
      ))}
    </div>
  )
}
