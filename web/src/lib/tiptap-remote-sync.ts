import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { RemoteChangeRange } from '@/components/tiptap-extension/remote-change-extension'
import { Fragment } from '@tiptap/pm/model'
import { createDocument } from '@tiptap/react'
import { REMOTE_SYNC_META, remoteChangePluginKey } from '@/components/tiptap-extension/remote-change-extension'

/** 一处变化：旧文档顶层块 [oldFrom, oldTo) 换成新文档顶层块 [newFrom, newTo)（均为块下标） */
export interface BlockHunk {
  oldFrom: number
  oldTo: number
  newFrom: number
  newTo: number
}

// 中间段逐块比较的规模上限（旧块数 × 新块数），超出时中间段整体视为变化
const MAX_LCS_CELLS = 1_000_000

function blockKey(node: PMNode) {
  return JSON.stringify(node.toJSON())
}

/** 参与比较的顶层块：末尾由 TrailingNode 补出的空段落不算，否则远端内容与编辑器里的内容总会差这一块 */
function contentBlocks(doc: PMNode): readonly PMNode[] {
  const blocks = doc.content.content
  const last = blocks.at(-1)
  return blocks.length > 1 && last?.type.name === 'paragraph' && last.childCount === 0 ? blocks.slice(0, -1) : blocks
}

/**
 * 块对齐：a 中每一块在 b 中对应的下标，没有对应（被修改或删除）时为 -1
 * 先去掉相同的首尾，中间段按最长公共子序列对齐；对齐是单调的（a 中靠后的块对应 b 中靠后的块）
 */
function matchBlocks(a: string[], b: string[]): Int32Array {
  const match = new Int32Array(a.length).fill(-1)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    match[start] = start
    start++
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
    match[endA] = endB
  }
  const n = endA - start
  const m = endB - start
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS)
    return match
  // lcs[i][j]：a[start+i..endA) 与 b[start+j..endB) 的最长公共子序列长度
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[start + i] === b[start + j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[start + i] === b[start + j]) {
      match[start + i] = start + j
      i++
      j++
    }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++
    }
    else {
      j++
    }
  }
  return match
}

/** 由块对齐得出变化：相邻两个对应块之间没有对应上的部分为一处变化 */
function hunksFromMatch(match: Int32Array, lengthB: number): BlockHunk[] {
  const hunks: BlockHunk[] = []
  let i = 0
  let j = 0
  const pairs: [number, number][] = []
  match.forEach((to, from) => to >= 0 && pairs.push([from, to]))
  pairs.push([match.length, lengthB])
  for (const [pi, pj] of pairs) {
    if (pi > i || pj > j)
      hunks.push({ oldFrom: i, oldTo: pi, newFrom: j, newTo: pj })
    i = pi + 1
    j = pj + 1
  }
  return hunks
}

/** 顶层块级 diff：远端写入通常是改写几段（AI 按段落修改），按块比较足以定位改了哪里 */
export function diffBlocks(oldDoc: PMNode, newDoc: PMNode): BlockHunk[] {
  const b = contentBlocks(newDoc).map(blockKey)
  return hunksFromMatch(matchBlocks(contentBlocks(oldDoc).map(blockKey), b), b.length)
}

/** 顶层块的起始位置：offsets[k] 为第 k 块的起点，offsets[childCount] 为文档内容末尾 */
function blockOffsets(doc: PMNode) {
  const offsets = [0]
  doc.forEach(node => offsets.push(offsets[offsets.length - 1] + node.nodeSize))
  return offsets
}

export interface RemoteMergeResult {
  /** 合并进来的块在合并后文档中的位置 */
  ranges: RemoteChangeRange[]
  /** 远端与本地都改了同一处、保留了本地版本的处数 */
  conflicts: number
  /** 远端的最新正文，作为下次合并的基线 */
  remoteDoc: PMNode
  /** 合并前本地相对基线有修改（未保存的内容），合并后仍需保存 */
  localChanged: boolean
}

/**
 * 把远端的最新正文按块三方合并进编辑器：base 为本地上次与服务端同步时的正文，local 为编辑器当前内容，remote 为远端最新正文
 * - 远端改动的块在本地没有改过：换成远端的版本（只替换这些块，其余块的 DOM、选区不受影响）
 * - 远端插入的块：插到本地对应的位置
 * - 远端改动的块本地也改过（或周围本地有修改、位置不确定）：保留本地版本，计入 conflicts
 * 合并不进入撤销历史，也不算作本地修改；合并进来的块会高亮
 */
export function mergeRemoteContent(editor: Editor, base: PMNode, remoteHtml: string): RemoteMergeResult {
  const { state, view } = editor
  const remoteDoc = createDocument(remoteHtml, state.schema, editor.options.parseOptions)
  const baseKeys = contentBlocks(base).map(blockKey)
  const localBlocks = contentBlocks(state.doc)
  const localKeys = localBlocks.map(blockKey)
  const remoteBlocks = contentBlocks(remoteDoc)
  const remoteKeys = remoteBlocks.map(blockKey)

  const localMatch = matchBlocks(baseKeys, localKeys)
  const localChanged = hunksFromMatch(localMatch, localKeys.length).length > 0
  const remoteHunks = hunksFromMatch(matchBlocks(baseKeys, remoteKeys), remoteKeys.length)

  // 远端的一处变化在本地对应的块范围 [from, to)，无法确定（本地也改过）时返回 null
  const nearestMatched = (from: number, step: -1 | 1) => {
    for (let k = from; k >= 0 && k < baseKeys.length; k += step) {
      if (localMatch[k] >= 0)
        return k
    }
    return step < 0 ? -1 : baseKeys.length
  }
  const localTarget = (hunk: BlockHunk): { from: number, to: number } | null => {
    if (hunk.oldTo > hunk.oldFrom) {
      // 被改动的基线块在本地都没有改过，且本地没有在它们中间插入内容
      for (let k = hunk.oldFrom; k < hunk.oldTo; k++) {
        if (localMatch[k] < 0 || (k > hunk.oldFrom && localMatch[k] !== localMatch[k - 1] + 1))
          return null
      }
      return { from: localMatch[hunk.oldFrom], to: localMatch[hunk.oldTo - 1] + 1 }
    }
    // 纯插入：插在左侧对应块之后；左侧紧邻的块本地改过时，插在右侧对应块之前；两侧都改过则位置不确定
    const left = nearestMatched(hunk.oldFrom - 1, -1)
    const right = nearestMatched(hunk.oldFrom, 1)
    if (left === hunk.oldFrom - 1) {
      const at = left < 0 ? 0 : localMatch[left] + 1
      return { from: at, to: at }
    }
    if (right === hunk.oldFrom) {
      const at = right >= baseKeys.length ? localBlocks.length : localMatch[right]
      return { from: at, to: at }
    }
    return null
  }

  let conflicts = 0
  const edits: { from: number, to: number, blocks: readonly PMNode[] }[] = []
  for (const hunk of remoteHunks) {
    const target = localTarget(hunk)
    if (target)
      edits.push({ ...target, blocks: remoteBlocks.slice(hunk.newFrom, hunk.newTo) })
    else
      conflicts++
  }
  if (edits.length === 0)
    return { ranges: [], conflicts, remoteDoc, localChanged }

  // 按位置从前往后替换，记录前面的替换造成的位置偏移
  const offsets = blockOffsets(state.doc)
  const tr = state.tr
  const ranges: RemoteChangeRange[] = []
  let delta = 0
  for (const edit of edits.sort((x, y) => x.from - y.from)) {
    const from = offsets[edit.from] + delta
    const to = offsets[edit.to] + delta
    const fragment = Fragment.fromArray(edit.blocks)
    tr.replaceWith(from, to, fragment)
    if (fragment.size > 0)
      ranges.push({ from, to: from + fragment.size })
    delta += fragment.size - (to - from)
  }
  tr.setMeta('addToHistory', false).setMeta(REMOTE_SYNC_META, true).setMeta(remoteChangePluginKey, ranges)
  view.dispatch(tr)
  return { ranges, conflicts, remoteDoc, localChanged }
}
