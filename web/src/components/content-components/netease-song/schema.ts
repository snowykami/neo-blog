import { z } from 'zod'

export const neteaseSongSchema = z.object({
  // 网易云歌曲 ID（歌曲链接中 id= 后的数字）
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(0),
})

export type NeteaseSongProps = z.output<typeof neteaseSongSchema>
export type NeteaseSongInput = z.input<typeof neteaseSongSchema>
