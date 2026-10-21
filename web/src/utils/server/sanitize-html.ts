import DOMPurify from 'isomorphic-dompurify'

/**
 * 文章 / 页面正文 HTML 净化（服务端渲染时调用）
 * - 正文由 editor / admin 通过 Tiptap 编辑器产出，但存储内容不可信（可绕过编辑器直接调接口写入）
 * - 保留编辑器合法产出：class、style、data-*（图片对齐/说明、注释、自动匹配等）、图片、figure、表格、代码块与高亮 span、任务列表等
 * - 移除 script、事件处理器（on*）、javascript: 等危险 URL；编辑器不产出 iframe / object / embed / form，一律移除
 */

// 链接在新窗口打开时补全 rel，防止 reverse tabnabbing
let hooksInstalled = false
function installHooks() {
  if (hooksInstalled)
    return
  hooksInstalled = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      const rel = new Set((node.getAttribute('rel') || '').split(/\s+/).filter(Boolean))
      rel.add('noopener')
      rel.add('noreferrer')
      node.setAttribute('rel', [...rel].join(' '))
    }
  })
}

export function sanitizeContentHtml(html: string): string {
  if (!html)
    return ''
  installHooks()
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // DOMPurify 默认不保留 target，链接卡片 / 外链需要
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'base', 'meta', 'link', 'style'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ALLOW_DATA_ATTR: true,
  })
}
