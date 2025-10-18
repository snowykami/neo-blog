function getAgoString(
  diff: number,
  unitI18n: {
    secondsAgo: string
    minutesAgo: string
    hoursAgo: string
    daysAgo: string
  },
): string {
  let value: number, unit: string
  if (diff < 60 * 1000) {
    value = Math.floor(diff / 1000)
    unit = unitI18n.secondsAgo
    return `${value}${unit}`
  }
  else if (diff < 60 * 60 * 1000) {
    value = Math.floor(diff / (60 * 1000))
    unit = unitI18n.minutesAgo
    return `${value}${unit}`
  }
  else if (diff < 24 * 60 * 60 * 1000) {
    value = Math.floor(diff / (60 * 60 * 1000))
    unit = unitI18n.hoursAgo
    return `${value}${unit}`
  }
  else {
    value = Math.floor(diff / (24 * 60 * 60 * 1000))
    unit = unitI18n.daysAgo
    return `${value}${unit}`
  }
}

export function formatDateTime({
  dateTimeString,
  locale,
  convertShortAgo,
  convertShortAgoDuration = 3 * 24 * 60 * 60 * 1000,
  unitI18n = {
    secondsAgo: 's ago',
    minutesAgo: 'm ago',
    hoursAgo: 'h ago',
    daysAgo: 'd ago',
  },
}: {
  dateTimeString: string
  locale: string
  convertShortAgo?: boolean
  convertShortAgoDuration?: number
  unitI18n?: {
    secondsAgo: string
    minutesAgo: string
    hoursAgo: string
    daysAgo: string
  }
}): string {
  const date = new Date(dateTimeString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (convertShortAgo && diff >= 0 && diff < convertShortAgoDuration) {
    return getAgoString(diff, unitI18n)
  }

  if (now.getFullYear() !== date.getFullYear()) {
    // 不同年，显示完整日期时间
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
  })
}

// => dd:hh:mm:ss
export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / (24 * 60 * 60))
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60))
  const minutes = Math.floor((seconds % (60 * 60)) / 60)
  const secs = seconds % 60

  return `${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

// => mm:ss
export function formatDurationMMSS(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
