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
  },
})
