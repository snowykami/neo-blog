// 前台组件岛的挂载点：其他正文增强器（代码块包装、图片查看 / 兜底、链接悬浮卡）需跳过其中的元素
export const COMPONENT_ROOT_ATTR = 'data-component-root'
export const COMPONENT_ROOT_SELECTOR = `[${COMPONENT_ROOT_ATTR}]`

// 组件岛隐藏后的降级内容容器
export const COMPONENT_FALLBACK_ATTR = 'data-component-fallback'

// 组件块根元素外层统一样式：不受 prose 排版影响，编辑器与前台一致
export const COMPONENT_BLOCK_CLASS = 'not-prose my-6'

// 组件内富文本区域标记：允许前台 ContentHoverCard 对其中的注释词语与外链启用悬停卡片（其余功能性组件内的链接仍跳过）
export const RICH_TEXT_CONTENT_ATTR = 'data-rich-text-content'
export const RICH_TEXT_CONTENT_SELECTOR = `[${RICH_TEXT_CONTENT_ATTR}]`
