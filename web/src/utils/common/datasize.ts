export function formatDataSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`
  }
  else if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(2)} KiB`
  }
  else if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(2)} MiB`
  }
  else if (size < 1024 * 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GiB`
  }
  else {
    return `${(size / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TiB`
  }
}
