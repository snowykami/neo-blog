function getAgoString(diff: number, unitI18n: { secondsAgo: string; minutesAgo: string; hoursAgo: string; daysAgo: string; }): string {
  let value: number, unit: string;
  if (diff < 60 * 1000) {
    value = Math.floor(diff / 1000);
    unit = unitI18n.secondsAgo;
    return `${value}${unit}`;
  } else if (diff < 60 * 60 * 1000) {
    value = Math.floor(diff / (60 * 1000));
    unit = unitI18n.minutesAgo;
    return `${value}${unit}`;
  } else if (diff < 24 * 60 * 60 * 1000) {
    value = Math.floor(diff / (60 * 60 * 1000));
    unit = unitI18n.hoursAgo;
    return `${value}${unit}`;
  } else {
    value = Math.floor(diff / (24 * 60 * 60 * 1000));
    unit = unitI18n.daysAgo;
    return `${value}${unit}`;
  }
}

export function formatDateTime({
  dateTimeString,
  locale,
  convertShortAgo,
  convertShortAgoDuration = 3 * 24 * 60 * 60 * 1000,
  unitI18n = { secondsAgo: "s ago", minutesAgo: "m ago", hoursAgo: "h ago", daysAgo: "d ago" }
}: {
  dateTimeString: string;
  locale: string;
  convertShortAgo?: boolean;
  convertShortAgoDuration?: number;
  unitI18n?: { secondsAgo: string; minutesAgo: string; hoursAgo: string; daysAgo: string; };
}): string {
  const date = new Date(dateTimeString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (convertShortAgo && diff >= 0 && diff < convertShortAgoDuration) {
    return getAgoString(diff, unitI18n);
  }

  if (now.getFullYear() !== date.getFullYear()) {
    // 不同年，显示完整日期时间
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } 

  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
  });
}