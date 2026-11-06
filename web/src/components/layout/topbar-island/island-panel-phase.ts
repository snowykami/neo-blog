'use client'

import { createContext, useContext } from 'react'

/**
 * 灵动岛面板此刻处在哪个阶段：opening 为展开的形变期间，open 为展开完毕，closing 为开始收起（形变缩回胶囊、与胶囊交叉淡出）到卸载。
 * - 面板里开销大的部分（如歌词引擎要排上千个字）等展开完毕再挂载，形变期间先用轻量的替身，避免挂载的重活卡住展开动画
 * - 胶囊与面板显示同样的内容时（如音乐），只在 open 期间由面板逐帧演出，其余时候交给胶囊（收起时胶囊先在面板底下跟上此刻的画面）
 * 不在灵动岛面板里（如悬浮球的弹层）时为 null
 */
export type IslandPanelPhase = 'opening' | 'open' | 'closing'

export const IslandPanelPhaseContext = createContext<IslandPanelPhase | null>(null)

export function useIslandPanelPhase() {
  return useContext(IslandPanelPhaseContext)
}
