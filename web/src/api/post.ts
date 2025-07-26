import type { BaseResponse } from "@/models/resp";
import type { Post } from "@/models/post";
import axiosClient from "./client";

interface ListPostsParams {
    page?: number;
    size?: number;
    orderBy?: string;
    desc?: boolean;
    keywords?: string;
}

export async function getPostById(id: string): Promise<Post | null> {
    console.log("Fetching post by ID:", id);
    try {
        const res = await axiosClient.get<BaseResponse<Post>>(`/post/p/19`);
        return res.data.data;
    } catch (error) {
        console.error("Error fetching post by ID:", error);
        return null;
    }
}

export async function listPosts({
    page = 1,
    size = 10,
    orderBy = 'updated_at',
    desc = false,
    keywords = ''
}: ListPostsParams = {}): Promise<BaseResponse<Post[]>> {
    const res = await axiosClient.get<BaseResponse<Post[]>>("/post/list", {
        params: {
            page,
            size,
            orderBy,
            desc,
            keywords
        }
    });
    return res.data;
}