import type { Label } from "@/models/label";

export interface Post {
    id: number;
    title: string;
    content: string;
    cover: string | null; // 封面可以为空
    type: "markdown" | "html" | "text";
    labels: Label[] | null; // 标签可以为空
    isPrivate: boolean;
    likeCount: number;
    commentCount: number;
    viewCount: number;
    heat: number;
    createdAt: string;
    updatedAt: string;
}