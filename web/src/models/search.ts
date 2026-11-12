import type { UserBrief } from '@/models/user'

export interface SearchPostHit {
  id: number
  title: string
  slug: string | null
  cover: string
  snippet: string
  categoryName?: string
  labels?: string[]
  authorNickname?: string
  createdAt: string
  highlightTerms?: string[]
}

export interface SearchPageHit {
  id: number
  title: string
  slug: string
  kind: 'content' | 'link' | 'html' | string
  linkUrl?: string
  snippet: string
  highlightTerms?: string[]
}

export interface SearchCommentHit {
  id: number
  content: string
  user?: UserBrief
  targetType: 'post' | 'page' | string
  targetId: number
  targetTitle: string
  targetSlug?: string | null
  createdAt: string
  highlightTerms?: string[]
}

export interface SearchUserHit extends UserBrief {
  highlightTerms?: string[]
}

export interface GlobalSearchResult {
  engine: 'meilisearch' | 'database'
  posts: SearchPostHit[]
  pages: SearchPageHit[]
  comments: SearchCommentHit[]
  users: SearchUserHit[]
}

export interface TestMeilisearchParams {
  url?: string
  apiKey?: string
  indexPrefix?: string
}

export interface TestMeilisearchResult {
  version: string
  location: string
  databaseSize: number
}

export interface ReindexSearchResult {
  started: boolean
  alreadyRunning: boolean
}
