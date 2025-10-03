import type { Label } from "@/models/label";
import type { User } from "./user";
import type { Category } from "./category";

export interface Post {
    description: string;
    id: number;
    title: string;
    slug: string | null;
    content: string;
    cover: string | null; // 封面可以为空
    category: Category | null; // 分类可以为空
    labels: Label[] | null; // 标签可以为空
    user: User
    isPrivate: boolean;
    likeCount: number;
    commentCount: number;
    viewCount: number;
    heat: number;
    createdAt: string;
    updatedAt: string;
}

export interface ListPostsParams {
  page?: number
  size?: number
  orderBy?: string
  desc?: boolean
  keywords?: string
}