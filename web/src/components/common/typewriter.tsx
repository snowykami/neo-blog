'use client'

import { useReducedMotion } from 'motion/react'
import React, { useEffect, useState } from 'react'

export default function Typewriter({
  text,
  speed = 30, // 每个字符的毫秒间隔
  reserveHeight = true, // 是否预先撑开文本内容数量的高度
}: {
  text: string
  speed?: number
  reserveHeight?: boolean
}) {
  const [index, setIndex] = useState(0)
  const [caretVisible, setCaretVisible] = useState(true)
  // 用户开启「减少动态效果」时直接显示全文，不逐字输出、不闪烁光标
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    setIndex(0)
    if (!text || reduceMotion)
      return
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= text.length) {
          clearInterval(t)
          return text.length
        }
        return i + 1
      })
    }, speed)
    return () => clearInterval(t)
  }, [text, speed, reduceMotion])

  useEffect(() => {
    if (reduceMotion)
      return
    const c = setInterval(() => setCaretVisible(v => !v), 500)
    return () => clearInterval(c)
  }, [reduceMotion])

  const visibleText = reduceMotion ? text : text.slice(0, index)

  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        position: 'relative',
        fontSize: '0.875rem',
        overflowWrap: 'anywhere',
        wordWrap: 'break-word',
      }}
    >
      {/* 预先撑开高度的隐藏文本 */}
      {reserveHeight && (
        <div aria-hidden="true" style={{ visibility: 'hidden', height: 'auto' }}>
          {text}
        </div>
      )}
      {/* 实际显示的打字机文本 */}
      <div style={reserveHeight ? { position: 'absolute', top: 0, left: 0, right: 0 } : {}}>
        {visibleText}
        {!reduceMotion && (
          <span
            style={{
              display: 'inline-block',
              width: 10,
              textAlign: 'left',
              visibility: caretVisible ? 'visible' : 'hidden',
            }}
          >
            |
          </span>
        )}
      </div>
    </div>
  )
}
