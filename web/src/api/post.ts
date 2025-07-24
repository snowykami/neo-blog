import type { BaseResponse } from "@/models/resp";
import type { Post } from "@/models/post";
import axiosClient from "./client";

interface ListPostsParams {
    page?: number;
    size?: number;
    orderedBy?: string;
    reverse?: boolean;
    keywords?: string;
}

export async function getPostById(id: string): Promise<Post | null> {
    try {
        const res = await axiosClient.get<BaseResponse<Post>>(`/post/p/${id}`);
        return res.data.data;
    } catch (error) {
        console.error("Error fetching post by ID:", error);
        return null;
    }
}

export async function listPosts({
    page = 1,
    size = 10,
    orderedBy = 'updated_at',
    reverse = false,
    keywords = ''
}: ListPostsParams = {}): Promise<BaseResponse<Post[]>> {
    const res = await axiosClient.get<BaseResponse<Post[]>>("/post/list", {
        params: {
            page,
            size,
            orderedBy,
            reverse,
            keywords
        }
    });
    return res.data;
}