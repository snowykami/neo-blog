/**
 * 后台表格的操作列：手机等窄屏上表格横向滚动时固定在最右侧，操作按钮始终可见。
 * - 背景必须不透明，才能盖住滚到它下面的其他列；行悬停/选中时跟随 TableRow 的 hover:bg-muted/40 与 data-[state=selected]:bg-muted/70 变色
 * - 窄屏左侧加一条分隔线，提示后面还有可以横向滚动的列
 * 表头与每一行的操作单元格都要加，colSpan 的占位行不用加
 */
export const STICKY_ACTIONS_CLASS
  = 'sticky right-0 z-10 bg-card [tr:hover>&]:bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))] [tr[data-state=selected]>&]:bg-[color-mix(in_oklab,var(--muted)_70%,var(--card))] max-md:shadow-[inset_1px_0_0_var(--border)]'
