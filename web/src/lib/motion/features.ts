/**
 * 全站 `<LazyMotion>` 共用的轻量动画特性包（仅由 `./index.ts` 动态导入，独立成块，不进首屏同步 JS）。
 *
 * 为什么用 `domAnimation` 而不是 `domMax`：
 * - 前台常规页面与顶栏均无拖拽（`drag`）或共享布局投影（`layout` / `layoutId`）；
 * - `domAnimation` 已完整包含 `animate`、`exit`、`variants`、Spring 弹簧与 `whileHover` / `whileTap` 微交互，
 *   相比 `domMax` 可省去约 48 KiB raw（约 15 KiB gzip）的手势拖拽与投影矩阵引擎。
 * - 请勿将此处改回 `domMax`；若未来某个后台独立工具确需拖拽或布局投影，请在该工具内部局部实现，不要污染全站特性包。
 */
import { domAnimation } from 'motion/react'

export default domAnimation
