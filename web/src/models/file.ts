export interface FileModel {
  id: number
  name: string
  hash: string
  group: string
  type: string
  userId: number
  providerId: number
  createdAt: Date
  updatedAt: Date
  size: number // 文件大小 File size
  mimeType: string // 文件 MIME 类型 File MIME type
}

export interface StorageProviderConfig {
  id: number
  name: string
  type: string
  isDefault: boolean

  baseDir?: string // for local & webdav storage provider
  s3Region?: string // for s3 storage provider
  s3Bucket?: string // for s3 storage provider
  s3Prefix?: string // for s3 storage provider
  s3AccessKeyId?: string // for s3 storage provider
  s3SecretAccessKey?: string // for s3 storage provider
  s3Endpoint?: string // for s3 storage provider
  s3PathStyle?: boolean // for s3 storage provider
  s3BaseUrl?: string // for s3 storage provider

  // for webdav
  webdavEndpoint?: string
  webdavUsername?: string
  webdavPassword?: string
}

// 存储提供者的占用情况：仍有文件或 HTML 页面版本时不能删除
export interface StorageProviderUsage {
  files: number
  bytes: number
  pageHtmlVersions: number
}

export type StorageMigrationState = 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'

// 存储迁移进度；同一时间只运行一个迁移任务
export interface StorageMigrationStatus {
  state: StorageMigrationState
  phase: 'links' | 'files' | 'pages'
  sourceProviderId: number // 按选中文件迁移时为 0
  targetProviderId: number
  providerIds: number[]
  fileCount: number // 选中的文件数，迁移整个存储时为 0
  objects: number
  totalBytes: number
  done: number
  copied: number
  failed: number
  bytes: number
  pageHtmlVersions: number
  pageHtmlDone: number
  linksUpdated: number
  errors: string[]
  startedAt: string
  updatedAt: string
  finishedAt: string | null
}
