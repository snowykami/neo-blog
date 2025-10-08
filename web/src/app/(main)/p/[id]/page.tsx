import { redirect } from 'next/navigation'
import { BlogPost } from '@/components/blog-post/blog-post'
import { Metadata } from 'next'
import { getPostByIdServer } from '@/api/post.server'
import { getPostUrl } from '@/utils/common/route'
import { notFound } from "next/navigation";

// 这个是approuter固定的传入格式，无法更改
interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type: 'draft' | undefined }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = await getPostByIdServer({ id }).then(res => res.data).catch(() => null);
  return {
    title: post?.title || 'Post',
    description: post?.content.slice(0, 160) || undefined,
  };
}

export default async function PostPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { type } = await searchParams;
  const post = await getPostByIdServer({ id, type }).then(res => res.data).catch(() => null);
  console.log(post)
  if (!post) return notFound();
  // 如果当前访问的 id 不是 post 的 slug，则重定向到正确的 URL
  if (post.slug && post.slug !== id) {
    redirect(getPostUrl({post, type}));
  }
  return (
    <div className="flex flex-col h-100vh">
      <BlogPost post={post} isDraft={type === 'draft'} />
    </div>
  )
}
