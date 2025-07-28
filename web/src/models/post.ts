import type { Label } from "@/models/label";
import type { User } from "./user";

export interface Post {
    description: string;
    id: number;
    title: string;
    content: string;
    cover: string | null; // 封面可以为空
    type: "markdown" | "html" | "text";
    labels: Label[] | null; // 标签可以为空
    user: User
    isPrivate: boolean;
    isOriginal: boolean;
    likeCount: number;
    commentCount: number;
    viewCount: number;
    heat: number;
    createdAt: string;
    updatedAt: string;
}