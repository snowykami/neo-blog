import type { LucideIcon } from 'lucide-react'
import type { PageKind } from '@/models/page'
import {
  ArchiveIcon,
  AwardIcon,
  BookmarkIcon,
  BookOpenIcon,
  CalendarIcon,
  CameraIcon,
  CircleHelpIcon,
  ClockIcon,
  CodeXmlIcon,
  CoffeeIcon,
  CompassIcon,
  CpuIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilmIcon,
  FlameIcon,
  FolderGit2Icon,
  Gamepad2Icon,
  GlobeIcon,
  HandshakeIcon,
  HeartIcon,
  ImageIcon,
  InfoIcon,
  LayersIcon,
  LinkIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  MusicIcon,
  PaletteIcon,
  RssIcon,
  SendIcon,
  ShieldIcon,
  SparklesIcon,
  StarIcon,
  TerminalIcon,
  UserRoundIcon,
  WrenchIcon,
} from 'lucide-react'

export const PAGE_ICON_NONE = 'none'

export interface PageIconEntry {
  key: string
  icon: LucideIcon
  keywords: string
}

export const PAGE_ICON_ENTRIES: readonly PageIconEntry[] = [
  { key: 'handshake', icon: HandshakeIcon, keywords: 'handshake friends 友链 朋友 伙伴 合作' },
  { key: 'music', icon: MusicIcon, keywords: 'music song audio 音乐 歌单 播放器' },
  { key: 'user-round', icon: UserRoundIcon, keywords: 'user about profile 关于 作者 个人' },
  { key: 'sparkles', icon: SparklesIcon, keywords: 'sparkles ai featured 精选 灵感 特效' },
  { key: 'book-open', icon: BookOpenIcon, keywords: 'book reading docs 书单 阅读 文档' },
  { key: 'code-xml', icon: CodeXmlIcon, keywords: 'code dev html 代码 开发 编程' },
  { key: 'folder-git-2', icon: FolderGit2Icon, keywords: 'git repo project 开源 项目 仓库' },
  { key: 'terminal', icon: TerminalIcon, keywords: 'terminal cli lab 终端 命令行 实验室' },
  { key: 'globe', icon: GlobeIcon, keywords: 'globe web site 网站 全球 导航' },
  { key: 'compass', icon: CompassIcon, keywords: 'compass explore 发现 探索 指南' },
  { key: 'heart', icon: HeartIcon, keywords: 'heart sponsor like 喜欢 赞助 感谢' },
  { key: 'coffee', icon: CoffeeIcon, keywords: 'coffee donate 打赏 咖啡 生活' },
  { key: 'camera', icon: CameraIcon, keywords: 'camera photo 相册 摄影 拍照' },
  { key: 'image', icon: ImageIcon, keywords: 'image gallery 画廊 图集 壁纸' },
  { key: 'film', icon: FilmIcon, keywords: 'film video anime 影视 追番 视频' },
  { key: 'gamepad-2', icon: Gamepad2Icon, keywords: 'game play 游戏 娱乐' },
  { key: 'palette', icon: PaletteIcon, keywords: 'palette design art 设计 作品 色彩' },
  { key: 'award', icon: AwardIcon, keywords: 'award trophy 奖项 荣誉 作品集' },
  { key: 'flame', icon: FlameIcon, keywords: 'flame hot trending 热门 动态 精选' },
  { key: 'star', icon: StarIcon, keywords: 'star favorite 收藏 推荐 评星' },
  { key: 'bookmark', icon: BookmarkIcon, keywords: 'bookmark save 书签 摘录' },
  { key: 'rss', icon: RssIcon, keywords: 'rss feed 订阅 朋友圈 动态流' },
  { key: 'message-circle', icon: MessageCircleIcon, keywords: 'message guestbook comment 留言 讨论 闲聊' },
  { key: 'mail', icon: MailIcon, keywords: 'mail contact 邮箱 联系 信箱' },
  { key: 'send', icon: SendIcon, keywords: 'send telegram social 投递 频道 社交' },
  { key: 'calendar', icon: CalendarIcon, keywords: 'calendar schedule 日历 计划 时间线' },
  { key: 'clock', icon: ClockIcon, keywords: 'clock timeline now 此刻 碎碎念 动态' },
  { key: 'map-pin', icon: MapPinIcon, keywords: 'map travel footprint 足迹 旅行 地点' },
  { key: 'cpu', icon: CpuIcon, keywords: 'cpu gear hardware 硬件 装备 数码' },
  { key: 'wrench', icon: WrenchIcon, keywords: 'wrench tools 工具 实用' },
  { key: 'layers', icon: LayersIcon, keywords: 'layers stack series 专题 系列 技术栈' },
  { key: 'archive', icon: ArchiveIcon, keywords: 'archive box 归档 存档 收集' },
  { key: 'shield', icon: ShieldIcon, keywords: 'shield privacy policy 隐私 协议 安全' },
  { key: 'info', icon: InfoIcon, keywords: 'info notice 说明 须知 公告' },
  { key: 'circle-help', icon: CircleHelpIcon, keywords: 'help faq 帮助 问答 常见问题' },
  { key: 'link', icon: LinkIcon, keywords: 'link url 链接 跳转' },
] as const

export const PAGE_ICON_MAP = new Map<string, LucideIcon>(
  PAGE_ICON_ENTRIES.map(entry => [entry.key, entry.icon]),
)

/**
 * 解析页面最终展示的图标：
 * - icon === 'none'：用户显式关闭图标，返回 null
 * - icon 命中预设图标表：返回对应 LucideIcon
 * - 未设置（''）或未知键：按页面类型与站内路径智能回退默认图标
 */
export function resolvePageNavIcon(page: {
  icon?: string | null
  kind?: PageKind | string
  linkUrl?: string
}): LucideIcon | null {
  const normalized = (page.icon || '').trim().toLowerCase()
  if (normalized === PAGE_ICON_NONE)
    return null
  const custom = PAGE_ICON_MAP.get(normalized)
  if (custom)
    return custom

  const isLink = page.kind === 'link' && !!page.linkUrl
  if (isLink) {
    const cleanLink = (page.linkUrl || '').trim()
    if (cleanLink === '/friends' || cleanLink.startsWith('/friends?'))
      return HandshakeIcon
    if (cleanLink === '/music' || cleanLink.startsWith('/music?'))
      return MusicIcon
    if (/^https?:\/\//i.test(cleanLink))
      return ExternalLinkIcon
    return LinkIcon
  }
  if (page.kind === 'html')
    return CodeXmlIcon
  return FileTextIcon
}
