// 搜索结果里高亮关键词：与后端的文章搜索一致，搜索词按英文逗号拆成多个词（见 internal/service/post.go 的 ListPosts），
// 后端用 LIKE 匹配，SQLite 对 ASCII 字母不区分大小写，这里同样不区分

/** 把地址里的搜索词拆成要高亮的词：去空白、去重，长词在前（「neo-blog」与「neo」同时出现时整段高亮） */
export function parseHighlightTerms(query: string | null | undefined): string[] {
  if (!query)
    return []
  const terms = query.split(',').map(term => term.trim()).filter(Boolean)
  return [...new Set(terms)].sort((a, b) => b.length - a.length)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按关键词切分文本，match 为 true 的片段是命中的关键词；没有关键词或没有命中时返回整段 */
export function splitHighlight(text: string, terms: string[]): { text: string, match: boolean }[] {
  if (!text || terms.length === 0)
    return [{ text, match: false }]
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  // split 带捕获组时，奇数位是命中的部分
  return text.split(pattern)
    .map((part, index) => ({ text: part, match: index % 2 === 1 }))
    .filter(part => part.text !== '')
}
