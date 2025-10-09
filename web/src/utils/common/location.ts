import type { CommentLocation } from '@/models/comment'

export function formatLocation({ location, short }: { location: CommentLocation, short: boolean }): string {
  if (short) {
    return [location.country, location.province, location.city].filter(Boolean).join(' ')
  }
  else {
    return [location.country, location.province, location.city, location.districts, location.isp].filter(Boolean).join(' ')
  }
}
