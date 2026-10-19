/**
 * 注释与链接的“自动匹配”约定（编辑器与服务端渲染共用，不依赖 tiptap）：
 * - 注释存储为 <span data-annotation="注释内容">词语</span>
 * - 注释或链接带 data-auto-match="true" 时，前台渲染会给全文相同词语自动加上同样的注释/链接
 */
export const ANNOTATION_MARK = 'annotation'
export const ANNOTATION_ATTR = 'data-annotation'
export const AUTO_MATCH_ATTR = 'data-auto-match'
// 渲染时自动补上的注释/链接标记，便于区分与调试
export const AUTO_MATCHED_ATTR = 'data-auto-matched'
