import type { RegisteredContentComponent } from './types'

/**
 * 组件库目录树：按组件定义文件所在目录（相对 src/components）组织，与源码目录一致
 */

export interface LibraryComponentNode {
  type: 'component'
  // 路径最后一段（文件 / 目录名）
  name: string
  path: string
  def: RegisteredContentComponent
}

export interface LibraryFolderNode {
  type: 'folder'
  name: string
  path: string
  children: LibraryNode[]
}

export type LibraryNode = LibraryFolderNode | LibraryComponentNode

function sortNodes(nodes: LibraryNode[]) {
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1))
  for (const node of nodes) {
    if (node.type === 'folder')
      sortNodes(node.children)
  }
}

/** 由注册表构建目录树，返回根目录下的节点；文件夹在前，同类按名称排序 */
export function buildLibraryTree(components: RegisteredContentComponent[]): LibraryNode[] {
  const root: LibraryFolderNode = { type: 'folder', name: '', path: '', children: [] }
  for (const def of components) {
    const segments = def.path.split('/')
    let folder = root
    segments.slice(0, -1).forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join('/')
      let next = folder.children.find((node): node is LibraryFolderNode => node.type === 'folder' && node.path === path)
      if (!next) {
        next = { type: 'folder', name: segment, path, children: [] }
        folder.children.push(next)
      }
      folder = next
    })
    folder.children.push({ type: 'component', name: segments.at(-1) ?? def.name, path: def.path, def })
  }
  sortNodes(root.children)
  return root.children
}

/** 按条件过滤目录树：保留匹配的组件及其上级目录，空目录移除 */
export function filterLibraryTree(nodes: LibraryNode[], match: (def: RegisteredContentComponent) => boolean): LibraryNode[] {
  return nodes.flatMap((node): LibraryNode[] => {
    if (node.type === 'component')
      return match(node.def) ? [node] : []
    const children = filterLibraryTree(node.children, match)
    return children.length ? [{ ...node, children }] : []
  })
}

/** 目录树中的全部组件（按展示顺序） */
export function flattenLibraryTree(nodes: LibraryNode[]): RegisteredContentComponent[] {
  return nodes.flatMap(node => (node.type === 'component' ? [node.def] : flattenLibraryTree(node.children)))
}

/** 目录树中的全部文件夹路径 */
export function libraryFolderPaths(nodes: LibraryNode[]): string[] {
  return nodes.flatMap(node => (node.type === 'folder' ? [node.path, ...libraryFolderPaths(node.children)] : []))
}
