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

export interface MisskeyNote {
  id: string
  url: string
  text: string
  cw?: string
  createdAt: string
  isRenote?: boolean
  renoteUser?: string
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
}
