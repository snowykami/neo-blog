import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'
import { OrderBy, PaginationParams } from '@/models/common'
import { Category } from '@/models/category';


export async function getPostById(
  { id, type = 'normal' }: { id: string; type?: 'draft' | 'normal' }
): Promise<BaseResponse<Post | null>> {
  const res = await axiosClient.get<BaseResponse<Post | null>>(`/post/p/${id}`, {
    params: { type },
  })
  return res.data
}

export async function listPosts({
  page = 1,
  size = 10,
  orderBy = OrderBy.CreatedAt,
  desc = false,
  keywords = '',
  label = '',
}: {
  keywords?: string, // 关键词，逗号分割
  label?: string, // 标签，逗号分割
} & PaginationParams): Promise<BaseResponse<{ "posts": Post[], "total": number }>> {
  const res = await axiosClient.get<BaseResponse<{ "posts": Post[], "total": number }>>('/post/list', {
    params: {
      page,
      size,
      orderBy,
      desc,
      keywords,
      label,
    },
  })
  return res.data
}

export async function updatePost({ post }: { post: Partial<Post> & Pick<Post, 'id'> }): Promise<BaseResponse<Post>> {
  const res = await axiosClient.put<BaseResponse<Post>>(`/post/p/${post.id}`, post)
  return res.data
}

export async function deletePost({ id }: { id: number }): Promise<null> {
  const res = await axiosClient.delete(`/post/p/${id}`)
  return res.data
}

export async function getCategories(): Promise<BaseResponse<{ categories: Category[] }>> {
  const res = await axiosClient.get<BaseResponse<{ categories: Category[] }>>('/post/categories')
  return res.data
}

export async function createCategory({category}:{category: Omit<Category, 'id'>}): Promise<BaseResponse<Category>> {
  const res = await axiosClient.post<BaseResponse<Category>>('/post/c', category)
  return res.data
}

export async function updateCategory({ category }: { category: Category }): Promise<BaseResponse<Category>> {
  const res = await axiosClient.put<BaseResponse<Category>>(`/post/c/${category.id}`, category)
  return res.data
}

export async function deleteCategory({ id }: { id: number }): Promise<null> {
  const res = await axiosClient.delete(`/post/c/${id}`)
  return res.data
}
