import './jetbrains-mono.css'

// 控制台「系统运行」用的等宽字体：随仓库提供的 Google Fonts 文件（SIL OFL 1.1，许可证见 ./jetbrains-mono/OFL.txt），
// 仅在后台运行监控组件引入时按需打包对应 CSS，避免触发 next/font 全局自动注入无用的同源 preconnect 响应头
export const jetBrainsMono = {
  className: 'font-jetbrains-mono',
} as const
