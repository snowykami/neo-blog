import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'

/** 远端变化的范围（新文档中的位置），覆盖一个或多个顶层块 */
export interface RemoteChangeRange {
  from: number
  to: number
}

/**
 * 只读观看时远端（外部 AI 工具、其他设备）写入的内容：
 * 同步事务带上 REMOTE_SYNC_META，编辑器不把它当作本地修改（不标记未保存、不触发自动保存）；
 * 通过 remoteChangePluginKey 传入变化范围，范围内的顶层块短暂高亮（样式见 editor-content.scss）
 */
export const REMOTE_SYNC_META = 'remoteSync'

export const remoteChangePluginKey = new PluginKey<DecorationSet>('remoteChange')

function decorate(doc: PMNode, ranges: RemoteChangeRange[]) {
  const decorations: Decoration[] = []
  for (const { from, to } of ranges) {
    doc.nodesBetween(from, to, (node, pos) => {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'neo-remote-change' }))
      // 只标顶层块
      return false
    })
  }
  return DecorationSet.create(doc, decorations)
}

export const RemoteChangeHighlight = Extension.create({
  name: 'remoteChangeHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: remoteChangePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const ranges = tr.getMeta(remoteChangePluginKey) as RemoteChangeRange[] | undefined
            if (ranges)
              return decorate(tr.doc, ranges)
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations: state => remoteChangePluginKey.getState(state),
        },
      }),
    ]
  },
})
