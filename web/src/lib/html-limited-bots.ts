import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots'

/**
 * 将 Next.js 内置 HTML_LIMITED_BOT_UA_RE 中的 `[\w-]+-Google` 与 `Google-[\w-]+` 量词做布尔等价线性化：
 * 含连字符的 `[\w-]+` 紧邻 `-Google` 时对形如 `"a-".repeat(N)` 的输入会产生 O(N^2) 多项式回溯（ReDoS）；
 * 对非锚定子串存在性测试 `.test()` 而言，`[\w-]-Google` 与 `[\w-]+-Google` 数学上 100% 等价且恒为 O(N) 线性时间。
 */
const SAFE_BUILTIN_BOT_SOURCE = HTML_LIMITED_BOT_UA_RE.source
  .replaceAll(String.raw`[\w-]+-Google`, String.raw`[\w-]-Google`)
  .replaceAll(String.raw`Google-[\w-]+`, String.raw`Google-[\w-]`)

/**
 * 在完整保留 Next.js 内置 HTML_LIMITED_BOT_UA_RE 默认搜索引擎与社交卡片爬虫的基础上，
 * 合并补充主流 AI 爬虫、搜索引擎爬虫与命令行抓取工具，确保服务端对这些 UA 直接阻塞渲染完整 <head> 元信息与 JSON-LD，
 * 绝不把标题、canonical、OpenGraph 或结构化数据拆到流式 <body> 尾部。
 */
export const EXTRA_HTML_LIMITED_BOT_PATTERNS = [
  // Google 主搜索、通用抓取与 AI 训练扩展
  'Googlebot',
  'GoogleOther',
  'Google-Extended',
  // OpenAI
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  // Anthropic
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'anthropic-ai',
  // Perplexity
  'PerplexityBot',
  'Perplexity-User',
  // 其他主流 AI / 搜索引擎 / 采集器
  'Applebot-Extended',
  'Applebot',
  'Bytespider',
  'Baiduspider',
  'Sogou',
  'YandexBot',
  'DuckDuckBot',
  'Amazonbot',
  'CCBot',
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
  'FacebookBot',
  'cohere-ai',
  'Diffbot',
  'YouBot',
  // 常见命令行与自动化 HTTP 客户端（单词边界防止误伤普通 UA 子串）
  String.raw`\bcurl\b`,
  String.raw`\bwget\b`,
  'python-requests',
  'Scrapy',
  String.raw`\bhttpx\b`,
  'Go-http-client',
] as const

export const HTML_LIMITED_BOTS_REGEX = new RegExp(
  `${SAFE_BUILTIN_BOT_SOURCE}|${EXTRA_HTML_LIMITED_BOT_PATTERNS.join('|')}`,
  'i',
)

const MAX_UA_INSPECT_LENGTH = 1024

export function isHtmlLimitedCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent)
    return false
  const sample = userAgent.length > MAX_UA_INSPECT_LENGTH
    ? userAgent.slice(0, MAX_UA_INSPECT_LENGTH)
    : userAgent
  return HTML_LIMITED_BOTS_REGEX.test(sample)
}
