import { getPostById } from '@/api/post'
import { cookies } from 'next/headers'
import BlogPost from '@/components/blog-post/blog-post'

// 这个是approuter固定的传入格式，无法更改
export default async function PostPage({ params }: { params: { id: string } }) {
  const cookieStore = await cookies();
  const { id } = params;
  const post = await getPostById({id, token: cookieStore.get('token')?.value || ''});
  if (!post)
    return <div>文章不存在</div>
  return (
    <div className="flex flex-col h-100vh">
      <BlogPost  post={post} />
    </div>
  )
}
