/**
 * 后台表格的操作列：手机等窄屏上表格横向滚动时固定在最右侧，操作按钮始终可见。
 * - 背景必须不透明，才能盖住滚到它下面的其他列；行悬停时跟随 TableRow 的 hover:bg-muted/50 变色
 * - 窄屏左侧加一条分隔线，提示后面还有可以横向滚动的列
 * 表头与每一行的操作单元格都要加，colSpan 的占位行不用加
 */
export const STICKY_ACTIONS_CLASS
  = 'sticky right-0 z-10 bg-background [tr:hover>&]:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))] max-md:shadow-[inset_1px_0_0_var(--border)]'
