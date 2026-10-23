import type { DOMOutputSpec } from '@tiptap/pm/model'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { z } from 'zod'
import type { ComponentWidth } from './layout'

/**
 * 文章 / 页面组件块：正文中只保存组件名与 JSON props，渲染时按注册表查找组件
 * <div data-component="name" data-props='{...}' data-version="1">降级内容</div>
 */

// 表单控件提示：通过 zod 的 .meta() 标注，未标注时按字段类型选择控件
export interface ContentFieldMeta {
  widget?: 'textarea' | 'code' | 'datetime'
}

// 属性弹窗中的自定义动作（例如按城市获取天气后填入表单）：读取当前表单值并写回
export interface ContentEditorActionProps<P = Record<string, unknown>> {
  // 当前表单值，未经校验
  values: Partial<P>
  // 批量写回字段，并重新校验这些字段
  setValues: (values: Partial<P>) => void
}

// 编辑器扩展：只在属性弹窗中使用，不影响前台渲染
export interface ContentComponentEditor<P = Record<string, unknown>> {
  // 渲染在表单字段之前；应使用 next/dynamic 懒加载，避免进入前台的包
  action?: ComponentType<ContentEditorActionProps<P>>
  // 按当前表单值决定是否显示字段，未提供时全部显示；隐藏的字段仍会提交并参与校验
  isFieldVisible?: (name: string, values: Partial<P>) => boolean
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
  // 插入时的默认宽度（预设百分比），未提供时满宽；作者可在工具栏中调整
  defaultWidth?: ComponentWidth
  // 属性弹窗的扩展
  editor?: ContentComponentEditor<NoInfer<z.input<S>>>
  // 允许 AI 帮写使用该组件：usage 说明适用场景，与 props 的 JSON Schema 一起写入提示词；
  // 只应开放不依赖外部 ID（歌曲、仓库等）的组件，避免模型编造不存在的数据
  ai?: { usage: string }
}

export type AnyContentComponentDef = ContentComponentDef<z.ZodObject>

// 生成的注册表条目：path 为定义文件相对 src/components 的目录路径，用于组件库的目录树
export interface ContentComponentEntry {
  path: string
  def: AnyContentComponentDef
}

export type RegisteredContentComponent = AnyContentComponentDef & { path: string }
