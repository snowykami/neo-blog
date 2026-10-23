import type { DOMOutputSpec } from '@tiptap/pm/model'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { z } from 'zod'

/**
 * 文章 / 页面组件块：正文中只保存组件名与 JSON props，渲染时按注册表查找组件
 * <div data-component="name" data-props='{...}' data-version="1">降级内容</div>
 */

// 表单控件提示：通过 zod 的 .meta() 标注，未标注时按字段类型选择控件
export interface ContentFieldMeta {
  widget?: 'textarea' | 'code'
}

export interface ContentComponentDef<S extends z.ZodObject = z.ZodObject> {
  // 组件名：写入 data-component，同时是 ContentComponents 文案命名空间下的 key
  name: string
  // props 结构版本：结构有不兼容变化时递增；正文中的版本高于当前版本时按未知组件处理
  version: number
  // props 结构，所有字段都应带默认值，以便插入时生成初始 props
  schema: S
  // 懒加载的渲染组件（next/dynamic），编辑器预览与前台渲染共用
  component: ComponentType<NoInfer<z.output<S>>>
  icon: LucideIcon
  // 斜杠命令的检索词（中文 / 拼音 / 英文）
  keywords: string[]
  // 降级内容：写入占位元素内部，供无 JS 环境、RSS 与组件不可用时展示；只用纯文本与基础标签
  fallback: (props: NoInfer<z.output<S>>) => DOMOutputSpec[]
  // 组件库中的预览 props；t 读取 ContentComponents.<name>.example 下的文案。未提供或校验失败时不显示预览
  example?: (t: (key: string) => string) => NoInfer<z.input<S>>
}

export type AnyContentComponentDef = ContentComponentDef<z.ZodObject>

// 生成的注册表条目：path 为定义文件相对 src/components 的目录路径，用于组件库的目录树
export interface ContentComponentEntry {
  path: string
  def: AnyContentComponentDef
}

export type RegisteredContentComponent = AnyContentComponentDef & { path: string }
