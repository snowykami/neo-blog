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
