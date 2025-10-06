"use client"

import { getRandomPost } from "@/api/post"
import { useSiteInfo } from "@/contexts/site-info-context"
import { Post } from "@/models/post"
import { getPostUrl } from "@/utils/common/route"
import { useTranslations } from "next-intl"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function RandomPostPage() {

  const t = useTranslations('Random')
  const router = useRouter()
  const [post, setPost] = useState<Post | null>(null)
  useEffect(() => {
    getRandomPost().then(res => {
      setPost(res.data)
      // 等待 300 ms 再跳转，避免闪烁
      setTimeout(() => {
        router.push(getPostUrl(res.data))
      }, 300)
    }).catch(err => {
      toast.error(err.message || 'Failed to get random post')
    })
  }, [])


  return (
    <div
      className="w-full flex justify-center items-center min-h-[60vh]"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="w-full max-w-3xl px-4 md:px-0">
        <div className="flex flex-col items-center space-y-6">
          {/* Spinner */}
          <svg
            className="w-12 h-12 text-gray-700 dark:text-gray-200 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>

          {/* Text */}
          {!post && <div className="text-center">
            <p className="text-lg font-medium text-gray-900 dark:text-white">
              {t("jumping_to_post")}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t("selecting_post")}
            </p>
          </div>}

          {post && <div className="text-center">
            <p className="text-lg font-medium text-gray-900 dark:text-white">
              {t("coming_soon")}
            </p>
          </div>}

          {/* Skeleton preview */}
          {!post && <RandomPostPreviewSkeleton />}
          {post && <RandomPostPreview post={post} />}
        </div>
      </div>
    </div>
  )
}


function RandomPostPreview({ post }: { post: Post }) {
  const { siteInfo } = useSiteInfo()
  return (
    <div className="w-full max-w-3xl px-4 md:px-0">
      <div className="space-y-4">
        <div className="w-full aspect-[16/8] rounded-lg overflow-hidden">
          <Image
            src={post.cover || siteInfo.defaultCover}
            alt={post.title}
            width={800}
            height={600}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{post.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(post.createdAt).toLocaleDateString()}
          </p>
          {post.description && (
            <p className="text-gray-700 dark:text-gray-300">
              {post.description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function RandomPostPreviewSkeleton() {
  return (
    <div className="w-full max-w-3xl px-4 md:px-0">
      <div className="space-y-4 animate-pulse">
        <div className="w-full h-48 bg-gray-300 dark:bg-gray-700 rounded-lg" />
        <div className="space-y-2">
          <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-3/4" />
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/4" />
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-full" />
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-full" />
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-5/6" />
        </div>
      </div>
    </div>
  )
}