export function isClient() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}
