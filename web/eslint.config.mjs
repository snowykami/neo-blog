import antfu from '@antfu/eslint-config'

export default antfu({
  // 启用 @next/next 规则（原先通过 extends 引入的方式 antfu 并不支持，实际从未生效）
  nextjs: true,
  // antfu v9 检测到 pnpm-workspace.yaml 会自动开启 pnpm 规则并要求改写工作区配置，这里保持关闭
  pnpm: false,
})
