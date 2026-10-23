import type { GithubRepo } from '@/models/github'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

// 仓库公开信息由后端代为请求并缓存
export async function getGithubRepo(owner: string, repo: string): Promise<GithubRepo> {
  const res = await axiosClient.get<BaseResponse<GithubRepo>>(`/misc/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
  return res.data.data
}
