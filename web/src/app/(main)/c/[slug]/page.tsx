import { listPosts } from '@/api/post'
import { BlogCardGrid } from '@/components/blog-home/blog-home-card'
import { OrderBy } from '@/models/common'

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const posts = await listPosts({
    page: 1,
    size: 50,
    category: slug,
    orderBy: OrderBy.CreatedAt,
    desc: true,
  }).then(res => res.data.posts).catch(() => [])

  return (
    <div className="py-10">
      <h1 className="text-3xl font-bold mb-6">
        分类：
        {slug}
      </h1>
      <BlogCardGrid posts={posts} />
    </div>
  )
}
