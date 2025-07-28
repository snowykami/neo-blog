import { getPostById } from '@/api/post'
import { cookies } from 'next/headers'
import BlogPost from '@/components/blog-post'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PostPage({ params }: Props) {
  const cookieStore = await cookies();
  const { id } = await params
  const post = await getPostById(id, cookieStore.get('token')?.value || '');
  if (!post)
    return <div>文章不存在</div>
  return <BlogPost post={post} />
}
