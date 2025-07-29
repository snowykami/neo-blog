import type {Post} from "@/models/post";

export function getPostHref(post: Post) {
  return `/p/${post.id}`;
}

// 阅读分钟数
export function calculateReadingTime(content: string): number {
  const words = content.length;
  const readingTime = Math.ceil(words / 270);
  return readingTime;
}