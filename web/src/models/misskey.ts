export interface MisskeyUser {
  username: string
  name: string
  avatarUrl: string
  profileUrl: string
}

export interface MisskeyNoteImage {
  thumbnailUrl: string
  alt: string
}

export interface MisskeyQuote {
  username?: string
  name?: string
  text?: string
  cw?: string
  hasMedia?: boolean
  url?: string
}

export interface MisskeyNote {
  id: string
  url: string
  text: string
  cw?: string
  createdAt: string
  isRenote?: boolean
  renoteUser?: string
  quote?: MisskeyQuote | null
  images?: MisskeyNoteImage[]
  reactionsCount?: number
  repliesCount?: number
  renotesCount?: number
}

export interface MisskeyFeed {
  enabled: boolean
  fetchedAt?: string
  instanceUrl?: string
  user?: MisskeyUser | null
  notes: MisskeyNote[]
  total?: number
  hasMore?: boolean
  nextCursor?: string
}

export interface MisskeyFeedQuery {
  offset?: number
  limit?: number
  cursor?: string
}
