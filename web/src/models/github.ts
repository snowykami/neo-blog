// GitHub 仓库公开信息（文章内的仓库卡）
export interface GithubRepo {
  fullName: string
  owner: string
  name: string
  description: string
  htmlUrl: string
  ownerAvatar: string
  language: string
  license: string
  topics: string[]
  stars: number
  forks: number
  archived: boolean
}
