import { getPostById } from "@/api/post";
import BlogPost from "@/components/blog-post";

interface Props {
  params: Promise<{ id: string }>
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  const post = await getPostById(id);
  if (!post) return <div>文章不存在</div>;
  return <BlogPost post={post} />;
}