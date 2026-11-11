// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）。页面本体是客户端组件，不能声明路由段配置，放在 comments-page.tsx
export const instant = false

export { default } from './comments-page'
