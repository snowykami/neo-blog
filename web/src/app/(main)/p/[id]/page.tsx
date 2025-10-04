import { getPostById } from '@/api/post'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import BlogPost from '@/components/blog-post/blog-post'
import { Metadata } from 'next'

// 这个是approuter固定的传入格式，无法更改
interface Props {
  params: Promise<{ id: string }>
}


export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const cookieStore = await cookies();
  const { id } = await params;
  const post = await getPostById({ id, token: cookieStore.get('token')?.value || '' }).then(res => res.data).catch(() => null);
  return {
    title: post?.title || 'Post',
    description: post?.description || undefined,
  };
}

export default async function PostPage({ params }: Props) {
  const cookieStore = await cookies();
  const { id } = await params;
  const post = await getPostById({ id, token: cookieStore.get('token')?.value || '' }).then(res => res.data).catch(() => null);
  if (!post) return <div>Not Found</div>
  if (post.slug && post.slug !== id) {
    redirect(`/p/${post.slug}`)
  }
  return (
    <div className="flex flex-col h-100vh">
      <BlogPost post={post} />
    </div>
  )
}
