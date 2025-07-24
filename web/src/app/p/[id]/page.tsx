import { getPostById } from "@/api/post";
import { notFound } from "next/navigation";

interface Props {
  params: Promise<{
    id: string;
  }>
}

export default async function PostPage({ params }: Props) {
    const { id } = await params;
    
    try {
        const post = await getPostById(id);
        
        if (!post) {
            notFound();
        }
        
        return (
            <article className="max-w-4xl mx-auto px-4 py-8">
                <header className="mb-8">
                    <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
                    <div className="text-gray-600 mb-4">
                        <time>{new Date(post.createdAt).toLocaleDateString()}</time>
                        <span className="mx-2">·</span>
                        <span>阅读量: {post.viewCount || 0}</span>
                    </div>
                </header>
                
                <div className="prose max-w-none">
                    <div dangerouslySetInnerHTML={{ __html: post.content }} />
                </div>

                {post.labels && post.labels.length > 0 && (
                    <footer className="mt-8 pt-8 border-t">
                        <div className="flex flex-wrap gap-2">
                            {post.labels.map((label) => (
                                <span key={label.id} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                                    #{label.key}
                                </span>
                            ))}
                        </div>
                    </footer>
                )}
            </article>
        );
    } catch (error) {
        console.error("Failed to fetch post:", error);
        notFound();
    }
}

// 生成元数据
export async function generateMetadata({ params }: Props) {
    const { id } = await params;
    
    try {
        const post = await getPostById(id);
        
        if (!post) {
            return {
                title: '文章未找到',
            };
        }
        
        return {
            title: post.title,
            description: post.content?.substring(0, 160),
            openGraph: {
                title: post.title,
                description: post.content?.substring(0, 160),
                type: 'article',
                publishedTime: post.createdAt,
            },
        };
    } catch (error) {
        return {
            title: '文章未找到',
        };
    }
}