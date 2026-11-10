import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 单元测试：编辑器相关逻辑依赖 DOM（DOMParser、DOMSerializer），使用 happy-dom 环境
export default defineConfig({
  // 测试不需要处理样式，避免加载 Tailwind 的 PostCSS 配置
  css: { postcss: {} },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    css: false,
    // next-intl 的中间件以不带扩展名的 next/server 导入 next，交给 Vite 解析（proxy.test.ts 用到）
    server: { deps: { inline: ['next-intl'] } },
  },
})
