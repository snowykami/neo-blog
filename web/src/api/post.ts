import type { Category } from '@/models/category'
import type { PaginationParams } from '@/models/common'
import type { ContentSaveResult } from '@/models/edit-session'
import type { Post, PostCard, PostStats } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import { OrderBy } from '@/models/common'
import axiosClient from './client'
import { editSessionHeaders } from './edit-session'

/**
 * 后台读取文章（编辑器加载、预览）：含私密文章与草稿（没有草稿时 draftContent 为已发布的正文），仅作者本人与管理员。
 * 前台读取文章走 api/post.server.ts 的 getPostByIdServer，只返回公开文章
 */
export async function getPostForEdit({ id }: { id: string }): Promise<BaseResponse<Post>> {
  const res = await axiosClient.get(`/post/p/${id}/draft`)
  return res.data
}

/**
 * 公开文章的浏览量、点赞数、评论数（不需要登录）：文章页按 ISR 缓存，里面的计数是生成页面时的快照，
 * 浏览器进入文章页后取一次最新值（见 hooks/use-post-stats.ts）
 */
export async function getPostStats(id: number): Promise<BaseResponse<PostStats>> {
  const res = await axiosClient.get(`/post/p/${id}/stats`)
  return res.data
}

export async function getRandomPost(): Promise<BaseResponse<Post>> {
  const res = await axiosClient.get('/post/random')
  return res.data
}

/**
 * 批量读取正文「文章引用」卡片：一次取多篇，避免每张卡片各发一次请求；
 * 当前用户看不到的文章不会返回，由组件显示「内容不可访问」。与后端 service.MaxPostCardIDs 一致，最多 50 个
 */
export async function getPostCards(ids: number[]): Promise<BaseResponse<{ cards: PostCard[] }>> {
  const res = await axiosClient.get('/post/cards', { params: { ids: ids.join(',') } })
  return res.data
}

export async function listPosts({
  page = 1,
  size = 10,
  orderBy = OrderBy.CreatedAt,
  desc = true,
  query = '',
  noContent = false,
  label = '',
  category = '',
  userId = 0,
  withPinned = false,
}: {
  query?: string // 搜索查询，逗号分割
  label?: string // 标签，逗号分割
  category?: string
  userId?: number // 只看某位作者的文章（用户主页）
  noContent?: boolean // 是否不返回内容，用于只需要列表时
  // 首页列表：没有筛选时另外返回置顶文章（pinned），并从 posts 中排除它们，total 不含置顶；有筛选时后端忽略
  withPinned?: boolean
} & PaginationParams): Promise<BaseResponse<{ posts: Post[], total: number, pinned?: Post[] }>> {
  // 前台列表只含公开文章，不论谁在看；后台管理用 listMyPosts / listPostsAdmin
  const res = await axiosClient.get('/post/list', {
    params: {
      page,
      size,
      orderBy,
      desc,
      query,
      label,
      category,
      noContent,
      userId,
      withPinned: withPinned || undefined,
    },
  })
  return res.data
}

// 后台「我的文章」：当前用户自己的全部文章（含私密文章）
export async function listMyPosts({
  page = 1,
  size = 10,
  orderBy = OrderBy.CreatedAt,
  desc = true,
  query = '',
}: { query?: string } & PaginationParams): Promise<BaseResponse<{ posts: Post[], total: number }>> {
  const res = await axiosClient.get('/post/mine', {
    params: { page, size, orderBy, desc, query },
  })
  return res.data
}

export async function createPost({
  post,
}: {
  post: Partial<Omit<Post, 'id' | 'createdAt' | 'updatedAt' | 'user' | 'isLiked' | 'draftContent'>>
}): Promise<BaseResponse<{ id: number }>> {
  const res = await axiosClient.post('/post/p', post)
  return res.data
}

export async function updatePost({
  post,
  editSessionId,
}: {
  post: Partial<Post> & Pick<Post, 'id'> & { baseDraftVersion?: number }
  editSessionId?: string | null // 保存正文时携带，见 api/edit-session.ts
}): Promise<BaseResponse<ContentSaveResult>> {
  const res = await axiosClient.put(`/post/p/${post.id}`, post, { headers: editSessionHeaders(editSessionId) })
  return res.data
}

export async function deletePost({ id }: { id: number }): Promise<null> {
  const res = await axiosClient.delete(`/post/p/${id}`)
  return res.data
}

export async function getCategories(): Promise<BaseResponse<{ categories: Category[] }>> {
  const res = await axiosClient.get('/post/categories')
  return res.data
}

export async function createCategory({
  category,
}: {
  category: Omit<Category, 'id'>
}): Promise<BaseResponse<Category>> {
  const res = await axiosClient.post('/post/c', category)
  return res.data
}

export async function updateCategory({
  category,
}: {
  category: Category
}): Promise<BaseResponse<Category>> {
  const res = await axiosClient.put(`/post/c/${category.id}`, category)
  return res.data
}

export async function deleteCategory({ id }: { id: number }): Promise<null> {
  const res = await axiosClient.delete(`/post/c/${id}`)
  return res.data
}
