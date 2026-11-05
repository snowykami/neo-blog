'use client'

import { createContext, useContext } from 'react'

/**
 * 灵动岛面板是否已经展开完毕：展开的形变期间为 false，面板里开销大的部分（如歌词引擎要排上千个字）等它变成 true 再挂载，
 * 形变期间先用轻量的替身，避免挂载的重活卡住展开动画。不在灵动岛面板里（如悬浮球的弹层）时始终为 true
 */
export const IslandPanelReadyContext = createContext(true)

export function useIslandPanelReady() {
  return useContext(IslandPanelReadyContext)
}
