export interface DetectedOwnerPlatform {
  icon: string
  label: string
}

const SCHEME_DETECTORS: Record<string, DetectedOwnerPlatform> = {
  mailto: { icon: 'mail', label: 'Email' },
  tel: { icon: 'phone', label: 'Phone' },
  sms: { icon: 'message-square', label: 'SMS' },
  tg: { icon: 'brand:telegram', label: 'Telegram' },
  tencent: { icon: 'brand:qq', label: 'QQ' },
  mqqapi: { icon: 'brand:qq', label: 'QQ' },
  mqqwpa: { icon: 'brand:qq', label: 'QQ' },
  weixin: { icon: 'brand:wechat', label: 'WeChat' },
  steam: { icon: 'brand:steam', label: 'Steam' },
  discord: { icon: 'brand:discord', label: 'Discord' },
  matrix: { icon: 'brand:matrix', label: 'Matrix' },
  nostr: { icon: 'brand:nostr', label: 'Nostr' },
}

const HOST_RULES: [pattern: RegExp, icon: string, label: string][] = [
  [/(?:^|\.)github\.com$/i, 'brand:github', 'GitHub'],
  [/(?:^|\.)x\.com$/i, 'brand:x', 'X'],
  [/(?:^|\.)twitter\.com$/i, 'brand:x', 'X'],
  [/(?:^|\.)(?:steamcommunity|steampowered)\.com$/i, 'brand:steam', 'Steam'],
  [/^(?:t\.me|telegram\.me|telegram\.org)$/i, 'brand:telegram', 'Telegram'],
  [/(?:^|\.)qq\.com$/i, 'brand:qq', 'QQ'],
  [/(?:^|\.)(?:wechat\.com|weixin\.qq\.com)$/i, 'brand:wechat', 'WeChat'],
  [/(?:^|\.)(?:bilibili\.com|b23\.tv)$/i, 'brand:bilibili', 'Bilibili'],
  [/(?:^|\.)(?:discord\.gg|discord\.com|discordapp\.com)$/i, 'brand:discord', 'Discord'],
  [/(?:^|\.)(?:facebook\.com|fb\.com|fb\.me)$/i, 'brand:facebook', 'Facebook'],
  [/(?:^|\.)instagram\.com$/i, 'brand:instagram', 'Instagram'],
  [/(?:^|\.)threads\.(?:net|com)$/i, 'brand:threads', 'Threads'],
  [/(?:^|\.)bsky\.app$/i, 'brand:bluesky', 'Bluesky'],
  [/(?:^|\.)(?:youtube\.com|youtu\.be)$/i, 'brand:youtube', 'YouTube'],
  [/(?:^|\.)twitch\.tv$/i, 'brand:twitch', 'Twitch'],
  [/(?:^|\.)(?:nicovideo\.jp|nico\.ms)$/i, 'brand:niconico', 'Niconico'],
  [/(?:^|\.)vimeo\.com$/i, 'brand:vimeo', 'Vimeo'],
  [/(?:^|\.)weibo\.(?:com|cn)$/i, 'brand:weibo', 'Weibo'],
  [/(?:^|\.)(?:xiaohongshu\.com|xhslink\.com)$/i, 'brand:xiaohongshu', '小红书'],
  [/(?:^|\.)zhihu\.com$/i, 'brand:zhihu', '知乎'],
  [/(?:^|\.)douban\.com$/i, 'brand:douban', '豆瓣'],
  [/(?:^|\.)(?:tiktok\.com|douyin\.com)$/i, 'brand:tiktok', 'TikTok'],
  [/(?:^|\.)kuaishou\.com$/i, 'brand:kuaishou', '快手'],
  [/(?:^|\.)coolapk\.com$/i, 'brand:coolapk', '酷安'],
  [/(?:^|\.)okjike\.com$/i, 'brand:jike', '即刻'],
  [/(?:^|\.)v2ex\.com$/i, 'brand:v2ex', 'V2EX'],
  [/(?:^|\.)(?:bgm\.tv|bangumi\.tv|chii\.in)$/i, 'brand:bangumi', 'Bangumi'],
  [/(?:^|\.)acfun\.cn$/i, 'brand:acfun', 'AcFun'],
  [/(?:^|\.)lofter\.com$/i, 'brand:lofter', 'LOFTER'],
  [/(?:^|\.)sspai\.com$/i, 'brand:sspai', '少数派'],
  [/(?:^|\.)juejin\.cn$/i, 'brand:juejin', '掘金'],
  [/(?:^|\.)csdn\.net$/i, 'brand:csdn', 'CSDN'],
  [/(?:^|\.)yuque\.com$/i, 'brand:yuque', '语雀'],
  [/(?:^|\.)gitlab\.com$/i, 'brand:gitlab', 'GitLab'],
  [/(?:^|\.)gitea\.(?:com|io)$/i, 'brand:gitea', 'Gitea'],
  [/(?:^|\.)codeberg\.org$/i, 'brand:codeberg', 'Codeberg'],
  [/(?:^|\.)gitee\.com$/i, 'brand:gitee', 'Gitee'],
  [/(?:^|\.)gitcode\.com$/i, 'brand:gitcode', 'GitCode'],
  [/(?:^|\.)bitbucket\.org$/i, 'brand:bitbucket', 'Bitbucket'],
  [/(?:^|\.)sr\.ht$/i, 'brand:sourcehut', 'SourceHut'],
  [/(?:^|\.)stackoverflow\.com$/i, 'brand:stackoverflow', 'Stack Overflow'],
  [/(?:^|\.)leetcode\.(?:com|cn)$/i, 'brand:leetcode', 'LeetCode'],
  [/(?:^|\.)codeforces\.com$/i, 'brand:codeforces', 'Codeforces'],
  [/(?:^|\.)codewars\.com$/i, 'brand:codewars', 'Codewars'],
  [/(?:^|\.)hackerrank\.com$/i, 'brand:hackerrank', 'HackerRank'],
  [/(?:^|\.)huggingface\.co$/i, 'brand:huggingface', 'Hugging Face'],
  [/(?:^|\.)kaggle\.com$/i, 'brand:kaggle', 'Kaggle'],
  [/(?:^|\.)codepen\.io$/i, 'brand:codepen', 'CodePen'],
  [/(?:^|\.)codesandbox\.io$/i, 'brand:codesandbox', 'CodeSandbox'],
  [/(?:^|\.)stackblitz\.com$/i, 'brand:stackblitz', 'StackBlitz'],
  [/(?:^|\.)docker\.com$/i, 'brand:docker', 'Docker'],
  [/(?:^|\.)npmjs\.com$/i, 'brand:npm', 'npm'],
  [/(?:^|\.)crates\.io$/i, 'brand:rust', 'Crates.io'],
  [/(?:^|\.)pypi\.org$/i, 'brand:pypi', 'PyPI'],
  [/(?:^|\.)go\.dev$/i, 'brand:golang', 'Go'],
  [/(?:^|\.)wakatime\.com$/i, 'brand:wakatime', 'WakaTime'],
  [/^dev\.to$/i, 'brand:devto', 'DEV'],
  [/(?:^|\.)hashnode\.(?:com|dev)$/i, 'brand:hashnode', 'Hashnode'],
  [/^news\.ycombinator\.com$/i, 'brand:hackernews', 'Hacker News'],
  [/(?:^|\.)producthunt\.com$/i, 'brand:producthunt', 'Product Hunt'],
  [/(?:^|\.)(?:playstation\.com|psnprofiles\.com)$/i, 'brand:playstation', 'PlayStation'],
  [/(?:^|\.)xbox\.com$/i, 'brand:xbox', 'Xbox'],
  [/(?:^|\.)nintendo\.com$/i, 'brand:nintendoswitch', 'Nintendo Switch'],
  [/(?:^|\.)epicgames\.com$/i, 'brand:epicgames', 'Epic Games'],
  [/(?:^|\.)gog\.com$/i, 'brand:gog', 'GOG'],
  [/(?:^|\.)itch\.io$/i, 'brand:itchio', 'itch.io'],
  [/^osu\.ppy\.sh$/i, 'brand:osu', 'osu!'],
  [/(?:^|\.)vrchat\.com$/i, 'brand:vrchat', 'VRChat'],
  [/(?:^|\.)chess\.com$/i, 'brand:chess', 'Chess.com'],
  [/(?:^|\.)lichess\.org$/i, 'brand:lichess', 'Lichess'],
  [/(?:^|\.)pixiv\.net$/i, 'brand:pixiv', 'Pixiv'],
  [/(?:^|\.)artstation\.com$/i, 'brand:artstation', 'ArtStation'],
  [/(?:^|\.)deviantart\.com$/i, 'brand:deviantart', 'DeviantArt'],
  [/(?:^|\.)behance\.net$/i, 'brand:behance', 'Behance'],
  [/(?:^|\.)dribbble\.com$/i, 'brand:dribbble', 'Dribbble'],
  [/(?:^|\.)figma\.com$/i, 'brand:figma', 'Figma'],
  [/(?:^|\.)unsplash\.com$/i, 'brand:unsplash', 'Unsplash'],
  [/(?:^|\.)500px\.com$/i, 'brand:500px', '500px'],
  [/(?:^|\.)flickr\.com$/i, 'brand:flickr', 'Flickr'],
  [/(?:^|\.)myanimelist\.net$/i, 'brand:myanimelist', 'MyAnimeList'],
  [/(?:^|\.)anilist\.co$/i, 'brand:anilist', 'AniList'],
  [/(?:^|\.)letterboxd\.com$/i, 'brand:letterboxd', 'Letterboxd'],
  [/(?:^|\.)goodreads\.com$/i, 'brand:goodreads', 'Goodreads'],
  [/(?:^|\.)trakt\.tv$/i, 'brand:trakt', 'Trakt'],
  [/^music\.163\.com$/i, 'brand:neteasemusic', '网易云音乐'],
  [/^y\.qq\.com$/i, 'brand:qqmusic', 'QQ 音乐'],
  [/(?:^|\.)spotify\.com$/i, 'brand:spotify', 'Spotify'],
  [/^music\.apple\.com$/i, 'brand:applemusic', 'Apple Music'],
  [/^music\.youtube\.com$/i, 'brand:youtubemusic', 'YouTube Music'],
  [/(?:^|\.)soundcloud\.com$/i, 'brand:soundcloud', 'SoundCloud'],
  [/(?:^|\.)bandcamp\.com$/i, 'brand:bandcamp', 'Bandcamp'],
  [/(?:^|\.)last\.fm$/i, 'brand:lastfm', 'Last.fm'],
  [/(?:^|\.)tidal\.com$/i, 'brand:tidal', 'TIDAL'],
  [/^podcasts\.apple\.com$/i, 'brand:applepodcasts', 'Apple Podcasts'],
  [/(?:^|\.)xiaoyuzhoufm\.com$/i, 'brand:xiaoyuzhou', '小宇宙'],
  [/(?:^|\.)medium\.com$/i, 'brand:medium', 'Medium'],
  [/(?:^|\.)substack\.com$/i, 'brand:substack', 'Substack'],
  [/(?:^|\.)(?:notion\.so|notion\.site)$/i, 'brand:notion', 'Notion'],
  [/^scholar\.google\./i, 'brand:googlescholar', 'Google Scholar'],
  [/(?:^|\.)orcid\.org$/i, 'brand:orcid', 'ORCID'],
  [/(?:^|\.)researchgate\.net$/i, 'brand:researchgate', 'ResearchGate'],
  [/(?:^|\.)arxiv\.org$/i, 'brand:arxiv', 'arXiv'],
  [/(?:^|\.)semanticscholar\.org$/i, 'brand:semanticscholar', 'Semantic Scholar'],
  [/(?:^|\.)dblp\.org$/i, 'brand:dblp', 'dblp'],
  [/(?:^|\.)afdian\.(?:com|net)$/i, 'brand:afdian', '爱发电'],
  [/(?:^|\.)patreon\.com$/i, 'brand:patreon', 'Patreon'],
  [/(?:^|\.)ko-fi\.com$/i, 'brand:kofi', 'Ko-fi'],
  [/(?:^|\.)buymeacoffee\.com$/i, 'brand:buymeacoffee', 'Buy Me a Coffee'],
  [/(?:^|\.)liberapay\.com$/i, 'brand:liberapay', 'Liberapay'],
  [/(?:^|\.)opencollective\.com$/i, 'brand:opencollective', 'Open Collective'],
  [/(?:^|\.)(?:paypal\.com|paypal\.me)$/i, 'brand:paypal', 'PayPal'],
  [/(?:^|\.)keybase\.io$/i, 'brand:keybase', 'Keybase'],
  [/(?:^|\.)reddit\.com$/i, 'brand:reddit', 'Reddit'],
  [/(?:^|\.)linkedin\.com$/i, 'brand:linkedin', 'LinkedIn'],
  [/(?:^|\.)quora\.com$/i, 'brand:quora', 'Quora'],
  [/(?:^|\.)pinterest\.com$/i, 'brand:pinterest', 'Pinterest'],
  [/(?:^|\.)tumblr\.com$/i, 'brand:tumblr', 'Tumblr'],
  [/(?:^|\.)vk\.com$/i, 'brand:vk', 'VK'],
  [/^line\.me$/i, 'brand:line', 'LINE'],
  [/(?:^|\.)(?:wa\.me|whatsapp\.com)$/i, 'brand:whatsapp', 'WhatsApp'],
  [/^signal\.me$/i, 'brand:signal', 'Signal'],
  [/^matrix\.to$/i, 'brand:matrix', 'Matrix'],
  [/(?:^|\.)misskey\./i, 'brand:misskey', 'Misskey'],
  [/(?:^|\.)mastodon\./i, 'brand:mastodon', 'Mastodon'],
]

/**
 * 根据填写的链接智能推断对应平台图标与默认名称（仅在用户尚未手动指定其他图标时用于辅助填充）
 */
export function detectPlatformFromUrl(raw: string): DetectedOwnerPlatform | null {
  const trimmed = raw.trim()
  if (!trimmed)
    return null
  if (/^\/(?:rss\.xml|feed\.xml|atom\.xml|feed|rss)(?:$|\?)/i.test(trimmed))
    return { icon: 'brand:rss', label: 'RSS' }
  const colon = trimmed.indexOf(':')
  if (colon <= 0)
    return null
  const scheme = trimmed.slice(0, colon).toLowerCase()
  if (SCHEME_DETECTORS[scheme])
    return SCHEME_DETECTORS[scheme]
  if (scheme !== 'http' && scheme !== 'https')
    return null
  try {
    const u = new URL(trimmed)
    const host = u.hostname.toLowerCase()
    if (host === 'y.qq.com')
      return { icon: 'brand:qqmusic', label: 'QQ 音乐' }
    if (host === 'mp.weixin.qq.com')
      return { icon: 'brand:wechat', label: 'WeChat' }
    if (host === 'music.youtube.com')
      return { icon: 'brand:youtubemusic', label: 'YouTube Music' }
    for (const [pattern, icon, label] of HOST_RULES) {
      if (pattern.test(host))
        return { icon, label }
    }
    if (/\b(?:rss|atom|feed)\.xml$/i.test(u.pathname))
      return { icon: 'brand:rss', label: 'RSS' }
  }
  catch {
    return null
  }
  return null
}
