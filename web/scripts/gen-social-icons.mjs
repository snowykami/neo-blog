/**
 * 生成常用社交与平台图标目录：src/lib/social-icons/social-icons.generated.json
 * - 从已安装的 react-icons（fa6 / si / ri / tb）提取指定平台图标的纯 SVG 节点树，避免前端构建或运行时引入数 MB 的图标大包
 * - 对 react-icons 未收录的国内 / 二次元常见平台（Bangumi、酷安、即刻、LOFTER、飞书、少数派、小宇宙等）补充精简几何矢量图标
 * - 输出提交到仓库；新增平台或升级 react-icons 后运行 `node scripts/gen-social-icons.mjs` 更新
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const outputFile = join(root, 'src/lib/social-icons/social-icons.generated.json')

const packs = {
  fa6: require('react-icons/fa6'),
  si: require('react-icons/si'),
  ri: require('react-icons/ri'),
  tb: require('react-icons/tb'),
}

const ALLOWED_TAGS = new Set(['path', 'circle', 'rect', 'polygon', 'polyline', 'line', 'ellipse', 'g'])

function cleanNode(node) {
  if (!node || !ALLOWED_TAGS.has(node.tag))
    return null
  const attr = {}
  for (const [k, v] of Object.entries(node.attr ?? {})) {
    if (v != null && v !== '' && k !== 'role')
      attr[k] = String(v)
  }
  const children = (node.child ?? []).map(cleanNode).filter(Boolean)
  return children.length > 0 ? { tag: node.tag, attr, child: children } : { tag: node.tag, attr }
}

function extractReactIcon(packName, exportName) {
  const fn = packs[packName]?.[exportName]
  if (typeof fn !== 'function')
    throw new Error(`Missing icon ${packName}.${exportName}`)
  const src = fn.toString()
  const match = /GenIcon\((\{[\s\S]*\})\)\(props\)/.exec(src)
  if (!match)
    throw new Error(`Cannot parse GenIcon tree from ${packName}.${exportName}`)
  const tree = JSON.parse(match[1])
  const viewBox = tree.attr?.viewBox || '0 0 24 24'
  const stroke = tree.attr?.stroke === 'currentColor' || tree.attr?.fill === 'none'
  const nodes = (tree.child ?? []).map(cleanNode).filter(Boolean)
  if (nodes.length === 0)
    throw new Error(`Empty SVG child nodes in ${packName}.${exportName}`)
  return { viewBox, ...(stroke ? { stroke: true } : {}), nodes }
}

/**
 * 自定义精简矢量图标（统一 0 0 24 24 画布，适配 16px~24px 小尺寸单色渲染）
 */
const customSpecs = {
  bangumi: {
    viewBox: '0 0 24 24',
    stroke: true,
    nodes: [
      { tag: 'path', attr: { d: 'M8.5 3.5L11.5 7L15.5 3.5' } },
      { tag: 'rect', attr: { x: '3', y: '7', width: '18', height: '13', rx: '3.5' } },
      { tag: 'rect', attr: { x: '6.5', y: '10.5', width: '7.5', height: '6', rx: '1.2' } },
      { tag: 'circle', attr: { cx: '17.5', cy: '12', r: '1' } },
      { tag: 'circle', attr: { cx: '17.5', cy: '15.5', r: '1' } },
    ],
  },
  coolapk: {
    viewBox: '0 0 24 24',
    stroke: true,
    nodes: [
      { tag: 'circle', attr: { cx: '12', cy: '12', r: '9' } },
      { tag: 'path', attr: { d: 'M10.8 9.2a3.2 3.2 0 1 0 0 5.6' } },
      { tag: 'circle', attr: { cx: '15', cy: '12', r: '2.3' } },
    ],
  },
  jike: {
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'path', attr: { d: 'M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3Zm7.25 4.25v6.6a2.35 2.35 0 0 1-4.55.82l-1.95.78a4.45 4.45 0 0 0 8.6-1.6V7.25h-2.1Z' } },
    ],
  },
  lofter: {
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'path', attr: { d: 'M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3Zm2.75 4.5v9h7.5v-2.2h-5.2V7.5h-2.3Z' } },
    ],
  },
  acfun: {
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'path', attr: { d: 'M11.1 3.6a1.1 1.1 0 0 1 1.98 0l7.4 15.3a.9.9 0 0 1-.81 1.3h-2.35a.9.9 0 0 1-.82-.53l-1.35-2.97H8.85l-1.35 2.97a.9.9 0 0 1-.82.53H4.33a.9.9 0 0 1-.81-1.3l7.58-15.3Zm-1.26 9.6h4.32L12 8.28 9.84 13.2Z' } },
    ],
  },
  lark: {
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'path', attr: { d: 'M3.6 5.2c-.38-.22-.84.13-.73.56l2.42 9.48a2.5 2.5 0 0 0 1.47 1.69l6.58 2.77c.44.19.9-.2.78-.66l-1.36-5.22 7.57-3.19c.48-.2.49-.88.02-1.1L3.6 5.2Zm6.94 6.55-3.4-5.12 10.12 4.76-6.72.36Z' } },
    ],
  },
  sspai: {
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'path', attr: { d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5.2 6.8v1.9h-1.85v4.35c0 .58.27.84.82.84.28 0 .54-.05.78-.14v1.72c-.36.14-.78.22-1.25.22-1.56 0-2.4-.8-2.4-2.38V10.7h-2.55v4.12c0 1.24-.35 2.22-1.08 2.95l-1.48-1.22c.45-.48.66-1.12.66-1.92V10.7H6.9V8.8h10.3Z' } },
    ],
  },
  qqmusic: {
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'path', attr: { d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.75 5.4c.42 1.28 1.38 2.15 2.55 2.48v2.04a5.2 5.2 0 0 1-2.55-.86v4.39a3.65 3.65 0 1 1-2.85-3.56V14a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 1.65-1.65V6.6h1.2v.8Z' } },
    ],
  },
  xiaoyuzhou: {
    viewBox: '0 0 24 24',
    stroke: true,
    nodes: [
      { tag: 'circle', attr: { cx: '12', cy: '12', r: '5.5' } },
      { tag: 'path', attr: { d: 'M3.2 15.2c-1.1-1.9 2.1-5.1 7.3-7.2s10.3-2.2 11.4-.3c.8 1.4-.9 3.6-4.1 5.6' } },
      { tag: 'circle', attr: { cx: '16.8', cy: '6.2', r: '1' } },
    ],
  },
  nostr: {
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'path', attr: { d: 'M5 4h3.3l7.4 10.6V4H19v16h-3.3L8.3 9.4V20H5V4Z' } },
    ],
  },
}

/**
 * 平台清单（展示顺序按最常用程度排列，打开选择器时第一屏即覆盖最常见社交与社区平台）
 * 字段：[id, label, searchWords, source]
 */
const DEFINITIONS = [
  // 一屏高频常用平台
  ['github', 'GitHub', 'github gh git 代码 开源 仓库 octocat', ['fa6', 'FaGithub']],
  ['x', 'X (Twitter)', 'x twitter 推特 推文 x.com', ['fa6', 'FaXTwitter']],
  ['twitter', 'Twitter', 'twitter 推特 小蓝鸟 蓝鸟', ['fa6', 'FaTwitter']],
  ['steam', 'Steam', 'steam valve 蒸汽 蒸汽平台 游戏 steamcommunity', ['fa6', 'FaSteam']],
  ['telegram', 'Telegram', 'telegram tg 电报 纸飞机 t.me', ['fa6', 'FaTelegram']],
  ['qq', 'QQ', 'qq tencent 腾讯 企鹅 qzone', ['fa6', 'FaQq']],
  ['wechat', '微信 (WeChat)', 'wechat weixin wx 微信 公众号 视频号', ['fa6', 'FaWeixin']],
  ['bilibili', '哔哩哔哩 (Bilibili)', 'bilibili b站 哔哩哔哩 小破站 b23', ['si', 'SiBilibili']],
  ['discord', 'Discord', 'discord dc 频道 语音 社区', ['fa6', 'FaDiscord']],
  ['facebook', 'Facebook', 'facebook fb meta 脸书', ['fa6', 'FaFacebook']],
  ['instagram', 'Instagram', 'instagram ins ig 照片 社交', ['fa6', 'FaInstagram']],
  ['youtube', 'YouTube', 'youtube ytb 油管 视频 频道', ['fa6', 'FaYoutube']],
  ['weibo', '微博 (Weibo)', 'weibo sina 微博 新浪微博', ['fa6', 'FaWeibo']],
  ['xiaohongshu', '小红书', 'xiaohongshu xhs red rednote 小红书', ['si', 'SiXiaohongshu']],
  ['zhihu', '知乎 (Zhihu)', 'zhihu 知乎 问答 专栏', ['si', 'SiZhihu']],
  ['tiktok', '抖音 / TikTok', 'tiktok douyin 抖音 短视频', ['fa6', 'FaTiktok']],
  ['rss', 'RSS', 'rss atom feed xml 订阅 订阅源', ['fa6', 'FaRss']],
  ['gmail', 'Gmail', 'gmail email mail google 谷歌邮箱 邮箱 邮件', ['si', 'SiGmail']],

  // 联邦宇宙与国际社交 / 即时通讯
  ['misskey', 'Misskey', 'misskey fediverse 联邦宇宙 迷스키', ['si', 'SiMisskey']],
  ['mastodon', 'Mastodon (长毛象)', 'mastodon 长毛象 万象 fediverse 联邦宇宙', ['fa6', 'FaMastodon']],
  ['bluesky', 'Bluesky', 'bluesky bsky 蓝天 蝴蝶', ['fa6', 'FaBluesky']],
  ['threads', 'Threads', 'threads meta 串', ['fa6', 'FaThreads']],
  ['activitypub', 'ActivityPub', 'activitypub fediverse 联邦宇宙 去中心化', ['si', 'SiActivitypub']],
  ['nostr', 'Nostr', 'nostr 去中心化 社交协议', ['custom', 'nostr']],
  ['reddit', 'Reddit', 'reddit 红迪 论坛 社区', ['fa6', 'FaReddit']],
  ['linkedin', 'LinkedIn (领英)', 'linkedin 领英 职场 简历', ['fa6', 'FaLinkedin']],
  ['matrix', 'Matrix', 'matrix 加密聊天 去中心化', ['si', 'SiMatrix']],
  ['element', 'Element', 'element matrix 聊天', ['si', 'SiElement']],
  ['signal', 'Signal', 'signal 加密通讯 隐私聊天', ['fa6', 'FaSignalMessenger']],
  ['whatsapp', 'WhatsApp', 'whatsapp wa 聊天 电话', ['fa6', 'FaWhatsapp']],
  ['line', 'LINE', 'line 连我 聊天', ['fa6', 'FaLine']],
  ['kakaotalk', 'KakaoTalk', 'kakaotalk kakao 聊天', ['si', 'SiKakaotalk']],
  ['slack', 'Slack', 'slack 团队协作 频道', ['fa6', 'FaSlack']],
  ['skype', 'Skype', 'skype 通话 视频电话', ['fa6', 'FaSkype']],
  ['lark', '飞书 (Lark)', 'lark feishu 飞书 字节 协作', ['custom', 'lark']],
  ['dingtalk', '钉钉 (DingTalk)', 'dingtalk dingding 钉钉 阿里 办公', ['ri', 'RiDingdingFill']],
  ['pinterest', 'Pinterest', 'pinterest 灵感 瀑布流 图片', ['fa6', 'FaPinterest']],
  ['tumblr', 'Tumblr', 'tumblr 汤不热 轻博客', ['fa6', 'FaTumblr']],
  ['snapchat', 'Snapchat', 'snapchat 阅后即焚', ['fa6', 'FaSnapchat']],
  ['vk', 'VK', 'vk vkontakte 俄罗斯社交', ['fa6', 'FaVk']],
  ['quora', 'Quora', 'quora 问答', ['fa6', 'FaQuora']],

  // 国内社区、内容与二次元
  ['douban', '豆瓣 (Douban)', 'douban 豆瓣 书影音 电影 读书', ['si', 'SiDouban']],
  ['coolapk', '酷安 (Coolapk)', 'coolapk 酷安 数码 安卓', ['custom', 'coolapk']],
  ['jike', '即刻 (Jike)', 'jike okjike 即刻 黄即', ['custom', 'jike']],
  ['v2ex', 'V2EX', 'v2ex 创意工作者 社区 程序员论坛', ['si', 'SiV2Ex']],
  ['bangumi', 'Bangumi 番组计划', 'bangumi bgm chii 番组计划 二次元 动画 追番 acg', ['custom', 'bangumi']],
  ['kuaishou', '快手 (Kuaishou)', 'kuaishou kwai 快手 短视频', ['si', 'SiKuaishou']],
  ['acfun', 'AcFun (A站)', 'acfun a站 弹幕 视频 acg', ['custom', 'acfun']],
  ['lofter', 'LOFTER (乐乎)', 'lofter 乐乎 同人 创作 网易', ['custom', 'lofter']],
  ['tieba', '百度贴吧', 'tieba baidu 贴吧 百度贴吧 百度', ['si', 'SiBaidu']],
  ['sspai', '少数派 (sspai)', 'sspai 少数派 数码 效率 文章', ['custom', 'sspai']],
  ['juejin', '稀土掘金', 'juejin 掘金 稀土掘金 技术社区', ['si', 'SiJuejin']],
  ['csdn', 'CSDN', 'csdn 技术博客 开发者', ['si', 'SiCsdn']],
  ['yuque', '语雀 (Yuque)', 'yuque 语雀 知识库 文档', ['ri', 'RiYuqueFill']],

  // 代码托管与开发者生态
  ['gitlab', 'GitLab', 'gitlab git 代码托管 devops', ['fa6', 'FaGitlab']],
  ['gitea', 'Gitea', 'gitea git 自建代码库 轻量git', ['si', 'SiGitea']],
  ['forgejo', 'Forgejo', 'forgejo git 自建代码库', ['si', 'SiForgejo']],
  ['codeberg', 'Codeberg', 'codeberg git 开源代码库', ['si', 'SiCodeberg']],
  ['gitee', 'Gitee (码云)', 'gitee 码云 国内git 代码托管', ['si', 'SiGitee']],
  ['gitcode', 'GitCode', 'gitcode git 代码托管', ['si', 'SiGitcode']],
  ['bitbucket', 'Bitbucket', 'bitbucket atlassian git', ['fa6', 'FaBitbucket']],
  ['sourcehut', 'SourceHut', 'sourcehut srht git', ['si', 'SiSourcehut']],
  ['stackoverflow', 'Stack Overflow', 'stackoverflow so 栈溢出 技术问答 编程问答', ['fa6', 'FaStackOverflow']],
  ['leetcode', 'LeetCode (力扣)', 'leetcode 力扣 算法 刷题 面试', ['si', 'SiLeetcode']],
  ['codeforces', 'Codeforces', 'codeforces cf 算法竞赛 acm cp', ['si', 'SiCodeforces']],
  ['codewars', 'Codewars', 'codewars kata 算法练习', ['si', 'SiCodewars']],
  ['hackerrank', 'HackerRank', 'hackerrank 算法 编程测评', ['fa6', 'FaHackerrank']],
  ['huggingface', 'Hugging Face', 'huggingface hf ai llm 大模型 机器学习 抱抱脸', ['si', 'SiHuggingface']],
  ['kaggle', 'Kaggle', 'kaggle 数据科学 机器学习 竞赛', ['fa6', 'FaKaggle']],
  ['openai', 'OpenAI / ChatGPT', 'openai chatgpt gpt ai', ['ri', 'RiOpenaiFill']],
  ['claude', 'Claude / Anthropic', 'claude anthropic ai', ['si', 'SiClaude']],
  ['codepen', 'CodePen', 'codepen 前端 在线代码 演示', ['fa6', 'FaCodepen']],
  ['codesandbox', 'CodeSandbox', 'codesandbox 在线ide 沙盒', ['si', 'SiCodesandbox']],
  ['stackblitz', 'StackBlitz', 'stackblitz 在线ide 前端', ['si', 'SiStackblitz']],
  ['jsfiddle', 'JSFiddle', 'jsfiddle 前端 代码片段', ['fa6', 'FaJsfiddle']],
  ['docker', 'Docker Hub', 'docker dockerhub 容器 镜像', ['fa6', 'FaDocker']],
  ['npm', 'npm', 'npm nodejs javascript typescript 包管理', ['fa6', 'FaNpm']],
  ['rust', 'Crates.io (Rust)', 'rust crates cargo rustlang 包', ['fa6', 'FaRust']],
  ['pypi', 'PyPI (Python)', 'pypi python pip 包', ['si', 'SiPypi']],
  ['golang', 'Go (pkg.go.dev)', 'go golang gopher pkg.go.dev', ['fa6', 'FaGolang']],
  ['wakatime', 'WakaTime', 'wakatime 编程统计 编码时长', ['si', 'SiWakatime']],
  ['devto', 'DEV Community', 'devto dev.to 技术博客 开发者社区', ['fa6', 'FaDev']],
  ['hashnode', 'Hashnode', 'hashnode 技术博客', ['fa6', 'FaHashnode']],
  ['hackernews', 'Hacker News', 'hackernews hn ycombinator yc 极客新闻', ['fa6', 'FaHackerNews']],
  ['producthunt', 'Product Hunt', 'producthunt ph 产品发布 独立开发', ['fa6', 'FaProductHunt']],

  // 游戏平台与社区
  ['playstation', 'PlayStation (PSN)', 'playstation psn ps5 ps4 sony 索尼 主机游戏', ['fa6', 'FaPlaystation']],
  ['xbox', 'Xbox', 'xbox microsoft 微软游戏 xgp 主机游戏', ['fa6', 'FaXbox']],
  ['nintendoswitch', 'Nintendo Switch', 'nintendo switch ns 任天堂 掌机 主机游戏', ['ri', 'RiSwitchFill']],
  ['epicgames', 'Epic Games', 'epic epicgames 虚幻 游戏商城', ['si', 'SiEpicgames']],
  ['gog', 'GOG.com', 'gog cdprojekt 无drm 游戏', ['si', 'SiGogdotcom']],
  ['itchio', 'itch.io', 'itch itchio 独立游戏 indiegames', ['fa6', 'FaItchIo']],
  ['battlenet', 'Battle.net (战网)', 'battlenet blizzard 战网 暴雪 魔兽 守望先锋', ['fa6', 'FaBattleNet']],
  ['riotgames', 'Riot Games (拳头)', 'riot riotgames 拳头 lol 英雄联盟 valorant 无畏契约', ['si', 'SiRiotgames']],
  ['ubisoft', 'Ubisoft (育碧)', 'ubisoft uplay 育碧 阿育', ['si', 'SiUbisoft']],
  ['ea', 'EA', 'ea origin electronicarts 游戏', ['si', 'SiEa']],
  ['osu', 'osu!', 'osu 音游 节奏游戏', ['si', 'SiOsu']],
  ['vrchat', 'VRChat', 'vrchat vrc vr 虚拟现实 元宇宙', ['si', 'SiVrchat']],
  ['minecraft', 'Minecraft (我的世界)', 'minecraft mc 我的世界 沙盒', ['tb', 'TbBrandMinecraft']],
  ['roblox', 'Roblox', 'roblox 罗布乐思 游戏', ['si', 'SiRoblox']],
  ['chess', 'Chess.com', 'chess 国际象棋 下棋', ['fa6', 'FaChess']],
  ['lichess', 'Lichess', 'lichess 国际象棋 开源象棋', ['si', 'SiLichess']],

  // 视频、直播、插画、动漫、摄影与设计
  ['twitch', 'Twitch', 'twitch 直播 游戏直播 老鼠台', ['fa6', 'FaTwitch']],
  ['niconico', 'Niconico (N站)', 'niconico nicovideo n站 弹幕 二次元', ['si', 'SiNiconico']],
  ['vimeo', 'Vimeo', 'vimeo 视频 短片 创作', ['si', 'SiVimeo']],
  ['pixiv', 'Pixiv (P站)', 'pixiv p站 插画 画师 二次元 同人', ['fa6', 'FaPixiv']],
  ['artstation', 'ArtStation', 'artstation a站 原画 概念设计 cg 3d', ['fa6', 'FaArtstation']],
  ['deviantart', 'DeviantArt', 'deviantart da 插画 艺术社区', ['fa6', 'FaDeviantart']],
  ['behance', 'Behance', 'behance adobe 设计作品集 视觉设计', ['fa6', 'FaBehance']],
  ['dribbble', 'Dribbble', 'dribbble 追波 ui设计 视觉设计', ['fa6', 'FaDribbble']],
  ['figma', 'Figma', 'figma ui设计 社区 原型', ['fa6', 'FaFigma']],
  ['unsplash', 'Unsplash', 'unsplash 摄影 图库 壁纸', ['fa6', 'FaUnsplash']],
  ['500px', '500px', '500px 摄影 摄影师 作品集', ['si', 'Si500Px']],
  ['flickr', 'Flickr', 'flickr 摄影 相册 图床', ['fa6', 'FaFlickr']],
  ['myanimelist', 'MyAnimeList', 'myanimelist mal 动漫 追番 评分', ['si', 'SiMyanimelist']],
  ['anilist', 'AniList', 'anilist al 动漫 漫画 二次元', ['si', 'SiAnilist']],
  ['letterboxd', 'Letterboxd', 'letterboxd 电影 影评 观影记录', ['si', 'SiLetterboxd']],
  ['goodreads', 'Goodreads', 'goodreads 读书 书单 书评', ['fa6', 'FaGoodreads']],
  ['trakt', 'Trakt', 'trakt 追剧 影视记录', ['si', 'SiTrakt']],

  // 音乐与播客
  ['neteasemusic', '网易云音乐', 'netease neteasecloudmusic ncm 163 music.163 网易云音乐 云村 歌单', ['si', 'SiNeteasecloudmusic']],
  ['qqmusic', 'QQ 音乐', 'qqmusic y.qq.com qq音乐 绿钻 歌单', ['custom', 'qqmusic']],
  ['spotify', 'Spotify', 'spotify 声破天 音乐 歌单 播客', ['fa6', 'FaSpotify']],
  ['applemusic', 'Apple Music', 'applemusic 苹果音乐 歌单', ['si', 'SiApplemusic']],
  ['youtubemusic', 'YouTube Music', 'youtubemusic ytm 音乐', ['si', 'SiYoutubemusic']],
  ['soundcloud', 'SoundCloud', 'soundcloud 独立音乐 电音 音频', ['fa6', 'FaSoundcloud']],
  ['bandcamp', 'Bandcamp', 'bandcamp 独立音乐 数字专辑', ['fa6', 'FaBandcamp']],
  ['lastfm', 'Last.fm', 'lastfm last.fm scrobble 听歌统计 音乐记录', ['fa6', 'FaLastfm']],
  ['tidal', 'TIDAL', 'tidal 无损音乐 hifi', ['si', 'SiTidal']],
  ['applepodcasts', 'Apple Podcasts', 'applepodcasts podcast 苹果播客 播客 电台', ['si', 'SiApplepodcasts']],
  ['xiaoyuzhou', '小宇宙播客', 'xiaoyuzhou xiaoyuzhoufm podcast 小宇宙 播客 电台', ['custom', 'xiaoyuzhou']],

  // 写作、专栏与笔记
  ['medium', 'Medium', 'medium 专栏 英文博客 写作', ['fa6', 'FaMedium']],
  ['substack', 'Substack', 'substack newsletter 邮件订阅 专栏 通讯', ['si', 'SiSubstack']],
  ['ghost', 'Ghost', 'ghost 独立博客 专栏', ['si', 'SiGhost']],
  ['wordpress', 'WordPress', 'wordpress wp 博客', ['fa6', 'FaWordpress']],
  ['notion', 'Notion', 'notion 笔记 知识库 主页 wiki', ['si', 'SiNotion']],
  ['obsidian', 'Obsidian', 'obsidian publish 笔记 双链 知识库', ['si', 'SiObsidian']],

  // 学术与科研
  ['googlescholar', 'Google Scholar (谷歌学术)', 'googlescholar scholar 谷歌学术 学术 论文 引用', ['fa6', 'FaGoogleScholar']],
  ['orcid', 'ORCID', 'orcid 学者标识 科研 学术主页', ['fa6', 'FaOrcid']],
  ['researchgate', 'ResearchGate', 'researchgate rg 科研 论文 学者', ['fa6', 'FaResearchgate']],
  ['arxiv', 'arXiv', 'arxiv 预印本 论文 物理 计算机 数学', ['si', 'SiArxiv']],
  ['semanticscholar', 'Semantic Scholar', 'semanticscholar 语义学者 ai论文 学术', ['si', 'SiSemanticscholar']],
  ['dblp', 'dblp', 'dblp 计算机科学 文献 论文库', ['si', 'SiDblp']],
  ['zotero', 'Zotero', 'zotero 文献管理 学术', ['si', 'SiZotero']],

  // 赞助、众筹与收款
  ['afdian', '爱发电 (Afdian)', 'afdian 爱发电 赞助 打赏 创作者支持', ['si', 'SiAfdian']],
  ['githubsponsors', 'GitHub Sponsors', 'githubsponsors sponsors 开源赞助 打赏', ['si', 'SiGithubsponsors']],
  ['patreon', 'Patreon', 'patreon 赞助 会员制 创作者', ['fa6', 'FaPatreon']],
  ['kofi', 'Ko-fi', 'kofi ko-fi 赞助 请喝咖啡 打赏', ['si', 'SiKofi']],
  ['buymeacoffee', 'Buy Me a Coffee', 'buymeacoffee bmc 请喝咖啡 赞助 打赏', ['si', 'SiBuymeacoffee']],
  ['liberapay', 'Liberapay', 'liberapay 开源赞助 捐赠', ['si', 'SiLiberapay']],
  ['opencollective', 'Open Collective', 'opencollective 开源基金 赞助', ['si', 'SiOpencollective']],
  ['paypal', 'PayPal', 'paypal 贝宝 国际支付 收款 打赏', ['fa6', 'FaPaypal']],
  ['alipay', '支付宝 (Alipay)', 'alipay 支付宝 收款', ['fa6', 'FaAlipay']],

  // 加密邮箱、身份验证与应用商店
  ['protonmail', 'Proton Mail', 'proton protonmail 加密邮箱 隐私邮件', ['si', 'SiProtonmail']],
  ['keybase', 'Keybase', 'keybase pgp gpg 公钥 身份验证', ['fa6', 'FaKeybase']],
  ['appstore', 'App Store', 'appstore ios apple 苹果应用商店', ['fa6', 'FaAppStoreIos']],
  ['googleplay', 'Google Play', 'googleplay android 安卓应用商店 play商店', ['fa6', 'FaGooglePlay']],
]

const seen = new Set()
const items = DEFINITIONS.map(([id, label, words, [sourceType, sourceKey]]) => {
  if (seen.has(id))
    throw new Error(`Duplicate social icon id: ${id}`)
  seen.add(id)
  const spec = sourceType === 'custom'
    ? customSpecs[sourceKey]
    : extractReactIcon(sourceType, sourceKey)
  if (!spec)
    throw new Error(`Missing custom spec: ${sourceKey}`)
  return {
    id,
    label,
    words,
    spec,
  }
})

mkdirSync(dirname(outputFile), { recursive: true })
writeFileSync(outputFile, `${JSON.stringify({ icons: items }, null, 2)}\n`)
process.stdout.write(`Generated ${items.length} social/platform icons -> ${outputFile}\n`)
