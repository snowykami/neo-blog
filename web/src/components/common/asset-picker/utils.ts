import type { FileTypeFilter } from '@/api/file'
import type { FileModel } from '@/models/file'
import { getFileUri } from '@/utils/client/file'

/** 选择结果：文件地址与元信息 */
export interface PickedAsset {
  id: number
  url: string
  name: string
  mimeType: string
  size: number
}

export function toPickedAsset(file: Pick<FileModel, 'id' | 'name' | 'mimeType' | 'size'>): PickedAsset {
  return { id: file.id, url: getFileUri(file.id), name: file.name, mimeType: file.mimeType, size: file.size }
}

function acceptTokens(accept?: string) {
  return (accept ?? '').split(',').map(token => token.trim().toLowerCase()).filter(token => token && token !== '*' && token !== '*/*')
}

/** 与 <input accept> 相同的匹配规则：MIME（含 image/* 通配）或扩展名，未限制时全部通过 */
export function matchAccept(file: { name: string, mimeType: string }, accept?: string) {
  const tokens = acceptTokens(accept)
  if (tokens.length === 0)
    return true
  const mimeType = file.mimeType.toLowerCase().split(';')[0]
  const name = file.name.toLowerCase()
  return tokens.some((token) => {
    if (token.startsWith('.'))
      return name.endsWith(token)
    if (token.endsWith('/*'))
      return mimeType.startsWith(token.slice(0, -1))
    return mimeType === token
  })
}

/** accept 只涉及一种媒体大类时，资产库固定按该类型筛选 */
export function lockedTypeOf(accept?: string): FileTypeFilter | undefined {
  const tokens = acceptTokens(accept)
  if (tokens.length === 0 || tokens.some(token => token.startsWith('.')))
    return undefined
  const kinds = new Set(tokens.map(token => token.split('/')[0]))
  const [kind] = kinds
  return kinds.size === 1 && (kind === 'image' || kind === 'video' || kind === 'audio') ? kind : undefined
}

export function isImageAsset(file: { mimeType: string }) {
  return file.mimeType.startsWith('image/')
}
